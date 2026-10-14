import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeJwt, submitToAmo } from '../scripts/amo.mjs';
import { submitToChromeStore } from '../scripts/cws.mjs';

const zipPath = join(mkdtempSync(join(tmpdir(), 'pub-')), 'x.zip');
writeFileSync(zipPath, 'not really a zip');
const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const noSleep = async () => {};

test('AMO JWT is a valid HS256 token with issuer, iat and a short expiry', () => {
  const jwt = makeJwt('user:1:2', 's3cret', 1000, 'jti-1');
  const [h, p, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), {
    iss: 'user:1:2',
    jti: 'jti-1',
    iat: 1000,
    exp: 1060,
  });
  assert.equal(sig, createHmac('sha256', 's3cret').update(`${h}.${p}`).digest('base64url'));
});

test('AMO submit uploads to the listed channel, waits for validation, then creates the version', async () => {
  const seen = [];
  let polls = 0;
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? 'GET', auth: init.headers?.Authorization });
    if (url.endsWith('/addons/upload/')) {
      assert.equal(init.body.get('channel'), 'listed');
      return json({ uuid: 'u-1', processed: false });
    }
    if (url.endsWith('/addons/upload/u-1/')) {
      return json({ uuid: 'u-1', processed: ++polls >= 2, valid: true });
    }
    assert.match(url, /\/addons\/addon\/godspeed%40example\.com\/versions\/$/);
    assert.deepEqual(JSON.parse(init.body), { upload: 'u-1' });
    return json({ version: '1.0.2' });
  };
  const v = await submitToAmo({
    zipPath, addonId: 'godspeed@example.com', issuer: 'i', secret: 's', fetchImpl, sleep: noSleep,
  });
  assert.equal(v.version, '1.0.2');
  assert.equal(seen.length, 4);
  assert.ok(seen.every((c) => c.auth?.startsWith('JWT ')));
});

test('AMO submit stops with the validation errors when the upload is invalid', async () => {
  const fetchImpl = async (url) =>
    url.endsWith('/addons/upload/')
      ? json({ uuid: 'u', processed: true, valid: false, validation: { errors: 1 } })
      : assert.fail('must not create a version for an invalid upload');
  await assert.rejects(
    submitToAmo({ zipPath, addonId: 'a', issuer: 'i', secret: 's', fetchImpl, sleep: noSleep }),
    /rejected the upload.*errors/,
  );
});

test('AMO submit reports API failures with status and body', async () => {
  const fetchImpl = async () => json({ detail: 'Version 1.0.1 already exists.' }, 409);
  await assert.rejects(
    submitToAmo({ zipPath, addonId: 'a', issuer: 'i', secret: 's', fetchImpl, sleep: noSleep }),
    /409.*already exists/,
  );
});

const cws = (fetchImpl) =>
  submitToChromeStore({
    zipPath, clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
    publisherId: 'pub', extensionId: 'ext', fetchImpl, sleep: noSleep,
  });

test('Chrome submit refreshes the token, uploads the zip, then publishes', async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method, auth: init.headers?.Authorization });
    if (url.includes('oauth2.googleapis.com')) {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'rt');
      return json({ access_token: 'AT' });
    }
    if (url.endsWith(':upload')) return json({ uploadState: 'SUCCESS' });
    return json({ status: ['PENDING_REVIEW'] });
  };
  const result = await cws(fetchImpl);
  assert.deepEqual(result, { status: ['PENDING_REVIEW'] });
  assert.deepEqual(seen.map((s) => s.url), [
    'https://oauth2.googleapis.com/token',
    'https://chromewebstore.googleapis.com/upload/v2/publishers/pub/items/ext:upload',
    'https://chromewebstore.googleapis.com/v2/publishers/pub/items/ext:publish',
  ]);
  assert.equal(seen[1].auth, 'Bearer AT');
  assert.equal(seen[2].auth, 'Bearer AT');
});

test('Chrome submit waits for an in-progress upload to finish', async () => {
  let statusCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes('oauth2')) return json({ access_token: 'AT' });
    if (url.endsWith(':upload')) return json({ uploadState: 'IN_PROGRESS' });
    if (url.endsWith(':fetchStatus')) {
      return json({ lastAsyncUploadState: ++statusCalls < 2 ? 'IN_PROGRESS' : 'SUCCESS' });
    }
    return json({ status: ['PENDING_REVIEW'] });
  };
  await cws(fetchImpl);
  assert.equal(statusCalls, 2);
});

test('Chrome submit never publishes after a failed upload', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('oauth2')) return json({ access_token: 'AT' });
    if (url.endsWith(':upload')) return json({ uploadState: 'FAILED' });
    return assert.fail('must not publish after a failed upload');
  };
  await assert.rejects(cws(fetchImpl), /did not succeed.*FAILED/);
});

test('Chrome submit reports a failed token refresh', async () => {
  await assert.rejects(
    cws(async () => json({ error: 'invalid_grant' }, 400)),
    /token refresh failed.*invalid_grant/,
  );
});
