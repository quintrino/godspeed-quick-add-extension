// Submit a new version to addons.mozilla.org (listed channel) via the AMO API v5.
//   node scripts/amo.mjs <zip>
// Env: AMO_JWT_ISSUER, AMO_JWT_SECRET
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest } from './build.mjs';

const API = 'https://addons.mozilla.org/api/v5';
const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export function makeJwt(issuer, secret, now = Math.floor(Date.now() / 1000), jti = randomUUID()) {
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ iss: issuer, jti, iat: now, exp: now + 60 });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function check(res, what) {
  if (!res.ok) throw new Error(`AMO ${what} failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

export async function submitToAmo({
  zipPath,
  addonId,
  issuer,
  secret,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxPolls = 60,
}) {
  const auth = () => ({ Authorization: `JWT ${makeJwt(issuer, secret)}` });

  const form = new FormData();
  form.set('channel', 'listed');
  form.set('upload', new Blob([readFileSync(zipPath)]), basename(zipPath));
  const created = await check(
    await fetchImpl(`${API}/addons/upload/`, { method: 'POST', headers: auth(), body: form }),
    'upload',
  );

  let upload = created;
  for (let i = 0; !upload.processed && i < maxPolls; i++) {
    await sleep(5000);
    upload = await check(
      await fetchImpl(`${API}/addons/upload/${created.uuid}/`, { headers: auth() }),
      'upload status',
    );
  }
  if (!upload.processed) throw new Error('AMO upload was not processed in time');
  if (!upload.valid) {
    throw new Error(`AMO rejected the upload: ${JSON.stringify(upload.validation ?? upload)}`);
  }

  const version = await check(
    await fetchImpl(`${API}/addons/addon/${encodeURIComponent(addonId)}/versions/`, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload: created.uuid }),
    }),
    'create version',
  );
  return version;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [zipPath] = process.argv.slice(2);
  const { AMO_JWT_ISSUER: issuer, AMO_JWT_SECRET: secret } = process.env;
  if (!zipPath || !issuer || !secret) {
    console.error('usage: AMO_JWT_ISSUER=… AMO_JWT_SECRET=… node scripts/amo.mjs <zip>');
    process.exit(2);
  }
  const addonId = readManifest().browser_specific_settings.gecko.id;
  const v = await submitToAmo({ zipPath, addonId, issuer, secret });
  console.log(`Submitted ${addonId} version ${v.version} to AMO for review.`);
}
