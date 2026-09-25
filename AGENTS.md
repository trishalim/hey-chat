# Installing and maintaining Little Chat

This is a single-owner Instagram automation app. Each operator needs their own installation, Meta app, professional Instagram account, secrets, and database. It is not a public multi-user SaaS. Keep the interface simple; no design overhaul is required for setup.

## Audience and interaction

These instructions are for the coding assistant installing or maintaining this repository. README.md is the human-facing introduction. The repository is called Hey Chat; the current application UI and package still use Little Chat. Do not rename code or redesign the app during installation.

## Start with a short conversation

Inspect the working directory and available tools first. Reuse information the person already gave you. Ask only questions that affect the next step, in plain language, one or two at a time. Do not dump this guide or a long questionnaire into chat.

1. Ask whether they want to try it on their computer first or have it running online continuously. Explain that a sleeping laptop cannot run reliable automations. If unsure, start locally and revisit hosting after they have seen the app.
2. Ask whether their Instagram account is a Creator or Business account and whether they already have a Meta developer app. If they do not know, help them check. They do not need to understand API terminology before starting.
3. When ready to deploy, ask whether they already use Vercel or have an always-on server and domain. Explain the available options and current costs before provisioning anything. Ask for a budget before paid resources; do not assume free tiers are available.
4. At the Instagram connection step, guide them through authorization and any required tester invitation. Never ask them to paste their Instagram password or access token into chat. Use the app's setup form or a local ignored environment file as appropriate. Leave account login, consent, and verification steps to the person when your tools or permission rules require it.
5. Before enabling a rule, ask which reel, keyword, DM, and optional public reply they want, unless already provided. Ask whether another tool already handles that same rule so a switch can avoid duplicate replies. Do not disable another service without authorization.

Do the technical work with available terminal/browser tools. If you only have chat access, say so and give one concrete step at a time. Explain blockers precisely and keep progressing on independent setup work. Do not promise fully automatic Meta approval.

## Required repository setup before deployment

The operator's deployment repository must be **private**. This upstream project is public. GitHub forks of public repositories are public and cannot independently change visibility: https://docs.github.com/en/pull-requests/reference/forks . Do not promise a private GitHub fork or create a public fork for personal deployment. Use an independent private copy, keeping this project as an `upstream` remote for updates. Explain the distinction briefly.

1. Check the signed-in GitHub account and ask for the destination owner/name if not already provided. Inspect existing local repositories/remotes first; do not repurpose an unrelated checkout or push to the maintainer's repository.
2. For a fresh installation, clone `https://github.com/trishalim/hey-chat.git` into a new directory. Rename its `origin` remote to `upstream`. Create a new, empty **private** repository in the operator's account (for example using `gh repo create OWNER/NAME --private`, substituting the chosen owner/name). Do not generate credentials or add personal configuration until the destination has been confirmed private.
3. Verify the destination with `gh repo view OWNER/NAME --json nameWithOwner,isPrivate`. Require `isPrivate: true`. If creation/verification fails, stop the push/deployment step and resolve it. If an existing destination is public, explain the conflict and get authorization before changing its visibility; never silently use it.
4. Add the verified destination as `origin` using its actual clone URL. Review tracked files and commit attribution; keep `.env`, generated password files, database files, access tokens, and deployment account metadata out of Git, even in a private repository. Push the application branch to that private origin. Retain the MIT license and attribution.
5. Connect the hosting project to this private origin, not the public upstream. Verify the connected repository and privacy before deployment. Configure secrets in the hosting environment and isolate preview environments from production data.
6. For later updates, fetch `upstream` and review/merge changes locally before pushing to private `origin`. Do not push personal changes or open pull requests to upstream unless the operator explicitly requests a contribution.

Repository privacy and website authentication are separate. Anyone with a deployed URL may reach the login form. Confirm unauthenticated admin requests redirect to login, HTTPS is used in production, and secrets/password files are not served. The generated password must be unique to this installation. Explain that the app does not currently have two-factor authentication. Do not claim an unlinked URL is an access control. Do not put a blanket hosting login wall over the Instagram webhook; Meta must be able to reach the signed webhook endpoint.

## Workflow

1. Read .env.example, package.json, the technical reference below, and the chosen deployment configuration. Check Node.js is at least 22.16.
2. Run `npm ci`, `npm run setup`, `npm run check`, and `npm test`. Setup refuses to overwrite `.env`; do not delete existing configuration to work around that. Do not source `.env` as shell code.
3. Run `npm start`, then verify `/health` and `/admin/login`. `/` intentionally returns 404. The generated password is in ignored `LOCAL_ACCESS.md`; don't paste credentials into logs, commits, issues, or chat unless the operator specifically asks for them.
4. Choose deployment with the operator: Docker/Caddy on an always-on server, or Vercel + Turso + Vercel Queues. Do not deploy local SQLite to an ephemeral serverless filesystem. Follow the matching deployment section below. Provider pricing and beta availability must be checked at deployment time.
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

## Completion report

Tell the person where to open the app, where their password is stored, and whether it is local-only or deployed. Distinguish successful installation, webhook verification, and a real comment-to-DM test. If any stage remains incomplete, state the exact remaining action. Never describe synthetic tests as proof of live Instagram delivery.

## Technical reference

Use the relevant sections as needed; do not make the person read them all.

## Run locally

Requires Node.js 22.16 or newer.

```sh
npm ci
npm run setup
npm start
```

Open **http://127.0.0.1:3000/admin**. Your generated password is in **LOCAL_ACCESS.md**. No username or registration is needed. Change the password in Instagram setup, then delete the local password file after saving the new password in your password manager.

`npm run setup` creates `.env` and does not overwrite existing configuration. Keep `.env`, the encryption key, and the SQLite database private and backed up. Neither `.env` nor the password file is served by the website or included in Git/Docker images.

## Connect Instagram

The app code is ready to run, but live delivery requires your own Meta app, account authorization and a reachable HTTPS webhook. No Instagram credentials are bundled. Local browser tests use an isolated database and fake API responses, and never send messages.

1. Use an Instagram **Business or Creator** account.
2. Create/configure your app at [Meta for Developers](https://developers.facebook.com/apps/) with **Instagram API with Instagram Login**. This implementation does not use Facebook Page access tokens.
3. Add the Instagram account you own/manage to the app and accept any tester invitation in Instagram. Enable connected tools' access to messages in Instagram settings.
4. Configure `instagram_business_basic`, `instagram_business_manage_comments` and `instagram_business_manage_messages`. Standard/test access can serve owned accounts added to the app; Meta's access restrictions and any required review still apply. A successful developer test webhook alone does not prove that live comments will be delivered.
5. In the Meta app dashboard, open **Instagram → API setup with Instagram business login**, then **Generate token** next to your account. These dashboard tokens are long-lived (60 days). Copy this token and the app secret into **Instagram setup** in Little Chat. The app verifies the account and encrypts the stored credentials with AES-256-GCM.
6. Once hosted, set `APP_URL` to your public HTTPS origin (e.g. `https://chat.yourdomain.com`). Restart the app. In Meta's Instagram webhook settings, copy the callback URL and verify token shown inside Little Chat's setup screen. Verify/save it and select `comments` and `messages`.
7. Refresh Little Chat's setup screen and click **Enable Instagram webhooks** to subscribe the account.
8. Create an automation, paste a reel or post from that same account, and click **Save & turn on**. The app resolves the link against your account's media before activating it.
9. Leave a fresh matching comment from a different Instagram account. Check the DM, optional public reply, and Little Chat's **Activity** screen. Reply to the DM to test an optional follow-up. Pause the equivalent ManyChat rule when switching this workflow over to avoid both apps replying.

Long-lived tokens are automatically refreshed daily while the server is running. They must be at least 24 hours old and unexpired. Revoked tokens and refresh failures require reconnecting and are shown in the app.

### What an automation does

- Matches comma-separated keywords as whole words/phrases, ignoring case. `GUIDE please!` matches `guide`; `guideline` does not.
- Sends one initial private reply per matching comment, addressed with Meta's `recipient.comment_id`.
- Optionally posts a public reply only after Instagram accepts the DM.
- Optionally sends one follow-up after that person's first text reply. It must be sent within Meta's 24-hour reply window. If the person triggered multiple automations, the most recent successfully sent initial DM determines the follow-up.
- Ignores owner comments, reply comments with a parent ID, message echoes, expired incoming events, and duplicate webhook event IDs.
- Uses the oldest matching automation if more than one keyword rule matches. Exact duplicate keyword rules for a reel cannot both be activated.
- Drafts and paused automations do not send. Editing cancels queued/failed/uncertain deliveries for the previous copy and resets pending follow-up state. An already in-flight request may finish.

### Delivery and recovery

Webhook requests must pass SHA-256 signature verification. Incoming events and outgoing jobs are stored in SQLite before acknowledging Meta. A background worker sends them (a persistent process locally or queue-triggered workers on Vercel), with backoff for definite rate-limit rejections.

“Sent” means Meta accepted a request, not that the recipient saw it. Instagram may put an initial DM in Message Requests. A private reply has a seven-day limit from the comment; Instagram is the final authority on eligibility. Follow-ups require the recipient to reply first.

Timeouts, server errors and interrupted sends have an unknown outcome. They appear as **Check Instagram**, and are not automatically sent again. Check the account before retrying and confirm it was not already sent. Dismiss sends you do not want retried. Failed DMs block their public comment reply. Event IDs and delivery records survive server restarts.

## Vercel deployment

Complete the required private repository setup above, then create a Vercel project connected to that private repository. Do not connect a new installation to another operator’s database or reuse their secrets.

Production uses **Turso hosted SQLite** through `@libsql/client`, and **Vercel Queues** to wake the delivery worker. Local development uses the same async database interface with a local SQLite file. The old always-running worker is used only by `npm start`, never by Vercel.

1. Create a Turso database on a plan approved by the operator in the Vercel project's Storage section, then connect it to the project. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
2. Run `npm ci` and `npm run setup` locally to generate your own secrets. Copy those values into Vercel’s production environment settings. Set production `SESSION_SECRET`, `ENCRYPTION_KEY`, `ADMIN_PASSWORD_HASH`, `WEBHOOK_VERIFY_TOKEN`, `CRON_SECRET`, `APP_URL`, `NODE_ENV=production`, and `TRUST_PROXY=1`. Setup generates `CRON_SECRET` too. Set `PRIVACY_CONTACT` to your public contact instructions and `PRIVACY_PROVIDERS` to your actual hosting/database providers (for this deployment: Vercel and Turso). Never share the generated files.
3. **Fresh installation:** use an empty Turso database; the app creates its schema on first startup. No migration is needed. **Existing installation only:** migrate the local data using `node --env-file=.env --env-file=.env.production.local scripts/migrate-to-turso.js`. The second file must contain the destination Turso credentials. The script refuses a nonempty destination, transfers encrypted credentials without printing them, excludes sessions, and pauses automations. Preserve the local encryption key in production.
4. Deploy `main`. `vercel.json` configures a private queue consumer and daily maintenance cron. Webhooks persist events and enqueue a wakeup before acknowledging Meta; a queue failure returns 503 so Meta can retry. Queue messages contain no Instagram data.
5. Add the deployed `/privacy` and `/data-deletion` URLs in Meta. Configure and verify `/webhooks/instagram`, publish the Meta app as required, then enable webhooks in the admin UI.
6. Test a fresh comment from another account before activating existing campaigns.

Workers claim each delivery atomically in the database. In-flight sends are left alone across cold starts. Claims older than five minutes are moved to manual review, never blindly resent. Definite throttling rejections get delayed queue wakeups. The daily cron refreshes credentials and recovers pending work if a queue notification was lost. Database failures during a send remain ambiguous and require checking Instagram.

Production creation and live delivery require service provisioning and verification; passing local tests does not establish that the deployment is live. The current Vercel Queues integration is a beta service. Hosting and database provider limits apply; no per-contact billing is built into Little Chat.

### Persistent server with Docker (simplest hosting model)

1. On a server with Node.js 22.16+, Docker Engine and Docker Compose, clone your verified private deployment repository and run `npm ci` then `npm run setup`.
2. Point a domain’s DNS at that server. Allow inbound ports 80 and 443.
3. In `.env`, set `APP_URL=https://chat.example.com` using your domain. Set `PRIVACY_CONTACT` and `PRIVACY_PROVIDERS` to accurate public information. Leave `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` unset to use local SQLite.
4. Run `docker compose up -d --build`. Caddy obtains HTTPS certificates; the app runs its own background delivery worker.
5. Visit `/admin`, sign in using `LOCAL_ACCESS.md`, then complete the Instagram setup above. Check `docker compose logs --tail=100 app` if startup fails; redact logs before sharing.

The `app-data` Docker volume starts empty; it does not import a host’s `data/` directory. Back up that volume and `.env` together. Never run `docker compose down -v` unless you intend to delete the database. For updates, pull reviewed changes and run `docker compose up -d --build` again.

A local-only server can be used to build drafts, but Instagram needs a publicly reachable HTTPS webhook for live delivery. A computer that sleeps cannot reliably run automations. Use the workflow above to guide the operator through setup and verification.

## Password recovery

With local shell access and the correct `.env`:

```sh
npm run reset-password
```

This resets the password in the configured database, invalidates sessions, and writes the new password into `LOCAL_ACCESS.md`. Changing `ADMIN_PASSWORD_HASH` in `.env` alone does not reset an existing database; it seeds only the first login.

For Docker, reset inside the app container, then read its local password file:

```sh
docker compose exec app node scripts/reset-password.js
docker compose exec app cat data/LOCAL_ACCESS.md
```

## Verification

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

The backend suite exercises authorization, CSRF, password attempts, signed webhooks, duplicate deliveries, matching, activation, pause, message windows, restart recovery, retry behavior, credential storage and the Graph adapter. Browser checks exercise the complete login → draft creation → preview → validation → settings → logout flow at desktop and mobile widths. Screenshots are saved in `test-results/` (ignored).

## API references

- [Meta's Instagram setup guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started/)
- [Meta's maintained Instagram API collection](https://github.com/fbsamples/messenger-platform-samples/blob/main/postman/instagram-platform-api.postman_collection.json), including private replies, comment replies, webhook formats and account subscriptions
- [Refresh long-lived access tokens](https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/)

`META_API_VERSION` defaults to `v24.0` and can be updated to a supported version from your Meta app dashboard. No Instagram password, browser scraping, OAuth signup service, public user registration, AI replies, or multi-account management is required for this single-owner setup.
