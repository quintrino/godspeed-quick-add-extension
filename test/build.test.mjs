import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EXTENSION_FILES, ROOT, build, readManifest } from '../scripts/build.mjs';
import { createZip } from '../scripts/zip.mjs';
import { readZip } from './helpers.mjs';

test('zip writer round-trips arbitrary files, including binary and empty ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const files = [
    { name: 'a.txt', data: Buffer.from('hello hello hello hello') },
    { name: 'bin.dat', data: Buffer.from([0, 255, 1, 254, 2, 253]) },
    { name: 'empty', data: Buffer.alloc(0) },
    { name: 'dir/ünï.txt', data: Buffer.from('nested') },
  ];
  const path = join(dir, 'x.zip');
  writeFileSync(path, createZip(files));
  const read = readZip(path);
  assert.deepEqual(Object.keys(read), files.map((f) => f.name));
  for (const f of files) assert.deepEqual(read[f.name], f.data);
});

test('build produces firefox (MV2) and chrome (MV3) zips with the right contents', () => {
  const out = build(mkdtempSync(join(tmpdir(), 'dist-')));
  const source = readManifest();
  assert.equal(out.version, source.version);

  const firefox = readZip(out.firefox);
  const chrome = readZip(out.chrome);
  const expected = ['manifest.json', ...EXTENSION_FILES].sort();
  assert.deepEqual(Object.keys(firefox).sort(), expected);
  assert.deepEqual(Object.keys(chrome).sort(), expected);

  assert.deepEqual(JSON.parse(firefox['manifest.json']), source);
  const mv3 = JSON.parse(chrome['manifest.json']);
  assert.equal(mv3.manifest_version, 3);
  assert.equal(mv3.version, source.version);

  for (const f of EXTENSION_FILES) {
    assert.deepEqual(firefox[f], readFileSync(join(ROOT, f)), `${f} differs in firefox zip`);
    assert.deepEqual(chrome[f], readFileSync(join(ROOT, f)), `${f} differs in chrome zip`);
  }
});

test('build output is reproducible', () => {
  const a = build(mkdtempSync(join(tmpdir(), 'dist-')));
  const b = build(mkdtempSync(join(tmpdir(), 'dist-')));
  assert.deepEqual(readFileSync(a.chrome), readFileSync(b.chrome));
  assert.deepEqual(readFileSync(a.firefox), readFileSync(b.firefox));
});
