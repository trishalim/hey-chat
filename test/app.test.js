import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomBytes, createHmac } from 'node:crypto';
import { openDatabase, setConnection, getConnection, getSetting } from '../src/db.js';
import { hashPassword } from '../src/security.js';
import { createApp } from '../src/app.js';
import { createEngine } from '../src/engine.js';
import { matchesKeyword, reelCode } from '../src/validation.js';
import { Instagram, MetaError } from '../src/instagram.js';
const password = 'test-only-password-123';
const passwordHash = await hashPassword(password);
async function harness(t) {
  const db = await openDatabase(':memory:');t.after(() => db.close());
  const config = { appUrl: 'http://localhost:3000', sessionSecret: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'), passwordHash, verifyToken: 'verify-secret', production: false, apiVersion: 'v24.0' };
  const calls = [];
  const instagram = { identify: async () => ({ id: '100', username: 'creator' }), resolveMedia: async () => '200', subscribe: async () => {}, send: async (connection, job) => {calls.push(job);return { message_id: `msg-${job.id}`, id: `reply-${job.id}`, recipient_id: '300' };}, refresh: async (c) => c };
  const engine = await createEngine(db, config, instagram);
  const app = await createApp({ db, config, instagram, engine });
  async function connect(ready = true) {await setConnection(db, config, { id: '100', username: 'creator', token: 'TOKEN_DO_NOT_EXPOSE', appSecret: 'a'.repeat(32), ready, connectedAt: Date.now() });}
  async function rule(overrides = {}) {
    const r = { id: 'r1', name: 'Guide', reel_url: 'https://www.instagram.com/reel/ABC/', shortcode: 'ABC', media_id: '200', keywords: '["guide"]', dm: 'Here is your guide.', comment_reply: 'Sent!', followup: 'You are welcome.', enabled: 1, created_at: Date.now() - 60000, ...overrides };
    await db.prepare('INSERT INTO automations(id,name,reel_url,shortcode,media_id,keywords,dm,comment_reply,followup,enabled,created_at) VALUES(@id,@name,@reel_url,@shortcode,@media_id,@keywords,@dm,@comment_reply,@followup,@enabled,@created_at)').run(r);
    return r;
  }
  const agent = request.agent(app);
  const csrf = (html) => html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  async function login() {
    const page = await agent.get('/admin/login');
    await agent.post('/admin/login').type('form').send({ _csrf: csrf(page.text), password }).expect(303);
    return csrf((await agent.get('/admin')).text);
  }
  return { db, config, instagram, engine, app, calls, connect, rule, agent, csrf, login };
}
function comment({ id = '400', text = 'GUIDE please!', time = Date.now(), account = '100', media = '200', from = '300' } = {}) {
  return { object: 'instagram', entry: [{ id: account, time: Math.floor(time / 1000), changes: [{ field: 'comments', value: { id, text, media: { id: media }, from: { id: from, username: 'visitor' } } }] }] };
}
function message({ id = 'm1', text = 'Thank you!', time = Date.now(), echo = false } = {}) {
  return { object: 'instagram', entry: [{ id: '100', messaging: [{ sender: { id: '300' }, recipient: { id: '100' }, timestamp: time, message: { mid: id, text, is_echo: echo } }] }] };
}
test('admin and data are private; login, CSRF, logout and cookie protections work', async (t) => {
  const h = await harness(t);
  await request(h.app).get('/').expect(404).expect((res) => assert(!res.text.includes('/admin')));
  await request(h.app).get('/.env').expect(404);
  await request(h.app).get('/LOCAL_ACCESS.md').expect(404);
  await request(h.app).get('/admin').expect(303).expect('Location', '/admin/login');
  await request(h.app).get('/admin/activity').expect(303);
  await request(h.app).post('/admin/automations').send({}).expect(403);
  const login = await h.agent.get('/admin/login');
  assert.match(login.headers['set-cookie'][0], /HttpOnly/);assert.match(login.headers['set-cookie'][0], /SameSite=Strict/);
  await h.agent.post('/admin/login').type('form').send({ _csrf: h.csrf(login.text), password: 'wrong' }).expect(401);
  const csrf = await h.login();
  const page = await h.agent.get('/admin');
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.headers['x-robots-tag'], /noindex/);
  await h.agent.post('/admin/preview').set('Origin', 'https://evil.example').type('form').send({ _csrf: csrf, keywords: 'guide', comment: 'guide' }).expect(403);
  await h.agent.post('/admin/preview').type('form').send({ _csrf: csrf, keywords: 'guide', comment: 'GUIDE please' }).expect(200, { matches: true });
  await h.agent.post('/admin/logout').type('form').send({ _csrf: csrf }).expect(303);
  await h.agent.get('/admin').expect(303);
});
test('login limits password attempts', async (t) => {
  const h = await harness(t);const page = await h.agent.get('/admin/login');const csrf = h.csrf(page.text);
  for (let n = 0; n < 10; n++) await h.agent.post('/admin/login').type('form').send({ _csrf: csrf, password: 'wrong' }).expect(401);
  await h.agent.post('/admin/login').type('form').send({ _csrf: csrf, password }).expect(429);
});
test('draft creation, validation, XSS escaping, activation and pause', async (t) => {
  const h = await harness(t);const csrf = await h.login();
  const data = { _csrf: csrf, name: '<script>alert(1)</script>', reel_url: 'https://www.instagram.com/reel/ABC/?igsh=123', keywords: 'guide, GUIDE', dm: 'Hello <img src=x onerror=alert(1)>', comment_reply: 'Sent!', followup: 'Thanks', intent: 'draft' };
  await h.agent.post('/admin/automations').type('form').send({ ...data, reel_url: 'https://evil.example/reel/ABC' }).expect(422);
  await h.agent.post('/admin/automations').type('form').send(data).expect(303);
  const rule = await h.db.prepare('SELECT * FROM automations').get();assert.equal(rule.enabled, 0);assert.equal(rule.keywords, '["guide"]');
  const page = await h.agent.get('/admin');assert(!page.text.includes('<script>alert'));assert(page.text.includes('&lt;script&gt;'));
  await h.agent.post(`/admin/automations/${rule.id}`).type('form').send({ ...data, intent: 'enable' }).expect(422);
  await h.connect();
  await h.agent.post(`/admin/automations/${rule.id}`).type('form').send({ ...data, intent: 'enable' }).expect(303);
  assert.equal((await h.db.prepare('SELECT media_id FROM automations').get()).media_id, '200');
  await h.engine.ingest(comment({ time: Date.now() + 2000 }));
  await h.agent.post(`/admin/automations/${rule.id}/pause`).type('form').send({ _csrf: csrf }).expect(303);
  await h.engine.tick();assert.equal(h.calls.length, 0);
  assert.equal((await h.db.prepare("SELECT count(*) n FROM jobs WHERE status='pending'").get()).n, 0);
});
test('webhooks reject forged and malformed requests; valid delivery persists before ACK', async (t) => {
  const h = await harness(t);await h.connect();await h.rule();
  await request(h.app).get('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123').expect(403);
  await request(h.app).get('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=123').expect(200, '123');
  const raw = JSON.stringify(comment());
  const sign = (body) => `sha256=${createHmac('sha256', 'a'.repeat(32)).update(body).digest('hex')}`;
  await request(h.app).post('/webhooks/instagram').set('Content-Type', 'application/json').send(raw).expect(403);
  await request(h.app).post('/webhooks/instagram').set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw)).send(raw).expect(200);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM jobs').get()).n, 2);assert.equal(h.calls.length, 0);
  await request(h.app).post('/webhooks/instagram').set('Content-Type', 'application/json').set('x-hub-signature-256', sign('{')).send('{').expect(400);
});
test('duplicate comment webhooks send exactly one DM then one public reply', async (t) => {
  const h = await harness(t);await h.connect();await h.rule();const payload = comment();
  await h.engine.ingest(payload);await h.engine.ingest(payload);
  await h.engine.tick();await h.engine.tick();await h.engine.tick();
  assert.deepEqual(h.calls.map((j) => j.kind), ['dm', 'comment']);
  assert.equal((await h.db.prepare("SELECT count(*) n FROM jobs WHERE status='sent'").get()).n, 2);
});
test('first real reply triggers one follow-up; echoes, duplicates and stale messages do not', async (t) => {
  const h = await harness(t);await h.connect();await h.rule();await h.engine.ingest(comment());
  await h.engine.tick();await h.engine.tick();
  await h.engine.ingest(message({ id: 'echo', echo: true }));
  await h.engine.ingest(message({ id: 'stale', time: Date.now() - 25 * 3600000 }));
  await h.engine.ingest(message({ id: 'before', time: Date.now() - 30000 }));
  const payload = message({ time: Date.now() + 10 });await h.engine.ingest(payload);await h.engine.ingest(payload);
  await h.engine.ingest(message({ id: 'm2', time: Date.now() + 20 }));
  await h.engine.tick();await h.engine.tick();
  assert.deepEqual(h.calls.map((j) => j.kind), ['dm', 'comment', 'followup']);
});
test('ignore other accounts, media, own comments, unmatched keywords, paused rules and stale events', async (t) => {
  const h = await harness(t);await h.connect();await h.rule();
  for (const opts of [{ account: 'other' }, { media: 'other' }, { from: '100' }, { text: 'guideline' }, { time: Date.now() - 8 * 86400000 }]) await h.engine.ingest(comment(opts));
  await h.db.prepare('UPDATE automations SET enabled=0').run();await h.engine.ingest(comment({ id: 'paused' }));
  assert.equal((await h.db.prepare('SELECT count(*) n FROM jobs').get()).n, 0);
});
test('rate limits retry without allowing a premature public reply; timeout requires review', async (t) => {
  const h = await harness(t);await h.connect();await h.rule();await h.engine.ingest(comment());
  h.instagram.send = async () => {throw new MetaError('Rate limited', { retryable: true });};
  const now = Date.now();await h.engine.tick(now);
  assert.equal((await h.db.prepare("SELECT status FROM jobs WHERE kind='dm'").get()).status, 'pending');
  await h.engine.tick(now + 2000);
  assert.equal((await h.db.prepare("SELECT attempts FROM jobs WHERE kind='comment'").get()).attempts, 0);
  h.instagram.send = async () => {throw new MetaError('Unknown outcome', { ambiguous: true });};
  await h.engine.tick(now + 120000);
  assert.equal((await h.db.prepare("SELECT status FROM jobs WHERE kind='dm'").get()).status, 'review');
  await h.engine.tick(now + 240000);
  assert.equal((await h.db.prepare("SELECT attempts FROM jobs WHERE kind='comment'").get()).attempts, 0);
  const csrf = await h.login();const id = (await h.db.prepare("SELECT id FROM jobs WHERE kind='dm'").get()).id;
  await h.agent.post(`/admin/jobs/${id}/retry`).type('form').send({ _csrf: csrf }).expect(303);
  assert.equal((await h.db.prepare('SELECT status FROM jobs WHERE id=?').get(id)).status, 'review');
  await h.agent.post(`/admin/jobs/${id}/retry`).type('form').send({ _csrf: csrf, checked: 'yes' }).expect(303);
  assert.equal((await h.db.prepare('SELECT status FROM jobs WHERE id=?').get(id)).status, 'pending');
});
test('restarts preserve work but never automatically resend an interrupted delivery; expired jobs do not send', async (t) => {
  const h = await harness(t);await h.connect();await h.rule();await h.engine.ingest(comment());
  await h.db.prepare("UPDATE jobs SET status='sending' WHERE kind='dm'").run();
  const restarted = await createEngine(h.db, h.config, h.instagram);
  await restarted.tick();
  assert.equal((await h.db.prepare("SELECT status FROM jobs WHERE kind='dm'").get()).status, 'review');
  await h.db.prepare("UPDATE jobs SET expires_at=1,status='pending'").run();
  await h.engine.tick();assert.equal(h.calls.length, 0);
  assert.equal((await h.db.prepare("SELECT count(*) n FROM jobs WHERE status='expired'").get()).n, 2);
});
test('connection secrets are encrypted and never echoed; disconnect pauses and clears credentials', async (t) => {
  const h = await harness(t);await h.connect();await h.rule();const csrf = await h.login();
  assert(!(await getSetting(h.db, 'instagram')).includes('TOKEN_DO_NOT_EXPOSE'));
  const page = await h.agent.get('/admin/settings');assert(!page.text.includes('TOKEN_DO_NOT_EXPOSE'));assert(!page.text.includes('a'.repeat(32)));
  await h.agent.post('/admin/settings/disconnect').type('form').send({ _csrf: csrf }).expect(303);
  assert.equal(await getConnection(h.db, h.config), null);assert.equal((await h.db.prepare('SELECT enabled FROM automations').get()).enabled, 0);
});
test('password change invalidates other sessions and old password', async (t) => {
  const h = await harness(t);const csrf = await h.login();const other = request.agent(h.app);
  const page = await other.get('/admin/login');
  await other.post('/admin/login').type('form').send({ _csrf: h.csrf(page.text), password }).expect(303);
  await h.agent.post('/admin/settings/password').type('form').send({ _csrf: csrf, current_password: password, new_password: 'changed-password-123' }).expect(303);
  await other.get('/admin').expect(303);await h.agent.get('/admin').expect(200);
});
test('whole-word matching supports case, accents and escaped regex punctuation', () => {
  assert(matchesKeyword('GUIDE please!', ['guide']));assert(!matchesKeyword('guideline', ['guide']));
  assert(matchesKeyword('Café!', ['café']));assert(matchesKeyword('send c++ please', ['c++']));
  assert(!matchesKeyword('anything', ['.*']));
  assert.throws(() => reelCode('https://www.instagram.com.evil.test/reel/ABC/'));
});
test('Graph adapter uses comment_id for initial DM, id for follow-up, and replies edge for comments', async () => {
  const requests = [];
  const api = new Instagram({ apiVersion: 'v24.0' }, async (url, opts) => {requests.push({ url: String(url), ...opts });return { ok: true, status: 200, json: async () => ({ message_id: 'm', id: 'c' }) };});
  const connection = { id: '100', token: 'secret' };
  for (const kind of ['dm', 'followup', 'comment']) await api.send(connection, { kind, target: 'target', text: 'Hi' });
  assert.deepEqual(JSON.parse(requests[0].body).recipient, { comment_id: 'target' });
  assert.deepEqual(JSON.parse(requests[1].body).recipient, { id: 'target' });
  assert(requests[2].url.endsWith('/target/replies'));assert(!requests[0].url.includes('secret'));
});
test('Graph adapter paginates owned media and treats server errors as ambiguous', async () => {
  let n = 0;
  const api = new Instagram({ apiVersion: 'v24.0' }, async (url) => {
    n++;
    return { ok: true, json: async () => n === 1 ? { data: [], paging: { next: 'https://evil.example', cursors: { after: 'nextcursor' } } } : { data: [{ id: 'found', permalink: 'https://www.instagram.com/reel/ABC/' }] } };
  });
  assert.equal(await api.resolveMedia({ id: '100', token: 'secret' }, 'ABC'), 'found');
  const failing = new Instagram({ apiVersion: 'v24.0' }, async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 2 } }) }));
  await assert.rejects(failing.send({ id: '100', token: 'secret' }, { kind: 'dm', target: '400', text: 'Hi' }), (e) => e.ambiguous);
});
test('account identification supports both documented array and object response envelopes', async () => {
  for (const payload of [{ data: [{ user_id: '100', username: 'creator', id: 'scoped-id' }] }, { user_id: '100', username: 'creator', id: 'scoped-id' }]) {
    const api = new Instagram({ apiVersion: 'v24.0' }, async () => ({ ok: true, json: async () => payload }));
    assert.deepEqual(await api.identify('token'), { id: '100', username: 'creator' });
  }
});
test('comments from before activation and dismissed dependencies never send', async (t) => {
  const h = await harness(t);await h.connect();await h.rule();
  await h.db.prepare('UPDATE automations SET active_since=?').run(Date.now());
  await h.engine.ingest(comment({ id: 'old', time: Date.now() - 30000 }));
  assert.equal((await h.db.prepare('SELECT count(*) n FROM jobs').get()).n, 0);
  await h.engine.ingest(comment({ id: 'new', time: Date.now() + 2000 }));
  await h.db.prepare("UPDATE jobs SET status='cancelled' WHERE kind='dm'").run();
  await h.engine.tick();
  assert.equal(h.calls.length, 0);
  assert.equal((await h.db.prepare("SELECT status FROM jobs WHERE kind='comment'").get()).status, 'cancelled');
});
test('worker waits for completed Instagram setup, and refresh retains encrypted credentials', async (t) => {
  const h = await harness(t);await h.connect(false);await h.rule();await h.engine.ingest(comment());
  await h.engine.tick();assert.equal(h.calls.length, 0);
  await h.connect(true);
  const original = await getConnection(h.db, h.config);
  await setConnection(h.db, h.config, { ...original, connectedAt: Date.now() - 2 * 86400000 });
  h.instagram.refresh = async (c) => ({ ...c, token: 'rotated', expiresAt: Date.now() + 60 * 86400000 });
  await h.engine.maintain();
  assert.equal((await getConnection(h.db, h.config)).token, 'rotated');
  assert(!(await getSetting(h.db, 'instagram')).includes('rotated'));
  await h.engine.tick();assert.equal(h.calls.length, 1);
});

test('concurrent workers claim a delivery once and cold starts preserve an active send', async t => {
  const h = await harness(t); await h.connect(); await h.rule(); await h.engine.ingest(comment());
  let release; const blocked = new Promise(resolve => { release = resolve; });
  h.instagram.send = async (_connection, job) => { h.calls.push(job); await blocked; return { message_id: 'sent', recipient_id: 'person' }; };
  const second = await createEngine(h.db, h.config, h.instagram);
  const one = h.engine.tick();
  // Wait until the first send is in flight, without advancing the lease clock.
  while (!h.calls.length) await new Promise(resolve => setImmediate(resolve));
  await second.tick();
  assert.equal(h.calls.length, 1);
  assert.equal((await h.db.prepare("SELECT status FROM jobs WHERE kind='dm'").get()).status, 'sending');
  release(); await one;
  assert.equal((await h.db.prepare("SELECT status FROM jobs WHERE kind='dm'").get()).status, 'sent');
});

test('failed asynchronous transaction rolls back and leaves other requests outside it', async t => {
  const h = await harness(t);
  await assert.rejects(h.db.transaction(async () => {
    await h.db.prepare("INSERT INTO settings VALUES('rollback-test','bad')").run();
    await Promise.resolve();
    throw new Error('abort');
  })());
  assert.equal(await getSetting(h.db, 'rollback-test'), undefined);
});

test('queue drains dependencies and schedules definite rate-limit retries', async t => {
  const { drain } = await import('../src/queue.js');
  const h = await harness(t); await h.connect(); await h.rule(); await h.engine.ingest(comment());
  const schedules = [];
  await drain(h, async delay => schedules.push(delay));
  assert.deepEqual(h.calls.map(j => j.kind), ['dm', 'comment']);
  assert.equal(schedules.length, 0);
  await h.engine.ingest(comment({ id: 'retry-queue' }));
  h.instagram.send = async () => { throw new MetaError('slow down', { retryable: true }); };
  await drain(h, async delay => schedules.push(delay));
  assert(schedules[0] > 0 && schedules[0] <= 60);
});

test('privacy pages are public and do not expose or link admin', async t => {
  const h = await harness(t);
  for (const url of ['/privacy', '/data-deletion']) {
    const response = await request(h.app).get(url).expect(200);
    assert(!response.text.includes('/admin'));
    assert(!response.text.includes('TOKEN_DO_NOT_EXPOSE'));
  }
});

test('comment reply variations choose one reply and persist it through duplicate events', async t => {
  const h = await harness(t); await h.connect();
  const variants = ['sent 🙌', 'sent!', 'sent! Enjoy :) let me know if you run into issues 🙏'];
  await h.rule({ comment_reply: variants.join('\n') });
  await h.engine.ingest(comment());
  const before = await h.db.prepare("SELECT text FROM jobs WHERE kind='comment'").get();
  assert(variants.includes(before.text));
  await h.engine.ingest(comment());
  const after = await h.db.prepare("SELECT text FROM jobs WHERE kind='comment'").all();
  assert.equal(after.length, 1); assert.equal(after[0].text, before.text);
});
