import express from 'express';
import { privacyRoutes } from './privacy.js';
import session from 'express-session';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteSessionStore, DatabaseRateLimitStore, getSetting, setSetting, getConnection, setConnection } from './db.js';
import { csrfToken, safeEqual, validSignature, hashPassword, verifyPassword } from './security.js';
import { validateAutomation, matchesKeyword, UserError } from './validation.js';
import { MetaError } from './instagram.js';
import * as views from './views.js';
const directory = path.dirname(fileURLToPath(import.meta.url));
export async function createApp({ db, config, instagram, engine, wakeWorker = async () => {} }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(helmet({ referrerPolicy: { policy: 'same-origin' }, contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'form-action': ["'self'"], 'upgrade-insecure-requests': config.production ? [] : null } }, strictTransportSecurity: config.production ? undefined : false }));
  app.use((req, res, next) => {res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');next();});
  app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
  privacyRoutes(app, config);
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/assets', express.static(path.join(directory, '../public'), { index: false, dotfiles: 'deny' }));
  app.get('/webhooks/instagram', async (req, res) => {
    if (req.query['hub.mode'] !== 'subscribe' || !safeEqual(req.query['hub.verify_token'], config.verifyToken) || typeof req.query['hub.challenge'] !== 'string') return res.sendStatus(403);
    await setSetting(db, 'webhook_verified', String(Date.now()));
    res.type('text/plain').send(req.query['hub.challenge']);
  });
  app.post('/webhooks/instagram', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    const connection = await getConnection(db, config);
    if (!connection || !Buffer.isBuffer(req.body) || !validSignature(req.body, req.get('x-hub-signature-256'), connection.appSecret)) return res.sendStatus(403);
    try {
      const payload = JSON.parse(req.body.toString('utf8'));
      if (!payload || typeof payload !== 'object') return res.sendStatus(400);
      await engine.ingest(payload);
      await wakeWorker();
      res.sendStatus(200);
    } catch (e) {
      res.sendStatus(e instanceof SyntaxError || e instanceof UserError ? 400 : 503);
    }
  });
  await db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run('password_hash', config.passwordHash);
  await db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run('auth_version', randomUUID());
  app.use('/admin', (req, res, next) => {res.set('Cache-Control', 'no-store');next();});
  app.use('/admin', session({ name: 'littlechat.sid', secret: config.sessionSecret, store: new SqliteSessionStore(db),
    resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'strict', secure: config.production, maxAge: 12 * 3600000, path: '/admin' } }));
  app.use('/admin', express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 30 }));
  app.use('/admin', (req, res, next) => {
    req.session.csrf ||= csrfToken();
    res.locals.csrf = req.session.csrf;
    next();
  });
  const loginLimiter = rateLimit({ store: new DatabaseRateLimitStore(db, 'login'), windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests: true,
    handler: (req, res) => res.status(429).send(views.login(res.locals.csrf, 'Too many attempts. Try again in 15 minutes.')) });
  app.post('/admin/login', loginLimiter);
  app.use('/admin', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const origin = req.get('origin');
    if (origin && origin !== config.appUrl || !safeEqual(req.body?._csrf, req.session.csrf)) return res.status(403).send(views.errorPage('This form expired. Reload the page and try again.'));
    next();
  });
  async function signedIn(req) {return req.session.admin === true && req.session.authVersion === (await getSetting(db, 'auth_version'));}
  app.get('/admin/login', async (req, res) => (await signedIn(req)) ? res.redirect(303, '/admin') : res.send(views.login(res.locals.csrf)));
  app.post('/admin/login', async (req, res, next) => {
    if (!(await verifyPassword(req.body.password, await getSetting(db, 'password_hash')))) return res.status(401).send(views.login(res.locals.csrf, 'Incorrect password. Try again.'));
    const authVersion = await getSetting(db, 'auth_version');
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.admin = true;
      req.session.authVersion = authVersion;
      req.session.csrf = csrfToken();
      req.session.save((err) => err ? next(err) : res.redirect(303, '/admin'));
    });
  });
  app.use('/admin', async (req, res, next) => (await signedIn(req)) ? next() : res.redirect(303, '/admin/login'));
  function render(req, res, title, section, content) {
    const flash = req.session.flash;
    delete req.session.flash;
    res.send(views.layout({ title, section, csrf: res.locals.csrf, content, flash }));
  }
  function redirect(req, res, url, text, error = false) {
    req.session.flash = { text, error };
    res.redirect(303, url);
  }
  async function settingsView(req, res) {
    const connection = await getConnection(db, config);
    render(req, res, 'Instagram setup', 'settings', views.settings({ csrf: res.locals.csrf, connection, config,
      verified: await getSetting(db, 'webhook_verified'), lastWebhook: await getSetting(db, 'last_webhook') }));
  }
  app.post('/admin/logout', (req, res, next) => req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('littlechat.sid', { path: '/admin' }).redirect(303, '/admin/login');
  }));
  app.get('/admin', async (req, res) => {
    const rules = await db.prepare('SELECT * FROM automations ORDER BY created_at DESC').all();
    const connection = await getConnection(db, config);
    const problems = (await db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('failed','review')").get()).n;
    render(req, res, 'Automations', 'automations', views.dashboard(rules, connection, res.locals.csrf, problems));
  });
  app.get('/admin/automations/new', (req, res) => render(req, res, 'New automation', 'automations', views.automationForm({}, res.locals.csrf)));
  app.get('/admin/automations/:id', async (req, res) => {
    const rule = await db.prepare('SELECT * FROM automations WHERE id=?').get(req.params.id);
    if (!rule) return res.status(404).send(views.errorPage('Automation not found.'));
    render(req, res, 'Edit automation', 'automations', views.automationForm(rule, res.locals.csrf));
  });
  async function saveRule(req, res) {
    const existing = req.params.id ? await db.prepare('SELECT * FROM automations WHERE id=?').get(req.params.id) : null;
    if (req.params.id && !existing) return res.status(404).send(views.errorPage('Automation not found.'));
    try {
      const rule = validateAutomation(req.body);
      const id = existing?.id || randomUUID();
      const connection = await getConnection(db, config);
      const enable = req.body.intent === 'enable';
      let mediaId = existing?.shortcode === rule.shortcode ? existing.media_id : null;
      if (enable) {
        if (!connection?.ready) throw new UserError('Connect Instagram and enable webhooks in Instagram setup first. You can save a draft now.');
        if (!mediaId) mediaId = await instagram.resolveMedia(connection, rule.shortcode);
        if ((await getConnection(db, config))?.token !== connection.token) throw new UserError('Instagram connection changed. Save again.');
        const overlaps = await db.prepare('SELECT keywords FROM automations WHERE enabled=1 AND media_id=? AND id<>?').all(mediaId, id);
        const keywords = JSON.parse(rule.keywords);
        if (overlaps.some((r) => JSON.parse(r.keywords).some((k) => keywords.includes(k)))) throw new UserError('Another active automation uses one of these keywords for this reel. Edit or pause it first.');
      }
      await db.transaction(async () => {
        await db.prepare(`INSERT INTO automations(id,name,reel_url,shortcode,media_id,keywords,dm,comment_reply,followup,enabled,created_at,active_since)
          VALUES(@id,@name,@reel_url,@shortcode,@media_id,@keywords,@dm,@comment_reply,@followup,@enabled,@created_at,@active_since)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name,reel_url=excluded.reel_url,shortcode=excluded.shortcode,
          media_id=excluded.media_id,keywords=excluded.keywords,dm=excluded.dm,comment_reply=excluded.comment_reply,followup=excluded.followup,enabled=excluded.enabled,active_since=excluded.active_since`).run({
          ...rule, id, media_id: mediaId, enabled: enable ? 1 : 0, created_at: existing?.created_at || Date.now(), active_since: enable ? Date.now() : null
        });
        // Editing supersedes queued old copy. Never alter a request already in flight.
        await db.prepare("UPDATE jobs SET status='cancelled',error='Automation edited or paused.' WHERE automation_id=? AND status IN ('pending','failed','review')").run(id);
        await db.prepare('DELETE FROM conversations WHERE automation_id=?').run(id);
      })();
      redirect(req, res, '/admin', enable ? 'Automation is on. New matching comments will trigger your replies.' : 'Draft saved. No messages will be sent.');
    } catch (e) {
      if (!(e instanceof UserError || e instanceof MetaError)) throw e;
      res.status(422);
      const values = { ...req.body, id: existing?.id, enabled: existing?.enabled || 0, keywords: JSON.stringify(typeof req.body.keywords === 'string' ? req.body.keywords.split(',') : []) };
      render(req, res, existing ? 'Edit automation' : 'New automation', 'automations', views.automationForm(values, res.locals.csrf, e.message));
    }
  }
  app.post('/admin/automations', saveRule);
  app.post('/admin/automations/:id', saveRule);
  app.post('/admin/automations/:id/pause', async (req, res) => {
    await db.transaction(async () => {
      await db.prepare('UPDATE automations SET enabled=0 WHERE id=?').run(req.params.id);
      await db.prepare("UPDATE jobs SET status='cancelled',error='Automation paused.' WHERE automation_id=? AND status='pending'").run(req.params.id);
      await db.prepare('DELETE FROM conversations WHERE automation_id=?').run(req.params.id);
    })();
    redirect(req, res, '/admin', 'Automation paused. A delivery already in progress may finish.');
  });
  app.post('/admin/preview', (req, res) => {
    const keywords = typeof req.body.keywords === 'string' ? req.body.keywords.split(',').map((k) => k.trim().normalize('NFKC').toLowerCase()).filter(Boolean) : [];
    const comment = typeof req.body.comment === 'string' ? req.body.comment : '';
    if (keywords.length > 20 || keywords.some((k) => k.length > 50) || comment.length > 1000) return res.status(422).json({ error: 'Input too long.' });
    res.json({ matches: matchesKeyword(comment, keywords) });
  });
  app.get('/admin/activity', async (req, res) => {
    const page = Math.max(1, Math.min(1000000, Number.parseInt(req.query.page, 10) || 1));
    const jobs = await db.prepare(`SELECT j.*,a.name automation_name,d.status dependency_status FROM jobs j JOIN automations a ON a.id=j.automation_id
      LEFT JOIN jobs d ON d.id=j.depends_on ORDER BY j.id DESC LIMIT 51 OFFSET ?`).all((page - 1) * 50);
    render(req, res, 'Activity', 'activity', views.activity(jobs.slice(0, 50), res.locals.csrf, page, jobs.length > 50));
  });
  app.post('/admin/jobs/:id/retry', async (req, res) => {
    const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
    const rule = job && (await db.prepare('SELECT * FROM automations WHERE id=?').get(job.automation_id));
    if (!job || !['failed', 'review'].includes(job.status)) return redirect(req, res, '/admin/activity', 'This delivery cannot be retried.', true);
    if (!rule?.enabled || !(await getConnection(db, config))?.ready) return redirect(req, res, '/admin/activity', 'Reconnect Instagram and turn on the automation before retrying.', true);
    if (job.expires_at <= Date.now()) return redirect(req, res, '/admin/activity', 'The messaging window has closed.', true);
    if (job.status === 'review' && req.body.checked !== 'yes') return redirect(req, res, '/admin/activity', 'Check Instagram and confirm the message was not already sent.', true);
    await db.prepare("UPDATE jobs SET status='pending',due_at=?,attempts=0,error=NULL WHERE id=?").run(Date.now(), job.id);
    await wakeWorker();
    redirect(req, res, '/admin/activity', 'Delivery queued for another attempt.');
  });
  app.post('/admin/jobs/:id/dismiss', async (req, res) => {
    await db.prepare("UPDATE jobs SET status='cancelled',error='Dismissed by the owner.' WHERE id=? AND status IN ('review','failed','pending')").run(req.params.id);
    redirect(req, res, '/admin/activity', 'Delivery dismissed.');
  });
  app.get('/admin/settings', settingsView);
  app.post('/admin/settings/connect', async (req, res) => {
    try {
      const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
      const secret = typeof req.body.app_secret === 'string' ? req.body.app_secret.trim() : '';
      if (!token || token.length > 4096 || !/^[a-f\d]{32}$/i.test(secret)) throw new UserError('Enter your Instagram access token and the 32-character Meta app secret.');
      const account = await instagram.identify(token);
      const old = await getConnection(db, config);
      if (old && old.id !== account.id) throw new UserError('Disconnect the current account before connecting a different Instagram account.');
      await setConnection(db, config, { ...account, token, appSecret: secret, ready: false, connectedAt: Date.now() });
      await setSetting(db, 'refresh_attempt', String(Date.now()));
      redirect(req, res, '/admin/settings', `Connected @${account.username}. Complete webhook setup below to receive comments.`);
    } catch (e) {
      if (!(e instanceof UserError || e instanceof MetaError)) throw e;
      redirect(req, res, '/admin/settings', e.message, true);
    }
  });
  app.post('/admin/settings/subscribe', async (req, res) => {
    const connection = await getConnection(db, config);
    if (!connection || !(await getSetting(db, 'webhook_verified'))) return redirect(req, res, '/admin/settings', 'Connect Instagram, then verify the webhook in your Meta app first.', true);
    try {
      await instagram.subscribe(connection);
      if ((await getConnection(db, config))?.token !== connection.token) throw new UserError('Connection changed. Try again.');
      await setConnection(db, config, { ...connection, ready: true });
      redirect(req, res, '/admin/settings', 'Instagram subscribed to comments and messages. You can turn on your automations.');
    } catch (e) {
      if (!(e instanceof UserError || e instanceof MetaError)) throw e;
      redirect(req, res, '/admin/settings', e.message, true);
    }
  });
  app.post('/admin/settings/refresh', async (req, res) => {
    const connection = await getConnection(db, config);
    if (!connection) return redirect(req, res, '/admin/settings', 'Connect Instagram first.', true);
    try {
      const fresh = await instagram.refresh(connection);
      if ((await getConnection(db, config))?.token === connection.token) await setConnection(db, config, fresh);
      await setSetting(db, 'refresh_attempt', String(Date.now()));
      redirect(req, res, '/admin/settings', 'Instagram token refreshed.');
    } catch (e) {
      if (!(e instanceof UserError || e instanceof MetaError)) throw e;
      redirect(req, res, '/admin/settings', 'Token refresh failed. Tokens must be long-lived and at least 24 hours old. Generate a new token in Meta if needed.', true);
    }
  });
  app.post('/admin/settings/disconnect', async (req, res) => {
    await db.transaction(async () => {
      await db.prepare("DELETE FROM settings WHERE key IN ('instagram','webhook_verified','last_webhook','refresh_attempt')").run();
      await db.prepare('UPDATE automations SET enabled=0,media_id=NULL').run();
      await db.prepare("UPDATE jobs SET status='cancelled',error='Instagram disconnected.' WHERE status IN ('pending','failed','review')").run();
      await db.prepare('DELETE FROM conversations').run();
    })();
    redirect(req, res, '/admin/settings', 'Account disconnected locally and automations paused. Revoke the app in Instagram to remove its access there.');
  });
  app.post('/admin/settings/password', rateLimit({ store: new DatabaseRateLimitStore(db, 'password'), windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
    if (!(await verifyPassword(req.body.current_password, await getSetting(db, 'password_hash')))) return redirect(req, res, '/admin/settings', 'Current password is incorrect.', true);
    const password = req.body.new_password;
    if (typeof password !== 'string' || password.length < 12 || password.length > 200) return redirect(req, res, '/admin/settings', 'Use a password between 12 and 200 characters.', true);
    const hash = await hashPassword(password);
    const version = randomUUID();
    await db.transaction(async () => {
      await setSetting(db, 'password_hash', hash);
      await setSetting(db, 'auth_version', version);
      await db.prepare('DELETE FROM sessions').run();
    })();
    req.session.authVersion = version;
    req.session.csrf = csrfToken();
    redirect(req, res, '/admin/settings', 'Password updated. Other sessions have been signed out.');
  });
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    // Never log request bodies, credentials, tokens, or full Graph URLs.
    console.error(`Request failed: ${err.name || 'Error'}`);
    const status = err.status === 413 ? 413 : 500;
    res.status(status).send(views.errorPage(status === 413 ? 'That request is too large.' : 'Something went wrong. Reload and try again.'));
  });
  return app;
}
