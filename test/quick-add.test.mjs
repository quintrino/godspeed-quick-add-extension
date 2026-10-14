import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { ROOT } from '../scripts/build.mjs';
import { FakeElement, makeDocument } from './fake-dom.mjs';

const contentSource = readFileSync(join(ROOT, 'content.js'), 'utf8');
const quickSource = readFileSync(join(ROOT, 'quick.js'), 'utf8');

const EXTENSION_ORIGIN = 'chrome-extension://abc123';

// Objects made inside the vm sandbox have a different prototype; compare them as plain JSON
const plain = (v) => JSON.parse(JSON.stringify(v));
const key = (k, extra) => ({ key: k, ...extra });
const tick = () => new Promise((r) => setImmediate(r));

// ── The box on the page (content.js) ─────────────────────────────────────────

function loadContent({ sendMessage } = {}) {
  const document = makeDocument();
  const sent = [];
  const messageListeners = [];
  const windowListeners = {};
  const timers = new Map();
  const cleared = [];
  let nextTimer = 1;

  const window = {
    addEventListener: (type, fn) => (windowListeners[type] ??= []).push(fn),
    removeEventListener: (type, fn) => {
      windowListeners[type] = (windowListeners[type] ?? []).filter((f) => f !== fn);
    },
  };
  const context = {
    document,
    window,
    setTimeout: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      cleared.push(id);
      timers.delete(id);
    },
    chrome: {
      runtime: {
        getURL: (path) => `${EXTENSION_ORIGIN}/${path}`,
        onMessage: { addListener: (fn) => messageListeners.push(fn) },
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
  const frame = () => host()?.shadow.find((e) => e.tagName === 'iframe');
  // A postMessage arriving at the page's window, as the browser would deliver it
  const post = (data, origin = EXTENSION_ORIGIN) =>
    (windowListeners.message ?? []).slice().forEach((fn) => fn({ origin, data }));
  const runTimers = () => {
    for (const [id, { fn }] of [...timers]) {
      timers.delete(id);
      fn();
    }
  };
  return { context, document, sent, messageListeners, windowListeners, timers, cleared, host, frame, post, runTimers };
}

test('the shortcut message shows the box and confirms to the background', () => {
  const t = loadContent();
  let reply;
  t.messageListeners[0]({ action: 'openQuickAdd' }, {}, (r) => (reply = r));
  assert.deepEqual(plain(reply), { ok: true });
  assert.ok(t.host(), 'box is on the page');
  assert.equal(t.host().shadowMode, 'closed');
});

test('the box is the extension\'s own page in a frame, with no input in the page itself', () => {
  const t = loadContent();
  t.context.openQuickAdd();

  assert.equal(t.frame().src, `${EXTENSION_ORIGIN}/quick.html`);
  // The page's own document must hold nothing editable, or key handlers such as
  // Vimium's would run on what is typed. The input lives inside the extension frame.
  const isInput = (e) => e.tagName === 'input' || e.tagName === 'textarea';
  assert.equal(t.document.body.find(isInput), null);
  assert.equal(t.host().shadow.find(isInput), null);
});

test('the frame is styled without a <style> tag and sits in a closed shadow root', () => {
  const t = loadContent();
  t.context.openQuickAdd();

  assert.equal(t.host().shadowMode, 'closed');
  assert.ok(!t.host().shadow.find((e) => e.tagName === 'style'));
  assert.match(t.frame().style.cssText, /width: 100%/);
  assert.match(t.host().style.cssText, /z-index: 2147483647/);
});

test('the frame is focused when opened, when it loads, and when it reports ready', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  assert.equal(t.frame().focused, true, 'focused as soon as it is added');

  t.frame().focused = false;
  t.frame().fire('load');
  assert.equal(t.frame().focused, true, 'focused again once loaded');

  t.frame().focused = false;
  t.post({ godspeedQuickAdd: 'ready' });
  assert.equal(t.frame().focused, true, 'and once the page inside says it is ready');
});

test('pressing the shortcut again reuses the open box instead of stacking another', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  t.frame().focused = false;

  t.context.openQuickAdd();

  assert.equal(t.document.body.children.filter((e) => e.id === 'godspeed-quick-add').length, 1);
  assert.equal(t.frame().focused, true);
  assert.equal(t.windowListeners.message.length, 1, 'one message listener, not two');
});

test('when the frame says close, the box is removed and the listener is dropped', () => {
  const t = loadContent();
  t.context.openQuickAdd();

  t.post({ godspeedQuickAdd: 'close' });

  assert.equal(t.host(), null);
  assert.equal(t.windowListeners.message.length, 0);
  assert.equal(t.sent.length, 0, 'closing sends nothing; the frame sent the text itself');
});

test('closing cancels the pending fallback timer', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  assert.equal(t.timers.size, 1);

  t.post({ godspeedQuickAdd: 'close' });
  t.runTimers();

  assert.equal(t.timers.size, 0);
  assert.equal(t.sent.length, 0, 'no fallback window is requested after a normal close');
});

test('once the frame is ready the fallback is cancelled and the box stays', () => {
  const t = loadContent();
  t.context.openQuickAdd();

  t.post({ godspeedQuickAdd: 'ready' });
  t.runTimers();

  assert.equal(t.cleared.length >= 1, true);
  assert.ok(t.host(), 'box still open');
  assert.equal(t.sent.length, 0);
});

test('if the frame never reports ready, the box is removed and the fallback window is requested', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  assert.equal([...t.timers.values()][0].ms, 1000);

  t.runTimers();

  assert.equal(t.host(), null);
  assert.deepEqual(plain(t.sent), [{ action: 'openQuickAddWindow' }]);
  assert.equal(t.windowListeners.message.length, 0);
});

test('a failing sendMessage while falling back (extension reloaded) does not throw', () => {
  for (const sendMessage of [
    () => { throw new Error('Extension context invalidated'); },
    () => Promise.reject(new Error('x')),
  ]) {
    const t = loadContent({ sendMessage });
    t.context.openQuickAdd();
    assert.doesNotThrow(() => t.runTimers());
    assert.equal(t.host(), null);
  }
});

test('messages from the page or other origins cannot close the box or mark it ready', () => {
  const t = loadContent();
  t.context.openQuickAdd();

  t.post({ godspeedQuickAdd: 'close' }, 'https://evil.test');
  t.post({ godspeedQuickAdd: 'ready' }, 'https://evil.test');
  t.post({ godspeedQuickAdd: 'close' }, 'chrome-extension://someoneelse');

  assert.ok(t.host(), 'still open');
  assert.equal(t.cleared.length, 0, 'the fallback timer was not cancelled');
  t.runTimers();
  assert.deepEqual(plain(t.sent), [{ action: 'openQuickAddWindow' }], 'so the fallback still happens');
});

test('malformed messages from the extension origin are ignored', () => {
  const t = loadContent();
  t.context.openQuickAdd();

  for (const data of [null, undefined, 'close', 42, {}, { godspeedQuickAdd: 'nonsense' }]) {
    assert.doesNotThrow(() => t.post(data));
  }
  assert.ok(t.host());
});

test('the box can be reopened after it was closed, and after the page removed it', () => {
  const t = loadContent();
  t.context.openQuickAdd();
  t.post({ godspeedQuickAdd: 'close' });
  t.context.openQuickAdd();
  assert.ok(t.host());
  t.host().remove(); // page script wiped it
  t.context.openQuickAdd();
  assert.ok(t.host());
  assert.equal(t.document.body.children.filter((e) => e.id === 'godspeed-quick-add').length, 1);
});

// ── The input page (quick.html / quick.js) ───────────────────────────────────

function loadQuickPage({ embedded = false, search = embedded ? '' : '?tabId=8' } = {}) {
  const input = new FakeElement('input');
  const sent = [];
  const closed = [];
  const timers = [];
  const posted = [];
  const windowListeners = {};
  const parent = { postMessage: (message, target) => posted.push({ message, target }) };
  const win = {
    close: () => closed.push(true),
    addEventListener: (type, fn) => (windowListeners[type] ??= []).push(fn),
  };
  win.parent = embedded ? parent : win; // a top-level window is its own parent
  const context = {
    URLSearchParams,
    location: { search },
    document: { getElementById: (id) => (id === 'text' ? input : null) },
    window: win,
    setTimeout: (fn) => timers.push(fn),
    chrome: { runtime: { sendMessage: async (msg) => { sent.push(msg); } } },
  };
  vm.createContext(context);
  vm.runInContext(quickSource, context);
  const fire = (type) => (windowListeners[type] ?? []).forEach((fn) => fn({ type }));
  return { input, sent, closed, timers, posted, windowListeners, fire };
}

const messages = (w) => plain(w.posted.map((p) => p.message));

test('embedded: focuses the input and tells the page it is ready', () => {
  const w = loadQuickPage({ embedded: true });
  assert.equal(w.input.focused, true);
  assert.deepEqual(messages(w), [{ godspeedQuickAdd: 'ready' }]);
});

test('embedded: Enter sends the trimmed text for the sender tab, then asks the page to close', async () => {
  const w = loadQuickPage({ embedded: true });
  w.input.value = ' read later ';
  const event = w.input.fire('keydown', key('Enter'));
  await tick();
  assert.ok(event.defaultPrevented);
  assert.deepEqual(plain(w.sent), [{ action: 'quickAdd', text: 'read later' }]); // no tabId: background uses the sender tab
  assert.deepEqual(messages(w).slice(1), [{ godspeedQuickAdd: 'close' }]);
  assert.equal(w.closed.length, 0, 'a frame cannot close itself; the page removes it');
});

test('embedded: Escape closes without sending', () => {
  const w = loadQuickPage({ embedded: true });
  w.input.value = 'half typed';
  w.input.fire('keydown', key('Escape'));
  assert.equal(w.sent.length, 0);
  assert.deepEqual(messages(w).slice(1), [{ godspeedQuickAdd: 'close' }]);
});

test('embedded: empty Enter does nothing and IME composition is ignored', async () => {
  const w = loadQuickPage({ embedded: true });
  w.input.value = '   ';
  w.input.fire('keydown', key('Enter'));
  w.input.value = 'にほん';
  w.input.fire('keydown', key('Enter', { isComposing: true }));
  w.input.fire('keydown', key('Enter', { keyCode: 229 }));
  await tick();
  assert.equal(w.sent.length, 0);
  assert.equal(messages(w).length, 1, 'only the ready message');
});

test('embedded: clicking back into the page closes the box, and regaining focus refocuses the input', () => {
  const w = loadQuickPage({ embedded: true });
  w.input.focused = false;
  w.fire('focus');
  assert.equal(w.input.focused, true);
  w.fire('blur');
  assert.deepEqual(messages(w).slice(1), [{ godspeedQuickAdd: 'close' }]);
});

test('embedded: messages to the page carry no typed text', async () => {
  const w = loadQuickPage({ embedded: true });
  w.input.value = 'secret note';
  w.input.fire('keydown', key('Enter'));
  await tick();
  assert.ok(!JSON.stringify(messages(w)).includes('secret note'));
});

test('fallback window: focuses on load, Enter sends text with the target tab and closes', async () => {
  const w = loadQuickPage({ search: '?tabId=8' });
  assert.equal(w.input.focused, true);
  w.input.value = ' read later ';
  w.input.fire('keydown', key('Enter'));
  await tick();
  assert.deepEqual(plain(w.sent), [{ action: 'quickAdd', text: 'read later', tabId: 8 }]);
  assert.equal(w.closed.length >= 1, true);
  assert.equal(w.posted.length, 0, 'a top-level window has no page to message');
});

test('fallback window: no ready message and no close-on-blur', () => {
  const w = loadQuickPage({ search: '?tabId=8' });
  assert.equal(w.posted.length, 0);
  assert.equal(w.windowListeners.blur, undefined);
});

test('fallback window: empty Enter does nothing, Escape closes, IME is ignored', async () => {
  const w = loadQuickPage();
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
  const w = loadQuickPage({ search: '' });
  w.input.value = 'note';
  w.input.fire('keydown', key('Enter'));
  await tick();
  assert.deepEqual(plain(w.sent), [{ action: 'quickAdd', text: 'note' }]); // no tabId: background falls back to the sender tab
});
