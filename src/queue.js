import { getConnection } from './db.js';
import { send } from '@vercel/queue';
export const TOPIC = 'little-chat-deliveries';
export async function wakeWorker(delaySeconds = 0) {
  await send(TOPIC, { wake: true }, { delaySeconds, retentionSeconds: 86400 });
}
// The database remains the source of truth. Queue payloads contain no Instagram data.
export async function drain({ db, engine, config }, schedule = wakeWorker) {
  await engine.maintain();
  for (let i = 0; i < 8; i++) {
    if (!await engine.tick()) break;
  }
  const connection = await getConnection(db, config);
  if (!connection?.ready) return;
  const next = await db.prepare(`SELECT MIN(j.due_at) due FROM jobs j JOIN automations a ON a.id=j.automation_id
    WHERE j.status='pending' AND a.enabled=1 AND (j.depends_on IS NULL OR EXISTS(SELECT 1 FROM jobs d WHERE d.id=j.depends_on AND d.status='sent'))`).get();
  if (next?.due != null) await schedule(Math.max(1, Math.min(3600, Math.ceil((next.due - Date.now()) / 1000))));
}
