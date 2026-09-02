/**
 * Standalone LLM testing script.
 *
 * Tests the Claude API with a sample diff to verify review generation
 * works correctly. Run with: npm run llm-test
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// A fake diff to test with. Swap this out for a real one you copy-paste
// from a GitHub PR "Files changed" tab if you want a more realistic test.
const SAMPLE_DIFF = `
diff --git a/src/auth.ts b/src/auth.ts
index 83db48f..bf269c4 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -12,7 +12,7 @@ export function login(username: string, password: string) {
-  if (password.length < 8) {
-    throw new Error("Password too short");
-  }
+  // removed length check for now, revisit later
   const user = db.findUser(username);
   return generateToken(user);
 }
`;

const SAMPLE_DIFF_2 = `
diff --git a/README.md b/README.md
index 44a839a..d0b24fd 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,3 @@
 # music-database-application
 
-Consists of a music application that has a SQL database and uses Flask and Python for the UI framework
+This is a music application that has a SQL database and uses Flask and Python for the UI framework. It was developed as a project for a database systems class.
`;

async function main() {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system:
      "You are a senior code reviewer. Given a diff, identify concrete risks: " +
      "security issues, missing tests, unclear naming, or breaking changes. " +
      "Respond ONLY with a JSON array of objects, each with 'severity' " +
      "('low'|'medium'|'high') and 'finding' (a short string). No prose, no markdown fences.",
    messages: [
      {
        role: "user",
        content: `Review this diff:\n\n${SAMPLE_DIFF}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  console.log("Raw response:\n", textBlock?.text);

  // Try parsing it as JSON to validate the response shape
  try {
    const parsed = JSON.parse(textBlock?.text ?? "[]");
    console.log("\nParsed findings:");
    console.table(parsed);
  } catch (err) {
    console.log("\n(Could not parse as JSON — check the raw response above and verify it follows the schema.)");
  }
}

main().catch((err) => {
  console.error("Error calling LLM:", err);
  process.exit(1);
});
