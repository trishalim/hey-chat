export class UserError extends Error {}
export function reelCode(input) {
  try {
    const u = new URL(input);
    if (u.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(u.hostname) || u.username || u.password || u.port) throw new Error();
    const match = u.pathname.match(/^\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)\/?$/);
    if (!match) throw new Error();
    return match[1];
  } catch { throw new UserError('Paste a full Instagram reel or post link, like https://www.instagram.com/reel/ABC123/.'); }
}
export function validateAutomation(body) {
  const read = (key, limit, required = false) => {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if ((required && !value) || value.length > limit) throw new UserError(`${key.replaceAll('_', ' ')} must be ${required ? '1–' : 'at most '}${limit} characters.`);
    return value;
  };
  const name = read('name', 100, true), url = read('reel_url', 500, true);
  const shortcode = reelCode(url);
  const keywords = [...new Set(read('keywords', 500, true).split(',').map(s => s.trim().normalize('NFKC').toLowerCase()).filter(Boolean))];
  if (!keywords.length || keywords.length > 20 || keywords.some(k => k.length > 50)) throw new UserError('Use 1–20 comma-separated keywords, up to 50 characters each.');
  return { name, reel_url: `https://www.instagram.com/reel/${shortcode}/`, shortcode,
    keywords: JSON.stringify(keywords), dm: read('dm', 1000, true), comment_reply: read('comment_reply', 1000), followup: read('followup', 1000) };
}
export function matchesKeyword(text, keywords) {
  const normalized = text.normalize('NFKC').toLowerCase();
  return keywords.some(keyword => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(normalized);
  });
}
