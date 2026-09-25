# Little Chat

A private, single-owner alternative for Instagram comment automations. Open `/admin`, log in, paste your reel link, choose keywords and write your replies. There is no public homepage or admin link; `/` returns 404. Authentication protects all admin screens and actions.

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

Create your own Vercel project from your fork. Do not connect a new installation to another operator’s database or reuse their secrets.

Production uses **Turso hosted SQLite** through `@libsql/client`, and **Vercel Queues** to wake the delivery worker. Local development uses the same async database interface with a local SQLite file. The old always-running worker is used only by `npm start`, never by Vercel.

1. Create a free Turso database in the Vercel project's Storage section, then connect it to the project. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
2. Run `npm ci` and `npm run setup` locally to generate your own secrets. Copy those values into Vercel’s production environment settings. Set production `SESSION_SECRET`, `ENCRYPTION_KEY`, `ADMIN_PASSWORD_HASH`, `WEBHOOK_VERIFY_TOKEN`, `CRON_SECRET`, `APP_URL`, `NODE_ENV=production`, and `TRUST_PROXY=1`. Setup generates `CRON_SECRET` too. Set `PRIVACY_CONTACT` to your public contact instructions and `PRIVACY_PROVIDERS` to your actual hosting/database providers (for this deployment: Vercel and Turso). Never share the generated files.
3. **Fresh installation:** use an empty Turso database; the app creates its schema on first startup. No migration is needed. **Existing installation only:** migrate the local data using `node --env-file=.env --env-file=.env.production.local scripts/migrate-to-turso.js`. The second file must contain the destination Turso credentials. The script refuses a nonempty destination, transfers encrypted credentials without printing them, excludes sessions, and pauses automations. Preserve the local encryption key in production.
4. Deploy `main`. `vercel.json` configures a private queue consumer and daily maintenance cron. Webhooks persist events and enqueue a wakeup before acknowledging Meta; a queue failure returns 503 so Meta can retry. Queue messages contain no Instagram data.
5. Add the deployed `/privacy` and `/data-deletion` URLs in Meta. Configure and verify `/webhooks/instagram`, publish the Meta app as required, then enable webhooks in the admin UI.
6. Test a fresh comment from another account before activating existing campaigns.

Workers claim each delivery atomically in the database. In-flight sends are left alone across cold starts. Claims older than five minutes are moved to manual review, never blindly resent. Definite throttling rejections get delayed queue wakeups. The daily cron refreshes credentials and recovers pending work if a queue notification was lost. Database failures during a send remain ambiguous and require checking Instagram.

Production creation and live delivery require service provisioning and verification; passing local tests does not establish that the deployment is live. The current Vercel Queues integration is a beta service. Hosting and database provider limits apply; no per-contact billing is built into Little Chat.

### Persistent server with Docker (simplest hosting model)

1. On a server with Node.js 22.16+, Docker Engine and Docker Compose, clone your repository and run `npm ci` then `npm run setup`.
2. Point a domain’s DNS at that server. Allow inbound ports 80 and 443.
3. In `.env`, set `APP_URL=https://chat.example.com` using your domain. Set `PRIVACY_CONTACT` and `PRIVACY_PROVIDERS` to accurate public information. Leave `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` unset to use local SQLite.
4. Run `docker compose up -d --build`. Caddy obtains HTTPS certificates; the app runs its own background delivery worker.
5. Visit `/admin`, sign in using `LOCAL_ACCESS.md`, then complete the Instagram setup above. Check `docker compose logs --tail=100 app` if startup fails; redact logs before sharing.

The `app-data` Docker volume starts empty; it does not import a host’s `data/` directory. Back up that volume and `.env` together. Never run `docker compose down -v` unless you intend to delete the database. For updates, pull reviewed changes and run `docker compose up -d --build` again.

A local-only server can be used to build drafts, but Instagram needs a publicly reachable HTTPS webhook for live delivery. A computer that sleeps cannot reliably run automations. See [the agent guide](AGENTS.md) for an installation prompt and verification checklist.

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

## Publishing a public copy

See [RELEASING.md](RELEASING.md) before changing repository visibility. Deleting private references from the latest files does not remove them from old commits.
