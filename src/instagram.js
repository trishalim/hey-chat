import { reelCode, UserError } from './validation.js';
export class MetaError extends Error {
  constructor(message, { retryable = false, ambiguous = false } = {}) {
    super(message); this.retryable = retryable; this.ambiguous = ambiguous;
  }
}
export class Instagram {
  constructor(config, fetcher = fetch) { this.version = config.apiVersion; this.fetcher = fetcher; }
  async request(connection, path, { method = 'GET', body, query = {} } = {}) {
    const url = new URL(`https://graph.instagram.com/${this.version}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return this.perform(url, connection.token, method, body);
  }
  async perform(url, token, method = 'GET', body) {
    let response;
    try {
      response = await this.fetcher(url, { method, signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch {
      throw new MetaError('Instagram did not confirm the request. Check Instagram before retrying.', { ambiguous: method === 'POST' });
    }
    let data;
    try { data = await response.json(); } catch {
      throw new MetaError('Instagram returned an unreadable response. Check Instagram before retrying.', { ambiguous: method === 'POST' });
    }
    if (!response.ok || data.error) {
      const code = data.error?.code;
      // Only retry a definite throttling rejection. Timeouts/5xx can follow an accepted send.
      const retryable = response.status < 500 && Boolean(data.error) && (response.status === 429 || [4, 17, 32, 613].includes(code));
      const message = code === 190 ? 'Instagram access token expired or was revoked. Reconnect in Instagram setup.'
        : [10, 200].includes(code) ? 'Instagram denied permission. Check your Meta app permissions and account access.'
        : retryable ? 'Instagram rate limit reached. Retrying shortly.'
        : `Instagram rejected the request (HTTP ${response.status}${code ? `, code ${code}` : ''}). Check permissions, messaging limits, and the recipient in Instagram.`;
      throw new MetaError(message, { retryable, ambiguous: method === 'POST' && response.status >= 500 });
    }
    return data;
  }
  async identify(token) {
    const response = await this.request({ token }, 'me', { query: { fields: 'user_id,username' } });
    const data = Array.isArray(response.data) ? response.data[0] : response;
    if (!data?.user_id || !data.username) throw new UserError('Use an Instagram User access token from Instagram API with Instagram Login.');
    return { id: String(data.user_id), username: data.username };
  }
  async resolveMedia(connection, shortcode) {
    let after;
    // Paginate the owner's media only. Never fetch a user-supplied URL.
    for (let page = 0; page < 100; page++) {
      const data = await this.request(connection, `${connection.id}/media`, {
        query: { fields: 'id,permalink', limit: '100', ...(after ? { after } : {}) }
      });
      for (const media of data.data || []) {
        try { if (reelCode(media.permalink) === shortcode) return String(media.id); } catch { /* A non-post media URL. */ }
      }
      if (!data.paging?.next || !data.paging?.cursors?.after) break;
      after = data.paging.cursors.after;
    }
    throw new UserError('That reel was not found on the connected Instagram account. Check the link and that you own the reel.');
  }
  async subscribe(connection) {
    const result = await this.request(connection, `${connection.id}/subscribed_apps`, { method: 'POST', body: { subscribed_fields: ['comments', 'messages'] } });
    if (result.success !== true) throw new UserError('Instagram did not confirm the webhook subscription. Check your Meta app setup.');
  }
  async send(connection, job) {
    const isComment = job.kind === 'comment';
    const body = isComment ? { message: job.text }
      : { recipient: job.kind === 'dm' ? { comment_id: job.target } : { id: job.target }, message: { text: job.text } };
    const result = await this.request(connection, isComment ? `${job.target}/replies` : `${connection.id}/messages`, { method: 'POST', body });
    if (!(isComment ? result.id : result.message_id)) throw new MetaError('Instagram did not return a delivery ID. Check Instagram before retrying.', { ambiguous: true });
    return result;
  }
  async refresh(connection) {
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    // Meta documents this unversioned endpoint with the token in the query.
    url.searchParams.set('access_token', connection.token);
    const result = await this.perform(url, connection.token);
    if (!result.access_token || !Number.isFinite(result.expires_in)) throw new UserError('Could not refresh this token. Generate a new long-lived token in Meta and reconnect.');
    return { ...connection, token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000, refreshedAt: Date.now(), refreshError: null };
  }
}
