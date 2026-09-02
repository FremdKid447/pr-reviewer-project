# AI Agent PR Reviewer

An automated GitHub pull request reviewer that uses Claude to analyze diffs, identify issues, and post structured review comments directly on PRs.

## Features

- **Automated diff analysis** — Fetches PR diffs via GitHub API and sends them to Claude for intelligent review
- **Structured reviews** — Uses class-validator to ensure reviews conform to a strict schema
- **Multiple comment types** — Posts summary comments to PR conversation and inline findings on specific code lines
- **Smart comment management** — Detects and deletes previous bot comments before posting fresh reviews
- **Selective triggering** — Only runs reviews on PR `opened`, `reopened`, and `synchronize` events
- **Robust validation** — Validates all LLM responses against TypeScript DTOs with decorators

## Setup

### Prerequisites

- Node.js 18+
- A GitHub account with repo write access
- An Anthropic API key
- ngrok or similar tool to expose your local server

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in your `.env` file with:
- `ANTHROPIC_API_KEY` — Get from https://console.anthropic.com/settings/keys
- `GITHUB_TOKEN` — Personal access token with repo and issues/PR write access
- `GITHUB_WEBHOOK_SECRET` — Generate a random string for webhook verification

### 3. Start the webhook server

```bash
npm run dev
```

You should see:
```
Webhook receiver listening at http://0.0.0.0:3000
Authenticated as: <your-bot-username>
```

Check health: `curl http://localhost:3000/health`

### 4. Expose to the internet

GitHub needs to reach your server, so use ngrok:

```bash
ngrok http 3000
```

Copy the `https://<subdomain>.ngrok-free.app` URL.

### 5. Add GitHub webhook

On your test repository:
1. Go to **Settings → Webhooks → Add webhook**
2. **Payload URL:** `https://<your-ngrok-subdomain>.ngrok-free.app/webhook`
3. **Content type:** `application/json`
4. **Events:** Select "Pull requests"
5. Save

### 6. Test it

Open a pull request on your test repo. The bot should:
- Detect the PR event
- Fetch the diff
- Call Claude for a review
- Delete any previous bot comments
- Post a summary comment and inline findings

## How it works

### Webhook flow

1. GitHub sends a `pull_request` webhook event
2. Server validates the signature and extracts PR context
3. Only proceeds if action is `opened`, `reopened`, or `synchronize`
4. Fetches the full PR diff from GitHub API
5. Sends diff to Claude with a structured review prompt
6. Validates response with class-validator
7. Deletes previous bot comments (identified by marker + username)
8. Posts fresh summary comment and inline findings

### Review schema

Each review includes:
- **summary** — High-level overview of the changes
- **overall_risk** — Risk level (low, medium, high, critical)
- **findings** — Array of specific issues with:
  - id, severity, category, title, description
  - file path, line number, evidence, suggestion
  - confidence percentage (0-100)
- **no_obvious_issues** — Boolean flag

### Bot comment identification

The bot uses a dual strategy to avoid deleting manual comments:
1. Checks that the comment author matches the authenticated bot username
2. Looks for a hidden HTML marker: `<!-- AI_REVIEWER_BOT -->`

Both conditions must be true to delete a comment.

## Available scripts

- `npm run dev` — Start the webhook server with live reload
- `npm run llm-test` — Test LLM review on a hardcoded sample diff

## Project structure

```
src/
  server.ts              # Main webhook receiver and orchestrator
  llm-test.ts           # Standalone LLM testing script
  types/
    diff-review.ts      # Review DTO with class-validator decorators
    diff-review-finding.ts  # Finding DTO and enums
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | API key for Claude |
| `GITHUB_TOKEN` | Yes | GitHub personal access token |
| `GITHUB_WEBHOOK_SECRET` | Yes | Webhook signature secret |
| `PORT` | No | Server port (default: 3000) |

## Troubleshooting

### 403 "Must have admin rights to Repository"

Your GitHub token doesn't have write access to the target repo. Verify:
- Token has "Issues" and "Pull Requests" write permissions
- Token is not from a different GitHub organization
- Repo is not restricted to a different app

### 404 on inline review comments

The commit ID or file path doesn't match the PR diff. Ensure:
- Using the correct PR head SHA
- File exists in the changed files for that PR
- Line number is within the changed region

### LLM response not valid JSON

The model ignored the "respond only with JSON" instruction. The server has error handling for this, but you can:
- Check the raw LLM response in logs
- Tighten the system prompt
- Try a different model

## Future improvements

- Configurable filtering (e.g., ignore certain files, minimum severity levels)
- Comment pagination for PRs with many findings
- Review batching and threading
- Customizable review prompt templates
- Per-repo configuration
- Performance metrics and logging

## License

MIT
