// Upload a zip to the Chrome Web Store and submit it for review (Chrome Web Store API v2).
//   node scripts/cws.mjs <zip>
// Env: CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID, CWS_EXTENSION_ID
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://chromewebstore.googleapis.com';

async function check(res, what) {
  const text = await res.text();
  if (!res.ok) throw new Error(`Chrome Web Store ${what} failed: HTTP ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

export async function submitToChromeStore({
  zipPath,
  clientId,
  clientSecret,
  refreshToken,
  publisherId,
  extensionId,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxPolls = 30,
}) {
  const { access_token } = await check(
    await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    }),
    'token refresh',
  );
  if (!access_token) throw new Error('Chrome Web Store token refresh returned no access token');
  const headers = { Authorization: `Bearer ${access_token}` };
  const item = `${API}/v2/publishers/${publisherId}/items/${extensionId}`;

  let upload = await check(
    await fetchImpl(`${API}/upload/v2/publishers/${publisherId}/items/${extensionId}:upload`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/zip' },
      body: readFileSync(zipPath),
    }),
    'upload',
  );

  for (let i = 0; upload.uploadState === 'IN_PROGRESS' && i < maxPolls; i++) {
    await sleep(2000);
    const status = await check(await fetchImpl(`${item}:fetchStatus`, { headers }), 'status');
    upload = { uploadState: status.lastAsyncUploadState, ...status };
  }
  if (upload.uploadState !== 'SUCCESS') {
    throw new Error(`Chrome Web Store upload did not succeed: ${JSON.stringify(upload)}`);
  }

  return check(await fetchImpl(`${item}:publish`, { method: 'POST', headers }), 'publish');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [zipPath] = process.argv.slice(2);
  const e = process.env;
  const opts = {
    zipPath,
    clientId: e.CWS_CLIENT_ID,
    clientSecret: e.CWS_CLIENT_SECRET,
    refreshToken: e.CWS_REFRESH_TOKEN,
    publisherId: e.CWS_PUBLISHER_ID,
    extensionId: e.CWS_EXTENSION_ID,
  };
  if (Object.values(opts).some((v) => !v)) {
    console.error('usage: set CWS_CLIENT_ID/_CLIENT_SECRET/_REFRESH_TOKEN/_PUBLISHER_ID/_EXTENSION_ID, then node scripts/cws.mjs <zip>');
    process.exit(2);
  }
  const result = await submitToChromeStore(opts);
  console.log(`Submitted to the Chrome Web Store: ${JSON.stringify(result)}`);
}
