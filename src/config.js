export function loadConfig(env = process.env) {
  const config = {
    privacyContact: env.PRIVACY_CONTACT, privacyProviders: env.PRIVACY_PROVIDERS,
    port: Number(env.PORT || 3000), host: env.HOST || '127.0.0.1',
    appUrl: env.APP_URL || 'http://127.0.0.1:3000', databasePath: env.TURSO_DATABASE_URL || env.DATABASE_PATH || './data/little-chat.sqlite',
    databaseToken: env.TURSO_AUTH_TOKEN, cronSecret: env.CRON_SECRET, serverless: env.VERCEL === '1',
    sessionSecret: env.SESSION_SECRET, encryptionKey: env.ENCRYPTION_KEY,
    passwordHash: env.ADMIN_PASSWORD_HASH, verifyToken: env.WEBHOOK_VERIFY_TOKEN,
    apiVersion: env.META_API_VERSION || 'v24.0', production: env.NODE_ENV === 'production',
    trustProxy: Number(env.TRUST_PROXY || 0)
  };
  if (!config.sessionSecret || config.sessionSecret.length < 32 || !/^[a-f0-9]{64}$/.test(config.encryptionKey || '') ||
      !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(config.passwordHash || '') || !config.verifyToken || config.verifyToken.length < 32) {
    throw new Error('Missing or invalid secrets. Run npm run setup first.');
  }
  if (config.serverless && (!/^libsql:\/\//.test(config.databasePath) || !config.databaseToken || !config.cronSecret)) throw new Error('Vercel requires Turso credentials and CRON_SECRET.');
  const url = new URL(config.appUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('APP_URL must be a plain http(s) origin.');
  if (config.production && url.protocol !== 'https:') throw new Error('Production requires an HTTPS APP_URL.');
  if (!/^v\d+\.0$/.test(config.apiVersion)) throw new Error('Invalid META_API_VERSION.');
  if (![0, 1].includes(config.trustProxy)) throw new Error('TRUST_PROXY must be 0 or 1.');
  config.appUrl = url.origin;
  return config;
}
