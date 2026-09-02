/**
 * Week 1 goal: receive a GitHub `pull_request` webhook and log its shape.
 *
 * This intentionally does NOT verify signatures, fetch diffs, or call an LLM
 * yet — that's Week 2. Right now the only job is: stand up a server, receive
 * a real webhook, and actually look at the payload GitHub sends you.
 */

import Fastify from "fastify";
import "dotenv/config";
import { Octokit } from "@octokit/core";
import { restEndpointMethods } from "@octokit/plugin-rest-endpoint-methods";
import { Webhooks } from "@octokit/webhooks";
import { Anthropic } from "@anthropic-ai/sdk";
import { validate } from "class-validator";
import { DiffReview } from "./types/diff-review.js";
import { plainToInstance } from "class-transformer";

const app = Fastify({ logger: true });
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
const myOctokit = new (Octokit.plugin(restEndpointMethods))({
  auth: process.env.GITHUB_TOKEN,
});

// ============================================================================
// Type definitions and helpers
// ============================================================================

interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  sha: string;
  action: string;
}

async function validateDiffReview(payload: unknown): Promise<DiffReview | null> {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const review = plainToInstance(DiffReview, payload);
  const errors = await validate(review);

  if (errors.length > 0) {
    console.error("DiffReview validation failed:", JSON.stringify(errors, null, 2));
    return null;
  }

  return review;
}

// ============================================================================
// Review generation and validation
// ============================================================================

const REVIEW_SYSTEM_PROMPT = [
  "You are reviewing a GitHub diff for a code review assistant.",
  "Review the diff carefully and identify:",
  "- likely bugs or logic issues",
  "- naming problems that reduce clarity",
  "- missing or weak tests",
  "- maintainability or API contract risks",
  "- any obvious edge-case problems",
  " ",
  "Important rules:",
  "1. Use only evidence from the provided diff.",
  "2. Do not invent facts not supported by the code.",
  "3. Be conservative. If something is uncertain, mark the confidence lower.",
  "4. Return valid JSON only.",
  "5. Do not wrap the JSON in markdown fences.",
  "6. Follow the exact schema below.",
  " ",
  "Schema:",
  "{",
  "  \"summary\": string,",
  "  \"overall_risk\": \"low\" | \"medium\" | \"high\" | \"critical\",",
  "  \"findings\": [{",
  "    \"id\": \"R<number>\",",
  "    \"severity\": \"low\" | \"medium\" | \"high\" | \"critical\",",
  "    \"category\": \"bug_risk\" | \"missing_test\" | \"naming\" | \"maintainability\" | \"performance\" | \"security\" | \"error_handling\" | \"logic\",",
  "    \"title\": string,",
  "    \"description\": string,",
  "    \"file\": string,",
  "    \"line_hint\": number,",
  "    \"evidence\": string,",
  "    \"suggestion\": string,",
  "    \"confidence\": number",
  "  }],",
  "  \"no_obvious_issues\": boolean",
  "}",
].join(" ");

const BOT_MARKER = "<!-- AI_REVIEWER_BOT -->";
let BOT_USERNAME: string;

// Initialize bot username at startup
(async () => {
  BOT_USERNAME = await initializeBot();
})();

async function initializeBot() {
  const response = await myOctokit.rest.users.getAuthenticated();
  console.log("Authenticated as:", response.data.login);
  return response.data.login;
}

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET as string,
});

// ============================================================================
// Webhook helpers
// ============================================================================

/**
 * Extract PR context from webhook payload
 */
function extractPRContext(body: Record<string, unknown>): PRContext | null {
  const owner = (body as any).repository?.owner?.login;
  const repo = (body as any).repository?.name;
  const prNumber = (body as any).pull_request?.number;
  const sha = (body as any).pull_request?.head?.sha;
  const action = body.action as string;

  if (!owner || !repo || !prNumber || !sha || !action) {
    console.error("Missing required PR context fields");
    return null;
  }

  return { owner, repo, prNumber, sha, action };
}

/**
 * Check if this PR action should trigger a review
 */
function isReviewableAction(action: string): boolean {
  return ["opened", "synchronize", "reopened"].includes(action);
}

/**
 * Fetch the PR diff from GitHub
 */
async function fetchPullRequestDiff(
  owner: string,
  repo: string,
  prNumber: number
): Promise<string | null> {
  try {
    const response = await myOctokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: "diff" },
    });
    return response.data as unknown as string;
  } catch (error) {
    console.error("Error fetching PR diff:", error);
    return null;
  }
}

/**
 * Call the LLM to generate a review for the diff
 */
async function generateReview(diffText: string): Promise<string | null> {
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: REVIEW_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            "Review this diff and return structured JSON only.",
            "",
            diffText,
          ].join("\n\n"),
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    return textBlock?.text ?? null;
  } catch (error) {
    console.error("Error calling LLM:", error);
    return null;
  }
}

/**
 * Parse and validate the LLM response
 */
async function parseAndValidateLLMResponse(
  rawText: string
): Promise<DiffReview | null> {
  try {
    const parsed = JSON.parse(rawText);
    const review = await validateDiffReview(parsed);
    return review;
  } catch (error) {
    console.error("Error parsing or validating LLM response:", error);
    return null;
  }
}

/**
 * Delete previous bot comments from a PR
 */
async function deletePreviousBotComments(
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  try {
    // Delete issue comments
    const issueComments = await myOctokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    for (const comment of issueComments.data) {
      const isBotComment =
        comment.user?.login === BOT_USERNAME &&
        comment.body?.includes(BOT_MARKER);

      if (isBotComment) {
        await myOctokit.rest.issues.deleteComment({
          owner,
          repo,
          comment_id: comment.id,
        });
        console.log(`Deleted issue comment ${comment.id}`);
      }
    }

    // Delete review comments
    const reviewComments = await myOctokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
    });

    for (const comment of reviewComments.data) {
      const isBotComment =
        comment.user?.login === BOT_USERNAME &&
        comment.body?.includes(BOT_MARKER);

      if (isBotComment) {
        await myOctokit.rest.pulls.deleteReviewComment({
          owner,
          repo,
          comment_id: comment.id,
        });
        console.log(`Deleted review comment ${comment.id}`);
      }
    }
  } catch (error) {
    console.error("Error deleting previous bot comments:", error);
  }
}

/**
 * Post a summary comment to the PR conversation
 */
async function postSummaryComment(
  owner: string,
  repo: string,
  prNumber: number,
  review: DiffReview | null
): Promise<void> {
  try {
    const summaryBody = review
      ? [
          BOT_MARKER,
          "## AI Code Review Summary",
          "",
          `**Overall Risk:** ${review.overall_risk.toUpperCase()}`,
          "",
          `**Summary:** ${review.summary}`,
          "",
          review.no_obvious_issues
            ? "✅ No obvious issues detected."
            : `📋 Found ${review.findings.length} finding(s).`,
        ].join("\n")
      : `${BOT_MARKER}\n⚠️ Code review failed to generate.`;

    await myOctokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: summaryBody,
    });
  } catch (error) {
    console.error("Error posting summary comment:", error);
  }
}

/**
 * Post inline review comments for each finding
 */
async function postInlineFindings(
  owner: string,
  repo: string,
  prNumber: number,
  review: DiffReview | null,
  sha: string
): Promise<void> {
  if (!review || review.findings.length === 0) {
    return;
  }

  for (const finding of review.findings) {
    try {
      await myOctokit.rest.pulls.createReviewComment({
        owner,
        repo,
        pull_number: prNumber,
        body: [
          BOT_MARKER,
          `**[${finding.severity.toUpperCase()}]** ${finding.title}`,
          "",
          finding.description,
          "",
          `**Suggestion:** ${finding.suggestion}`,
          "",
          `Confidence: ${finding.confidence}%`,
        ].join("\n"),
        commit_id: sha,
        path: finding.file,
        line: finding.line_hint,
      });
    } catch (error) {
      console.error(
        `Error posting review comment for finding ${finding.id}:`,
        error
      );
    }
  }
}

// GitHub will POST every webhook event to this route.
app.post("/webhook", async (request, reply) => {
  const signature = request.headers["x-hub-signature-256"] as string;
  const rawBody = JSON.stringify(request.body);

  // Verify webhook signature
  if (!(await webhooks.verify(rawBody, signature))) {
    reply.status(401).send("Unauthorized: Invalid Signature");
    return;
  }

  const eventType = request.headers["x-github-event"];
  const body = request.body as Record<string, unknown>;

  app.log.info(`Received GitHub event: ${eventType}`);

  // Only process pull_request events
  if (eventType !== "pull_request") {
    reply.status(200).send({ received: true });
    return;
  }

  // Extract PR context
  const context = extractPRContext(body);
  if (!context) {
    reply.status(400).send("Invalid PR webhook payload");
    return;
  }

  console.log(`PR ${context.prNumber}: action=${context.action}`);

  // Check if this action requires a review
  if (!isReviewableAction(context.action)) {
    console.log(`Skipping review for action: ${context.action}`);
    reply.status(200).send({ received: true });
    return;
  }

  // Fetch the diff
  const diffText = await fetchPullRequestDiff(
    context.owner,
    context.repo,
    context.prNumber
  );
  if (!diffText) {
    reply.status(500).send("Failed to fetch PR diff");
    return;
  }

  // Generate review from LLM
  const rawReviewText = await generateReview(diffText);
  if (!rawReviewText) {
    console.error("Failed to generate review from LLM");
    reply.status(200).send({ received: true });
    return;
  }

  // Parse and validate review
  const review = await parseAndValidateLLMResponse(rawReviewText);
  if (!review) {
    console.error("Failed to parse/validate LLM response");
    reply.status(200).send({ received: true });
    return;
  }

  console.log(
    `Generated review: ${review.findings.length} findings, risk=${review.overall_risk}`
  );

  // Delete previous bot comments
  console.log("Deleting previous bot comments...");
  await deletePreviousBotComments(
    context.owner,
    context.repo,
    context.prNumber
  );

  // Post fresh comments to PR
  await postSummaryComment(
    context.owner,
    context.repo,
    context.prNumber,
    review
  );
  await postInlineFindings(
    context.owner,
    context.repo,
    context.prNumber,
    review,
    context.sha
  );

  reply.status(200).send({ received: true });
});


app.get("/health", async () => {
  return { status: "ok" };
});

const PORT = Number(process.env.PORT ?? 3000);

app.listen({ port: PORT }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`Webhook receiver listening at ${address}`);
  console.log(`Point ngrok at this port, then set your GitHub webhook URL to`);
  console.log(`   https://<your-ngrok-subdomain>.ngrok-free.app/webhook`);
});
