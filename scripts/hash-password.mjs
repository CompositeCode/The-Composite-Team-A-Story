#!/usr/bin/env node
// Produces a password hash in the same format the admin console verifies:
//   pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>
// Usage: npm run hash-password -- "new password"   (prints the hash)
//        npm run hash-password -- "new password" --write   (updates content/admin.json)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ITERATIONS = 210_000;

export function hashPassword(password, salt = crypto.randomBytes(16), iterations = ITERATIONS) {
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [password, flag] = process.argv.slice(2);
  if (!password) {
    console.error('Usage: npm run hash-password -- "password" [--write]');
    process.exit(1);
  }
  const hash = hashPassword(password);
  if (flag === '--write') {
    const file = new URL('../content/admin.json', import.meta.url);
    const admin = JSON.parse(fs.readFileSync(file, 'utf8'));
    admin.passwordHash = hash;
    fs.writeFileSync(file, `${JSON.stringify(admin, null, 2)}\n`);
    console.log('Updated content/admin.json');
  } else {
    console.log(hash);
  }
}
