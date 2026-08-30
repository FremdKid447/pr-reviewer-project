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

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET as string,
});

myOctokit.rest.users.getAuthenticated().then((response) => {
  console.log("Authenticated as:", response.data.login);
});

// GitHub will POST every webhook event to this route.
// The `X-GitHub-Event` header tells you which event type it is
// (e.g. "pull_request", "ping", "issue_comment").
app.post("/webhook", async (request, reply) => {
  const signature = request.headers["x-hub-signature-256"] as string;
  const rawBody = await JSON.stringify(request.body);

  if (!(await webhooks.verify(rawBody, signature))) {
    reply.status(401).send("Unauthorized: Invalid Signature");
    return;
  } else {
    console.log('Payload signature verified successfully!.');
  }

  const eventType = request.headers["x-github-event"];
  const body = request.body as Record<string, unknown>;

  app.log.info(`Received GitHub event: ${eventType}`);

  if (eventType === "pull_request") {
    // This is the payload shape you should spend time exploring this week.
    // Log the whole thing at least once and read through it — you're
    // looking for: action (opened/synchronize/closed), pull_request.number,
    // pull_request.diff_url, pull_request.head.sha, repository.full_name.
    // console.log(JSON.stringify(body, null, 2));

    const action = body.action;
    const prNumber = (body as any).pull_request?.number;
    console.log(`--> action: ${action}, PR number: ${prNumber}`);

    let diffText;

    try {
      const prResponse = await myOctokit.rest.pulls.get({
        owner: (body as any).repository?.owner?.login,
        repo: (body as any).repository?.name,
        pull_number: prNumber,
        mediaType: { format: "diff" },
      });
      diffText = prResponse.data;
      console.log(diffText);

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
      const rawReviewText = textBlock?.text ?? "";
      console.log("Raw LLM response:\n", rawReviewText);

      try {
        const parsed = JSON.parse(rawReviewText);
        const review = await validateDiffReview(parsed);

        if (!review) {
          console.error("LLM response failed class-validator validation:", parsed);
          return;
        }

        console.log("Validated diff review:", JSON.stringify(review, null, 2));
      } catch (error) {
        console.error("LLM response was not valid JSON:", error);
      }
    } catch (err) {
      console.error("Error fetching PR details:", err);
    }

    // myOctokit.rest.pulls.get({
    //   owner: (body as any).repository?.owner?.login,
    //   repo: (body as any).repository?.name,
    //   pull_number: prNumber,
    //   mediaType: { format: "diff" },
    // }).then((prResponse) => {
    //   diffText = prResponse.data;
    //   console.log(diffText);
    // }).catch((err) => {
    //   console.error("Error fetching PR details:", err);
    // });
  }

  // Respond quickly. GitHub expects a 2xx response soon after delivery,
  // or it will consider the delivery failed and may retry.
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
