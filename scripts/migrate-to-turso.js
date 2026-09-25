// Run with the local .env and remote Turso variables; never prints credentials.
// Destination must be empty. Re-running refuses to overwrite deployed data.
import { openDatabase, getConnection, setConnection } from '../src/db.js';
if (!/^libsql:\/\//.test(process.env.TURSO_DATABASE_URL || '') || !process.env.TURSO_AUTH_TOKEN) throw new Error('Set Turso credentials first.');
const source = await openDatabase(process.env.DATABASE_PATH || './data/little-chat.sqlite');
const destination = await openDatabase(process.env.TURSO_DATABASE_URL, process.env.TURSO_AUTH_TOKEN);
try {
  await destination.transaction(async () => {
    if ((await destination.prepare('SELECT COUNT(*) n FROM settings').get()).n) throw new Error('Destination already contains settings; refusing to overwrite.');
    for (const table of ['settings', 'automations', 'events', 'jobs', 'conversations']) {
      const rows = await source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        if (table === 'settings' && ['webhook_verified', 'last_webhook'].includes(row.key)) continue;
        const keys = Object.keys(row);
        await destination.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]));
      }
    }
    const cryptoConfig = { encryptionKey: process.env.ENCRYPTION_KEY };
    const connection = await getConnection(destination, cryptoConfig);
    if (connection) await setConnection(destination, cryptoConfig, { ...connection, ready: false });
    // Require the production webhook setup before enabling deliveries.
    await destination.prepare('UPDATE automations SET enabled=0').run();
  })();
  console.log('Migration complete. Keep the same ENCRYPTION_KEY in production. No sessions were copied.');
} finally { source.close(); destination.close(); }
