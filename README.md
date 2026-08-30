# Week 1 Starter — AI Agent PR Reviewer

This is a starting scaffold for Week 1 of the build plan. It gives you:
- A Fastify server that receives GitHub webhooks and logs the payload
- A standalone script that calls Claude with a sample diff and logs the review

You still need to do the setup steps yourself (that's the point — this is the
"figure out how the pieces connect" week). Follow along below.

## 1. Install dependencies

```bash
npm install
```

## 2. Set up your API key

```bash
cp .env.example .env
```

Get an Anthropic API key from https://console.anthropic.com/settings/keys and
paste it into `.env` as `ANTHROPIC_API_KEY=sk-ant-...`.

## 3. Test the LLM call first (do this before the webhook)

```bash
npm run llm-test
```

You should see a raw response logged, and (hopefully) a parsed table of
findings. If the JSON parsing fails, that's a completely normal Week 1
outcome — models don't always follow "respond only with JSON" instructions
reliably yet. Note it; you'll fix this properly in Week 2/3 with stricter
validation (`zod`).

## 4. Start the webhook server

```bash
npm run dev
```

You should see: `Webhook receiver listening at http://0.0.0.0:3000`

Check it's alive: open `http://localhost:3000/health` in a browser — you
should get back `{"status":"ok"}`.

## 5. Expose it to the internet with ngrok

GitHub needs to reach your local machine, which means you need a public URL.

- Install ngrok: https://ngrok.com/download (free account is fine)
- Run: `ngrok http 3000`
- Copy the `https://....ngrok-free.app` URL it gives you

## 6. Create a test GitHub repo and add the webhook

- Create a new (or reuse an existing throwaway) GitHub repo
- Go to **Settings → Webhooks → Add webhook**
- Payload URL: `https://<your-ngrok-subdomain>.ngrok-free.app/webhook`
- Content type: `application/json`
- Which events: choose "Let me select individual events" → check **Pull requests**
- Save

## 7. Trigger it

- Open a pull request on that repo (even a trivial one — edit a README line
  on a branch and open a PR against main)
- Watch your terminal running `npm run dev` — you should see the full PR
  payload logged, plus a line like:
  `--> action: opened, PR number: 1`

## What "done" looks like for Week 1

- [ ] `npm run llm-test` gives you a review of the sample diff
- [ ] Opening a PR on your test repo triggers a log in your local server
- [ ] You've actually read through one full webhook payload and can point to
      where the diff URL, PR number, and repo name live in it

## Where to go next

Week 2 connects these two pieces: instead of just logging the webhook
payload, you'll use it to fetch the *real* diff via the GitHub API (Octokit)
and pass that into the LLM call, then post the result back as a PR comment.
