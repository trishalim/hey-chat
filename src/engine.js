import { randomInt } from 'node:crypto';
import { MetaError } from './instagram.js';
import { getConnection, getSetting, setConnection, setSetting } from './db.js';
import { matchesKeyword, UserError } from './validation.js';
const DAY = 86400000;
function timestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n < 1e12 ? n * 1000 : n : null;
}
export async function createEngine(db, config, instagram) {
  const insertJob = db.prepare(`INSERT OR IGNORE INTO jobs(event_id,automation_id,kind,target,person,text,due_at,expires_at,created_at,depends_on)
    VALUES(@event_id,@automation_id,@kind,@target,@person,@text,@due_at,@expires_at,@created_at,@depends_on)`);
  async function enqueue(rule, eventId, kind, target, person, text, expires, now, dependency = null) {
    const result = await insertJob.run({ event_id: eventId, automation_id: rule.id, kind, target, person, text,
      due_at: now, expires_at: expires, created_at: now, depends_on: dependency });
    return Number(result.lastInsertRowid);
  }
  const ingest = db.transaction(async (payload, now = Date.now()) => {
    if (payload.object !== 'instagram') return;
    if (!Array.isArray(payload.entry)) throw new UserError('Invalid webhook payload.');
    const connection = await getConnection(db, config);
    if (!connection) return;
    for (const entry of payload.entry) {
      if (!entry || String(entry.id) !== connection.id) continue;
      await setSetting(db, 'last_webhook', String(now));
      const changes = Array.isArray(entry.changes) ? entry.changes : entry.field ? [entry] : [];
      for (const change of changes) {
        const v = change?.value;
        if (change?.field !== 'comments' || !v?.id || !v.media?.id || typeof v.text !== 'string') continue;
        if (v.parent_id || v.from?.self_ig_scoped_id || String(v.from?.id) === connection.id || v.from?.username === connection.username) continue;
        const when = timestamp(entry.time);
        if (!when || when > now + 60000 || now - when > 7 * DAY) continue;
        const id = `comment:${v.id}`;
        if (!(await db.prepare('INSERT OR IGNORE INTO events VALUES(?,?)').run(id, now)).changes) continue;
        const rules = await db.prepare('SELECT * FROM automations WHERE enabled=1 AND media_id=? ORDER BY created_at,id').all(String(v.media.id));
        // First matching rule wins: at most one private reply per comment.
        const rule = rules.find((r) => (r.active_since || r.created_at) <= when + 999 && matchesKeyword(v.text, JSON.parse(r.keywords)));
        if (!rule) continue;
        const person = v.from?.id ? String(v.from.id) : '';
        const dm = await enqueue(rule, id, 'dm', String(v.id), person, rule.dm, when + 7 * DAY, now);
        if (rule.comment_reply) {
          const replies = rule.comment_reply.split(/\r?\n/).map(text => text.trim()).filter(Boolean);
          if (replies.length) await enqueue(rule, id, 'comment', String(v.id), person, replies[randomInt(replies.length)], when + 7 * DAY, now, dm);
        }
      }
      for (const event of Array.isArray(entry.messaging) ? entry.messaging : []) {
        const message = event?.message;
        if (!message?.mid || message.is_echo || message.is_deleted || message.is_unsupported || typeof message.text !== 'string' || !message.text.trim()) continue;
        const person = String(event.sender?.id || '');
        if (!person || person === connection.id || String(event.recipient?.id) !== connection.id) continue;
        const when = timestamp(event.timestamp);
        if (!when || when > now + 60000 || now - when >= DAY) continue;
        const eventId = `message:${message.mid}`;
        if (!(await db.prepare('INSERT OR IGNORE INTO events VALUES(?,?)').run(eventId, now)).changes) continue;
        const conversation = await db.prepare('SELECT * FROM conversations WHERE person=? AND consumed=0').get(person);
        if (!conversation || when < conversation.started_at) continue;
        const rule = await db.prepare('SELECT * FROM automations WHERE id=? AND enabled=1').get(conversation.automation_id);
        if (!rule?.followup) continue;
        await db.prepare('UPDATE conversations SET consumed=1 WHERE person=?').run(person);
        await enqueue(rule, eventId, 'followup', person, person, rule.followup, when + DAY - 60000, now);
      }
    }
  });
  // A crash during delivery has an unknown outcome; automatically resending risks duplicates.

  let busy = false;
  async function tick(now = Date.now()) {
    if (busy) return;
    busy = true;
    try {
      const connection = await getConnection(db, config);
      if (!connection?.ready) return;
      await db.prepare("UPDATE jobs SET status='review',error='Delivery interrupted. Check Instagram before retrying.' WHERE status='sending' AND (claimed_at IS NULL OR claimed_at<?)").run(now - 300000);
      await db.prepare("UPDATE jobs SET status='expired',error='The allowed messaging window has closed.' WHERE status='pending' AND expires_at<=?").run(now);
      await db.prepare("UPDATE jobs SET status='cancelled',error='Automation paused.' WHERE status='pending' AND automation_id IN (SELECT id FROM automations WHERE enabled=0)").run();
      await db.prepare("UPDATE jobs SET status='cancelled',error='The preceding DM was cancelled or expired.' WHERE status='pending' AND depends_on IN (SELECT id FROM jobs WHERE status IN ('cancelled','expired'))").run();
      const job = await db.prepare(`SELECT jobs.* FROM jobs JOIN automations a ON a.id=jobs.automation_id
        WHERE jobs.status='pending' AND jobs.due_at<=? AND a.enabled=1
        AND (jobs.depends_on IS NULL OR EXISTS(SELECT 1 FROM jobs d WHERE d.id=jobs.depends_on AND d.status='sent'))
        ORDER BY jobs.id LIMIT 1`).get(now);
      if (!job) return;
      if (!(await db.prepare("UPDATE jobs SET status='sending',attempts=attempts+1,claimed_at=? WHERE id=? AND status='pending' AND automation_id IN (SELECT id FROM automations WHERE enabled=1)").run(now, job.id)).changes) return;
      try {
        const result = await instagram.send(connection, job);
        await db.transaction(async () => {
          await db.prepare("UPDATE jobs SET status='sent',sent_at=?,remote_id=?,error=NULL WHERE id=?").run(Date.now(), String(result.message_id || result.id), job.id);
          if (job.kind === 'dm' && (await getConnection(db, config))?.id === connection.id && (await db.prepare('SELECT enabled FROM automations WHERE id=?').get(job.automation_id))?.enabled) {
            const person = String(result.recipient_id || job.person || '');
            if (person) await db.prepare(`INSERT INTO conversations(person,automation_id,started_at,consumed) VALUES(?,?,?,0)
              ON CONFLICT(person) DO UPDATE SET automation_id=excluded.automation_id,started_at=excluded.started_at,consumed=0`).run(person, job.automation_id, now);
          }
        })();
      } catch (error) {
        const retry = error.retryable && job.attempts < 5;
        const status = retry ? 'pending' : error.ambiguous || !(error instanceof MetaError) ? 'review' : 'failed';
        await db.prepare('UPDATE jobs SET status=?,error=?,due_at=? WHERE id=?').run(status, error.message || 'Delivery failed.', now + Math.min(3600000, 60000 * 2 ** job.attempts), job.id);
      }
      return true;
    } finally {busy = false;}
  }
  let maintaining = false;
  async function maintain(now = Date.now()) {
    if (maintaining) return;
    maintaining = true;
    try {
      const connection = await getConnection(db, config);
      const lastAttempt = Number((await getSetting(db, 'refresh_attempt')) || connection?.connectedAt || now);
      if (connection && now - lastAttempt >= DAY) {
        const claimed = await db.prepare("INSERT INTO settings(key,value) VALUES('refresh_attempt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<=?").run(String(now), now - DAY);
        if (!claimed.changes) return;
        try {
          const refreshed = await instagram.refresh(connection);
          if ((await getConnection(db, config))?.token === connection.token) await setConnection(db, config, refreshed);
        } catch {
          if ((await getConnection(db, config))?.token === connection.token) await setConnection(db, config, { ...connection, refreshError: 'Automatic token refresh failed. Generate a long-lived Instagram token and reconnect before the token expires.' });
        }
      }
      await db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
      await db.prepare('DELETE FROM rate_limits WHERE expires<?').run(now);
      // Keep event IDs and delivery records for deduplication; discard stale conversation state.
      await db.prepare('DELETE FROM conversations WHERE started_at<?').run(now - 90 * DAY);
    } finally {maintaining = false;}
  }
  return { ingest, tick, maintain };
}
