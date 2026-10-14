import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { ROOT } from '../scripts/build.mjs';
import { FakeElement, makeDocument } from './fake-dom.mjs';

const contentSource = readFileSync(join(ROOT, 'content.js'), 'utf8');
const quickSource = readFileSync(join(ROOT, 'quick.js'), 'utf8');

function loadContent({ dark = false, sendMessage } = {}) {
  const document = makeDocument();
  const sent = [];
  const listeners = [];
  const context = {
    document,
    setTimeout: () => 0,
    matchMedia: () => ({ matches: dark }),
    chrome: {
      runtime: {
        onMessage: { addListener: (fn) => listeners.push(fn) },
        sendMessage: (msg) => {
          sent.push(msg);
          return sendMessage ? sendMessage(msg) : Promise.resolve();
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(contentSource, context);
  const host = () => document.body.find((e) => e.id === 'godspeed-quick-add');
  const input = () => host()?.shadow.find((e) => e.tagName === 'input');
  return { context, document, sent, listeners, host, input };
}

const key = (k, extra) => ({ key: k, ...extra });
// Objects made inside the vm sandbox have a different prototype; compare them as plain JSON
const plain = (v) => JSON.parse(JSON.stringify(v));

test('Enter submits, Escape cancels, and IME composition is ignored', () => {
  const { context } = loadContent();
  assert.equal(context.quickAddKeyAction(key('Enter')), 'submit');
  assert.equal(context.quickAddKeyAction(key('Escape')), 'cancel');
  assert.equal(context.quickAddKeyAction(key('a')), null);
  assert.equal(context.quickAddKeyAction(key('Enter', { isComposing: true })), null);
  assert.equal(context.quickAddKeyAction(key('Enter', { keyCode: 229 })), null);
});

test('the shortcut message shows a focused input immediately and confirms to the background', () => {
  const t = loadContent();
  let reply;
  t.listeners[0]({ action: 'openQuickAdd' }, {}, (r) => (reply = r));
  assert.deepEqual(plain(reply), { ok: true });
  assert.ok(t.host(), 'box is on the page');
  assert.equal(t.input().focused, true, 'input is focused so typing can start at once');
  assert.equal(t.host().shadowMode, 'closed');
});

test('typing then Enter sends the trimmed text and closes the box straight away', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  t.input().value = '  buy milk  ';
  const input = t.input();
  const event = input.fire('keydown', key('Enter'));
  assert.deepEqual(plain(t.sent), [{ action: 'quickAdd', text: 'buy milk' }]);
  assert.equal(t.host(), null, 'box is gone');
  assert.ok(event.defaultPrevented);
});

test('Enter on an empty box sends nothing and keeps the box open', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  for (const value of ['', '   ']) {
    t.input().value = value;
    t.input().fire('keydown', key('Enter'));
  }
  assert.equal(t.sent.length, 0);
  assert.ok(t.host());
});

test('Escape closes without sending, and the page never sees the keystrokes', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  t.input().value = 'half typed';
  const input = t.input();
  assert.ok(input.fire('keydown', key('x')).propagationStopped);
  assert.ok(input.fire('keyup', key('x')).propagationStopped);
  assert.ok(input.fire('keypress', key('x')).propagationStopped);
  input.fire('keydown', key('Escape'));
  assert.equal(t.sent.length, 0);
  assert.equal(t.host(), null);
});

test('Enter while an IME composition is active does not submit', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  t.input().value = 'にほん';
  t.input().fire('keydown', key('Enter', { isComposing: true }));
  assert.equal(t.sent.length, 0);
  assert.ok(t.host());
});

test('pressing the shortcut again reuses the open box instead of stacking another', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  t.input().value = 'keep me';
  t.input().focused = false;
  t.context.openQuickAdd();
  assert.equal(t.document.body.children.filter((e) => e.id === 'godspeed-quick-add').length, 1);
  assert.equal(t.input().value, 'keep me');
  assert.equal(t.input().focused, true);
});

test('the box can be reopened after it was closed, and after the page removed it', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  t.input().fire('keydown', key('Escape'));
  t.context.openQuickAdd();
  assert.ok(t.host());
  t.host().remove(); // page script wiped it
  t.context.openQuickAdd();
  assert.ok(t.host());
});

test('losing focus closes the box', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  t.input().fire('blur');
  assert.equal(t.host(), null);
});

test('light and dark pages get matching colours, set without a <style> tag', () => {
  const light = loadContent({ dark: false });
  light.context.openQuickAdd();
  assert.match(light.input().style.cssText, /background: #ffffff/);
  const dark = loadContent({ dark: true });
  dark.context.openQuickAdd();
  assert.match(dark.input().style.cssText, /background: #1f2937/);
  assert.ok(!light.host().shadow.find((e) => e.tagName === 'style'));
});

test('a failing sendMessage (extension reloaded) does not throw', () => {
  for (const sendMessage of [() => { throw new Error('Extension context invalidated'); }, () => Promise.reject(new Error('x'))]) {
    const t = loadContent({ sendMessage });
    t.context.openQuickAdd();
    t.input().value = 'x';
    assert.doesNotThrow(() => t.input().fire('keydown', key('Enter')));
  }
});

// ── Fallback window (quick.html / quick.js) ───────────────────────────────────

function loadQuickWindow(search = '?tabId=8') {
  const input = new FakeElement('input');
  const sent = [];
  const closed = [];
  const timers = [];
  const context = {
    URLSearchParams,
    location: { search },
    document: { getElementById: (id) => (id === 'text' ? input : null) },
    window: { close: () => closed.push(true) },
    setTimeout: (fn) => timers.push(fn),
    chrome: { runtime: { sendMessage: async (msg) => { sent.push(msg); } } },
  };
  vm.createContext(context);
  vm.runInContext(quickSource, context);
  return { input, sent, closed, timers };
}

const tick = () => new Promise((r) => setImmediate(r));

test('fallback window: focuses on load, Enter sends text with the target tab and closes', async () => {
  const w = loadQuickWindow('?tabId=8');
  assert.equal(w.input.focused, true);
  w.input.value = ' read later ';
  w.input.fire('keydown', key('Enter'));
  await tick();
  assert.deepEqual(plain(w.sent), [{ action: 'quickAdd', text: 'read later', tabId: 8 }]);
  assert.equal(w.closed.length >= 1, true);
});

test('fallback window: empty Enter does nothing, Escape closes, IME is ignored', async () => {
  const w = loadQuickWindow();
  w.input.value = '  ';
  w.input.fire('keydown', key('Enter'));
  w.input.value = 'x';
  w.input.fire('keydown', key('Enter', { isComposing: true }));
  await tick();
  assert.equal(w.sent.length, 0);
  assert.equal(w.closed.length, 0);
  w.input.fire('keydown', key('Escape'));
  assert.equal(w.closed.length, 1);
});

test('fallback window works without a tab id in the URL', async () => {
  const w = loadQuickWindow('');
  w.input.value = 'note';
  w.input.fire('keydown', key('Enter'));
  await tick();
  assert.deepEqual(plain(w.sent), [{ action: 'quickAdd', text: 'note' }]); // no tabId: background falls back to the sender tab
});
