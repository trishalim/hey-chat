const escapeHtml = (value) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function privacyRoutes(app, config = {}) {
const contact = escapeHtml(config.privacyContact || 'the Instagram account that sent you the automated reply (via Instagram DM)');
const providers = escapeHtml(config.privacyProviders || 'the hosting and database providers selected by the account operator');
const pages = {
  '/privacy': `<h1>Little Chat privacy policy</h1>
<p>Updated September 24, 2026.</p>
<p>Little Chat is a private tool operated by the connected Instagram account owner. It sends requested automated replies when someone comments a configured keyword or replies to an automated message.</p>
<h2>Information processed</h2>
<p>The tool receives relevant Instagram comment and message events, including account identifiers, comment and message identifiers, text, media identifiers and timestamps. It stores automation instructions, delivery records and conversation identifiers so it can send replies and avoid duplicates. Incoming comment and message text is processed for matching; the full incoming message is not saved as a conversation transcript.</p>
<h2>Use and service providers</h2>
<p>Information is used to operate replies, maintain account access, prevent duplicate sends and investigate delivery problems. Meta provides Instagram access. Hosting and data storage are provided by ${providers}. Little Chat does not sell this information or use it for advertising.</p>
<h2>Security and retention</h2>
<p>Administration requires a password. Instagram credentials are encrypted in the database. Delivery records and event identifiers are retained to prevent duplicate messages and support troubleshooting, until removed by the operator. Conversation matching state is removed after 90 days. Server sessions expire after 12 hours.</p>
<h2>Your choices</h2>
<p>You can stop interacting with the automation or contact ${contact} with privacy questions or to request deletion. The account owner can disconnect Little Chat and revoke access in Instagram’s Apps and Websites settings.</p>
<p><a href="/data-deletion">Data deletion instructions</a></p>`,
  '/data-deletion': `<h1>Request data deletion</h1>
<p>Contact ${contact} asking to delete your Little Chat data. Include the Instagram username that interacted with the automation. Do not send passwords or access tokens.</p>
<p>The operator may ask you to confirm the request from that Instagram account, then remove associated stored delivery and conversation records. Removing data held by Little Chat does not remove messages already delivered to Instagram; use Instagram’s own controls for those messages.</p>
<p>The connected account owner can also revoke Little Chat’s access through Instagram’s Apps and Websites settings.</p>`
};
  for (const [url, body] of Object.entries(pages)) app.get(url, (_req, res) => res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Little Chat — Privacy</title><body><main>${body}</main></body></html>`));
}
