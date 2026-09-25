import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/security.js';
if (fs.existsSync('.env')) {
  console.log('Already configured; no files changed. Use LOCAL_ACCESS.md if present, or npm run reset-password for password recovery.');
  process.exit(0);
}
fs.mkdirSync('data', { recursive: true, mode: 0o700 });
const password = randomBytes(18).toString('base64url');
const hash = await hashPassword(password);
fs.writeFileSync('.env', `NODE_ENV=development\nPORT=3000\nHOST=127.0.0.1\nAPP_URL=http://127.0.0.1:3000\nDATABASE_PATH=./data/little-chat.sqlite\nSESSION_SECRET=${randomBytes(48).toString('hex')}\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nADMIN_PASSWORD_HASH=${hash}\nWEBHOOK_VERIFY_TOKEN=${randomBytes(32).toString('hex')}\nMETA_API_VERSION=v24.0\nTRUST_PROXY=0\nCRON_SECRET=${randomBytes(32).toString('hex')}\nPRIVACY_CONTACT=\nPRIVACY_PROVIDERS=\n`, { mode: 0o600, flag: 'wx' });
fs.writeFileSync('LOCAL_ACCESS.md', `# Your private Little Chat login\n\nOpen http://127.0.0.1:3000/admin\n\nPassword: \`${password}\`\n\nNo username is needed. Change this password under Instagram setup → Change admin password. This file is local, excluded from Git, and never served by the website. Delete it after storing your password in a password manager.\n`, { mode: 0o600, flag: 'wx' });
console.log('Setup complete. Your password is saved in LOCAL_ACCESS.md. Run npm start, then open http://127.0.0.1:3000/admin.');
