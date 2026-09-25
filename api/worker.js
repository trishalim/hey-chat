import { QueueClient } from '@vercel/queue';
import { getRuntime } from '../src/runtime.js';
import { drain } from '../src/queue.js';
const queue = new QueueClient();
export default queue.handleNodeCallback(async () => {
  await drain(await getRuntime());
}, { visibilityTimeoutSeconds: 300, retry: () => ({ afterSeconds: 60 }) });
