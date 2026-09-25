import { safeEqual } from '../src/security.js';
import { getRuntime } from '../src/runtime.js';
import { drain } from '../src/queue.js';
export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || !safeEqual(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)) return res.status(401).end();
  await drain(await getRuntime());
  res.json({ ok: true });
}
