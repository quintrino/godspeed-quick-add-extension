import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { EXTENSION_FILES, ROOT, readManifest, toChromeManifest } from '../scripts/build.mjs';

const mv2 = readManifest();

function referencedFiles(m) {
  const files = new Set();
  const action = m.browser_action ?? m.action;
  for (const icon of Object.values(m.icons ?? {})) files.add(icon);
  for (const icon of Object.values(action?.default_icon ?? {})) files.add(icon);
  for (const s of m.background?.scripts ?? []) files.add(s);
  if (m.background?.service_worker) files.add(m.background.service_worker);
  if (m.options_ui?.page) files.add(m.options_ui.page);
  for (const cs of m.content_scripts ?? []) {
    for (const f of [...(cs.js ?? []), ...(cs.css ?? [])]) files.add(f);
  }
  return [...files];
}

test('source manifest is the published Manifest V2 Firefox manifest', () => {
  assert.equal(mv2.manifest_version, 2);
  assert.match(mv2.version, /^\d+\.\d+\.\d+$/);
  assert.ok(mv2.browser_specific_settings?.gecko?.id, 'gecko id is required for AMO');
});

test('every file the manifest references exists and ships in the zip', () => {
  for (const f of referencedFiles(mv2)) {
    assert.ok(existsSync(join(ROOT, f)), `${f} is referenced but missing`);
    assert.ok(EXTENSION_FILES.includes(f), `${f} is referenced but not packaged`);
  }
  for (const f of EXTENSION_FILES) assert.ok(existsSync(join(ROOT, f)), `${f} missing`);
});

test('chrome manifest is valid Manifest V3', () => {
  const mv3 = toChromeManifest(mv2);
  assert.equal(mv3.manifest_version, 3);
  assert.equal(mv3.version, mv2.version);
  assert.equal(mv3.name, mv2.name);
  assert.deepEqual(mv3.background, { service_worker: 'background.js' });
  assert.equal(mv3.browser_action, undefined);
  assert.deepEqual(mv3.action, mv2.browser_action);
  assert.equal(mv3.browser_specific_settings, undefined);
  assert.deepEqual(mv3.commands, mv2.commands);
  assert.deepEqual(mv3.content_scripts, mv2.content_scripts);
});

test('chrome manifest moves host patterns out of permissions', () => {
  const mv3 = toChromeManifest(mv2);
  assert.ok(mv3.host_permissions.includes('https://api.godspeedapp.com/*'));
  for (const p of mv3.permissions) assert.ok(!p.includes('://'), `${p} should be a host permission`);
  assert.deepEqual(
    [...mv3.permissions, ...mv3.host_permissions].sort(),
    [...mv2.permissions].sort(),
  );
  for (const f of referencedFiles(mv3)) assert.ok(existsSync(join(ROOT, f)), `${f} missing`);
});

test('conversion refuses a source that is not Manifest V2', () => {
  assert.throws(() => toChromeManifest({ ...mv2, manifest_version: 3 }), /Manifest V2/);
});
