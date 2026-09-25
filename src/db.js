import { createClient } from '@libsql/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import session from 'express-session';
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from './security.js';

export async function openDatabase(filename, authToken) {
  const remote = /^(libsql|https):/.test(filename);
  if (!remote && filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const client = createClient({ url: remote ? filename : filename === ':memory:' ? 'file::memory:' : `file:${filename}`, authToken });
  const context = new AsyncLocalStorage();
  const execute = (sql, args = []) => (context.getStore() || client).execute({ sql, args });
  const db = {
    prepare(sql) {
      const argsFor = (args) => args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : args;
      return {
        async run(...args) {const r = await execute(sql, argsFor(args));return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid || 0) };},
        async get(...args) {return (await execute(sql, argsFor(args))).rows[0];},
        async all(...args) {return (await execute(sql, argsFor(args))).rows;}
      };
    },
    async exec(sql) {await (context.getStore() || client).executeMultiple(sql);},
    transaction(fn) {
      return async (...args) => {
        if (context.getStore()) return fn(...args);
        const tx = await client.transaction('write');
        try {const result = await context.run(tx, () => fn(...args));await tx.commit();return result;}
        catch (error) {await tx.rollback().catch(() => {});throw error;} finally
        {tx.close();}
      };
    },
    close() {client.close();}
  };
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, reel_url TEXT NOT NULL, shortcode TEXT NOT NULL,
      media_id TEXT, keywords TEXT NOT NULL, dm TEXT NOT NULL, comment_reply TEXT NOT NULL DEFAULT '',
      followup TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, automation_id TEXT NOT NULL,
      kind TEXT NOT NULL, target TEXT NOT NULL, person TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      due_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
      sent_at INTEGER, error TEXT, remote_id TEXT, depends_on INTEGER REFERENCES jobs(id),
      UNIQUE(event_id, kind), FOREIGN KEY(automation_id) REFERENCES automations(id)
    );
    CREATE TABLE IF NOT EXISTS conversations (
      person TEXT PRIMARY KEY, automation_id TEXT NOT NULL, started_at INTEGER NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(status, due_at);
  CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL);
`);
  // Migrations are serialized by a write transaction across serverless instances.
  await db.transaction(async () => {
    const columns = await db.prepare('PRAGMA table_info(automations)').all();
    if (!columns.some((c) => c.name === 'active_since')) await db.exec('ALTER TABLE automations ADD COLUMN active_since INTEGER');
    const jobs = await db.prepare('PRAGMA table_info(jobs)').all();
    if (!jobs.some((c) => c.name === 'claimed_at')) await db.exec('ALTER TABLE jobs ADD COLUMN claimed_at INTEGER');
  })();
  if (!remote && filename !== ':memory:') fs.chmodSync(filename, 0o600);
  return db;
}
export async function getSetting(db, key) {return (await db.prepare('SELECT value FROM settings WHERE key=?').get(key))?.value;}
export async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}
export async function getConnection(db, config) {
  const value = await getSetting(db, 'instagram');
  return value ? decrypt(value, config.encryptionKey) : null;
}
export async function setConnection(db, config, connection) {
  await setSetting(db, 'instagram', encrypt(connection, config.encryptionKey));
}
export class SqliteSessionStore extends session.Store {
  constructor(db) {super();this.db = db;}
  async get(sid, cb) {
    try {
      const row = await this.db.prepare('SELECT data FROM sessions WHERE sid=? AND expires>?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (e) {cb(e);}
  }
  async set(sid, data, cb) {
    try {
      const expires = data.cookie.expires ? new Date(data.cookie.expires).getTime() : Date.now() + 12 * 3600000;
      await this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(sid, JSON.stringify(data), expires);
      await this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
      cb?.();
    } catch (e) {cb?.(e);}
  }
  async destroy(sid, cb) {try {await this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);cb?.();} catch (e) {cb?.(e);}}
}

// A shared limit survives cold starts and applies across all function instances.
export class DatabaseRateLimitStore {
  constructor(db, prefix) { this.db = db; this.prefix = prefix; }
  init(options) { this.windowMs = options.windowMs; }
  async increment(key) {
    const now = Date.now();
    const row = await this.db.prepare(`INSERT INTO rate_limits(key,hits,expires) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires<=? THEN 1 ELSE rate_limits.hits+1 END,
      expires=CASE WHEN rate_limits.expires<=? THEN excluded.expires ELSE rate_limits.expires END RETURNING hits,expires`)
      .get(`${this.prefix}:${key}`, now + this.windowMs, now, now);
    return { totalHits: row.hits, resetTime: new Date(row.expires) };
  }
  async decrement(key) { await this.db.prepare('UPDATE rate_limits SET hits=MAX(0,hits-1) WHERE key=?').run(`${this.prefix}:${key}`); }
  async resetKey(key) { await this.db.prepare('DELETE FROM rate_limits WHERE key=?').run(`${this.prefix}:${key}`); }
}
