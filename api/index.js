import { createApp } from '../src/app.js';
import { getRuntime } from '../src/runtime.js';
import { wakeWorker } from '../src/queue.js';
let app;
export default async function handler(req, res) {
  app ||= getRuntime().then(runtime => createApp({ ...runtime, wakeWorker })).catch(error => { app = undefined; throw error; });
  return (await app)(req, res);
}
