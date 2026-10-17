import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { ROOT } from '../scripts/build.mjs';
import { FakeElement } from './fake-dom.mjs';

const source = readFileSync(join(ROOT, 'options.js'), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

/** Run options.js against a fake page and an in-memory storage.sync. */
function load({ stored = {}, getFails = false, setFails = false, firefox = false } = {}) {
  const ids = ['settings-form', 'apiKey', 'listId', 'quickAddTarget', 'clearKey', 'status'];
  const els = Object.fromEntries(ids.map((id) => [id, new FakeElement('el')]));
  els.quickAddTarget.value = 'title';
  els.clearKey.hidden = true;
  const docListeners = {};
  const store = { ...stored };
  const writes = [];

  const context = {
    document: {
      getElementById: (id) => els[id],
      addEventListener: (type, fn) => (docListeners[type] ??= []).push(fn),
    },
    setTimeout: () => 0,
    chrome: {
      storage: {
        sync: {
          get: async (keys) => {
            if (getFails) throw new Error('storage unavailable');
            const list = typeof keys === 'string' ? [keys] : keys;
            return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
          },
          set: async (changes) => {
            if (setFails) throw new Error('quota');
            writes.push(changes);
            Object.assign(store, changes);
          },
          remove: async (key) => {
            delete store[key];
          },
        },
      },
    },
  };
  if (firefox) {
    // Firefox: `browser` is promise-based, `chrome` is callback-only and returns undefined
    context.browser = context.chrome;
    const noop = () => undefined;
    context.chrome = { storage: { sync: { get: noop, set: noop, remove: noop } } };
  }
  vm.createContext(context);
  vm.runInContext(source, context);

  const page = {
    els,
    store,
    writes,
    open: async () => {
      for (const fn of docListeners.DOMContentLoaded) await fn();
    },
    submit: async () => {
      els['settings-form'].fire('submit');
      await tick();
    },
    clear: async () => {
      els.clearKey.fire('click');
      await tick();
    },
  };
  return page;
}

test('the saved API key is never put back into the form', async () => {
  const page = load({ stored: { apiKey: 'SECRET', listId: 'L', quickAddTarget: 'notes' } });
  await page.open();
  assert.equal(page.els.apiKey.value, '');
  assert.match(page.els.apiKey.placeholder, /Saved/);
  assert.equal(page.els.clearKey.hidden, false);
  assert.equal(page.els.listId.value, 'L');
  assert.equal(page.els.quickAddTarget.value, 'notes');
});

test('other settings can be changed without retyping the key, and the key is untouched', async () => {
  const page = load({ stored: { apiKey: 'SECRET', listId: 'old', quickAddTarget: 'title' } });
  await page.open();
  page.els.listId.value = ' new ';
  page.els.quickAddTarget.value = 'notes';
  await page.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(page.writes)), [{ listId: 'new', quickAddTarget: 'notes' }]);
  assert.equal(page.store.apiKey, 'SECRET');
  assert.match(page.els.status.textContent, /saved/i);
  assert.match(page.els.status.className, /success/);
});

test('a newly typed key replaces the saved one, and the field is cleared afterwards', async () => {
  const page = load({ stored: { apiKey: 'OLD' } });
  await page.open();
  page.els.apiKey.value = '  NEW  ';
  await page.submit();
  assert.equal(page.store.apiKey, 'NEW');
  assert.equal(page.els.apiKey.value, '');
});

test('the first save still needs a key', async () => {
  const page = load();
  await page.open();
  assert.equal(page.els.clearKey.hidden, true);
  page.els.listId.value = 'L';
  await page.submit();
  assert.deepEqual(page.writes, []);
  assert.match(page.els.status.textContent, /API key/);
  assert.match(page.els.status.className, /error/);

  page.els.apiKey.value = 'K';
  await page.submit();
  assert.equal(page.store.apiKey, 'K');
  assert.equal(page.els.clearKey.hidden, false);
});

test('clearing removes only the key', async () => {
  const page = load({ stored: { apiKey: 'K', listId: 'L' } });
  await page.open();
  await page.clear();
  assert.ok(!('apiKey' in page.store));
  assert.equal(page.store.listId, 'L');
  assert.equal(page.els.clearKey.hidden, true);
  assert.doesNotMatch(page.els.apiKey.placeholder, /Saved/);
});

test('storage failures are reported instead of leaving a silent blank form', async () => {
  const loading = load({ getFails: true });
  await loading.open();
  assert.match(loading.els.status.textContent, /Error loading settings: storage unavailable/);

  const saving = load({ stored: { apiKey: 'K' }, setFails: true });
  await saving.open();
  await saving.submit();
  assert.match(saving.els.status.textContent, /Error saving settings: quota/);
  assert.match(saving.els.status.className, /error/);
});

test('the key field is not required by the browser and opts out of password autofill', () => {
  const html = readFileSync(join(ROOT, 'options.html'), 'utf8');
  const field = html.match(/<input[^>]*id="apiKey"[^>]*>/)[0];
  assert.doesNotMatch(field, /\brequired\b/);
  assert.match(field, /autocomplete="new-password"/);
});

test('in Firefox, where chrome.* returns undefined, settings still load and save', async () => {
  const page = load({ firefox: true, stored: { apiKey: 'SECRET', listId: 'L' } });
  await page.open();
  assert.equal(page.els.listId.value, 'L');
  assert.equal(page.els.clearKey.hidden, false);
  page.els.listId.value = 'M';
  await page.submit();
  assert.match(page.els.status.className, /success/);
  assert.equal(page.store.listId, 'M');
  assert.equal(page.store.apiKey, 'SECRET');
});
