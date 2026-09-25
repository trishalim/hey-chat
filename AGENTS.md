# Installing and maintaining Little Chat

This is a single-owner Instagram automation app. Each operator needs their own installation, Meta app, professional Instagram account, secrets, and database. It is not a public multi-user SaaS. Keep the interface simple; no design overhaul is required for setup.

## Suggested user prompt

> Install Little Chat from this repository. Read AGENTS.md and README.md first. Get it running locally, then help me deploy it. Ask which hosting provider I want before creating paid resources. Generate fresh secrets without printing them in chat. Guide me through the Meta account steps you cannot complete. Verify a real comment-to-DM delivery before saying the integration works.

## Workflow

1. Read README.md, .env.example, package.json, and the chosen deployment configuration. Check Node.js is at least 22.16.
2. Run `npm ci`, `npm run setup`, `npm run check`, and `npm test`. Setup refuses to overwrite `.env`; do not delete existing configuration to work around that. Do not source `.env` as shell code.
3. Run `npm start`, then verify `/health` and `/admin/login`. `/` intentionally returns 404. The generated password is in ignored `LOCAL_ACCESS.md`; don't paste credentials into logs, commits, issues, or chat unless the operator specifically asks for them.
4. Choose deployment with the operator: Docker/Caddy on an always-on server, or Vercel + Turso + Vercel Queues. Do not deploy local SQLite to an ephemeral serverless filesystem. Follow the matching README section. Provider pricing and beta availability must be checked at deployment time.
5. Generate unique secrets per independent installation. A migration of an existing encrypted database must preserve its encryption key. An empty new database does not need the migration script. Never point tests or preview deployments at a production database.
6. Configure accurate public privacy contact/provider text. Meta account authorization, tester acceptance, business verification, and app review may require the operator. Do not claim publishing a Meta app grants all permissions. Consult the linked official documentation for current requirements.
7. Verify the HTTPS webhook and account subscription. Keep new rules paused until the operator is ready. Obtain an authorized real test comment from another Instagram account; check private reply, public reply, and Activity. Synthetic tests do not prove live delivery.

## Maintenance

- Check current Git status before editing. Use the existing async database and queue interfaces.
- Never log tokens, app secrets, webhook verify tokens, session cookies, or raw private webhook payloads.
- Preserve atomic job claims and duplicate-event protection. An ambiguous send must remain manual review; never retry it blindly.
- Back up the database and encryption key together. Do not reset or wipe a running installation as part of setup.
- Run `npm run check` and `npm test` after backend changes. `npm run test:browser` uses isolated test data and requires Playwright Chromium (`npx playwright install chromium`).
- Do not change repository visibility, force-push history, or replace a live deployment just to create a public source release. Follow RELEASING.md.
