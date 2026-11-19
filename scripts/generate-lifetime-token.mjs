import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Helper to parse .env file
function loadEnv() {
  const envPath = path.join(rootDir, '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const secret = process.env.SESSION_SECRET || 'default-night-planner-fallback-secret-key-32chars';
const userId = process.argv[2] || 'owner';

// 0 means no expiration / lifetime
const payload = JSON.stringify({
  authenticated: true,
  userId,
  issuedAt: Date.now(),
  expiresAt: 0,
});

const base64Payload = Buffer.from(payload).toString('base64url');
const signature = crypto.createHmac('sha256', secret).update(base64Payload).digest('hex');
const token = `${base64Payload}.${signature}`;

console.log('='.repeat(70));
console.log('🌟 SAM\'SPACE LIFETIME SESSION TOKEN GENERATED');
console.log('='.repeat(70));
console.log(`User ID:        ${userId}`);
console.log(`Expires At:     Never (Lifetime / No expiration)`);
console.log(`Secret:         ${secret === 'default-night-planner-fallback-secret-key-32chars' ? '(Fallback secret - set SESSION_SECRET in .env.local)' : 'From SESSION_SECRET'}`);
console.log('-'.repeat(70));
console.log('\nToken:');
console.log(token);
console.log('\n' + '-'.repeat(70));
console.log('Usage Instructions:');
console.log('1. In Mobile App (Flutter) / TokenStore:');
console.log('   Save in FlutterSecureStorage key: np_session_token');
console.log('2. In API Requests / Postman / cURL:');
console.log(`   Header: Authorization: Bearer ${token}`);
console.log('3. In Browser Cookie:');
console.log(`   Cookie: np_session=${token}`);
console.log('='.repeat(70));
