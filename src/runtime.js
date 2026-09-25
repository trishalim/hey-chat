import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { Instagram } from './instagram.js';
import { createEngine } from './engine.js';
let runtime;
export function getRuntime() {
  runtime ||= (async () => {
    const config = loadConfig();
    const db = await openDatabase(config.databasePath, config.databaseToken);
    const instagram = new Instagram(config);
    const engine = await createEngine(db, config, instagram);
    return { config, db, instagram, engine };
  })().catch(error => { runtime = undefined; throw error; });
  return runtime;
}
