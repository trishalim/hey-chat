import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { Instagram } from './instagram.js';
import { createEngine } from './engine.js';
import { createApp } from './app.js';
process.umask(0o077);
const config = loadConfig();
const db = await openDatabase(config.databasePath, config.databaseToken);
const instagram = new Instagram(config);
const engine = await createEngine(db, config, instagram);
const app = await createApp({ db, config, instagram, engine });
const server = app.listen(config.port, config.host, () => console.log(`Little Chat is running at ${config.appUrl}/admin`));
let stopped = false;
const worker = setInterval(() => engine.tick().catch(() => console.error('Delivery worker failed; pending work is retained.')), 1000);
const maintenance = setInterval(() => engine.maintain().catch(() => console.error('Connection maintenance failed.')), 60000);
function stop() {
  if (stopped) return;
  stopped = true;
  clearInterval(worker);clearInterval(maintenance);
  server.close(() => {
    // Leave in-flight jobs marked sending for review on restart rather than risking a duplicate send.
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 20000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
