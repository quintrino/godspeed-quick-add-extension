// Builds store-ready zips from the extension sources.
//   dist/godspeed-task-sender-firefox-<version>.zip  (Manifest V2, as published)
//   dist/godspeed-task-sender-chrome-<version>.zip   (Manifest V3, generated)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './zip.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Only these files ship; everything else in the repo (README, scripts, tests) stays out.
export const EXTENSION_FILES = [
  'background.js',
  'content.js',
  'content.css',
  'options.html',
  'options.js',
  'quick.html',
  'quick.js',
  'icon16.png',
  'icon48.png',
  'icon128.png',
];

const isHostPattern = (p) => p.includes('://') || p === '<all_urls>';

/** Derive the Chrome Manifest V3 manifest from the Firefox Manifest V2 one. */
export function toChromeManifest(mv2) {
  if (mv2.manifest_version !== 2) {
    throw new Error(`expected a Manifest V2 source manifest, got ${mv2.manifest_version}`);
  }
  const scripts = mv2.background?.scripts ?? [];
  if (scripts.length !== 1) {
    throw new Error('expected exactly one background script to use as the service worker');
  }

  const { browser_action, background, permissions = [], browser_specific_settings, ...rest } = mv2;
  void background;
  void browser_specific_settings;

  const mv3 = {
    ...rest,
    manifest_version: 3,
    permissions: permissions.filter((p) => !isHostPattern(p)),
    host_permissions: permissions.filter(isHostPattern),
    background: { service_worker: scripts[0] },
  };
  if (browser_action) mv3.action = browser_action;
  return mv3;
}

export function readManifest() {
  return JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
}

function zipFor(manifest) {
  const files = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
    ...EXTENSION_FILES.map((name) => ({ name, data: readFileSync(join(ROOT, name)) })),
  ];
  return createZip(files);
}

export function build(outDir = join(ROOT, 'dist')) {
  const mv2 = readManifest();
  mkdirSync(outDir, { recursive: true });
  const firefox = join(outDir, `godspeed-task-sender-firefox-${mv2.version}.zip`);
  const chrome = join(outDir, `godspeed-task-sender-chrome-${mv2.version}.zip`);
  writeFileSync(firefox, zipFor(mv2));
  writeFileSync(chrome, zipFor(toChromeManifest(mv2)));
  return { version: mv2.version, firefox, chrome };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = build();
  console.log(`Built ${out.version}:\n  ${out.firefox}\n  ${out.chrome}`);
}
