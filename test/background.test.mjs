import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { ROOT } from '../scripts/build.mjs';

const source = readFileSync(join(ROOT, 'background.js'), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

/** Load background.js in a sandbox with a fake extension API and fetch. */
function load({
  api = 'chrome',
  fetchImpl,
  settings = {},
  tabUrl = 'https://example.com',
  activeTabs = [],
  sendMessageImpl,
} = {}) {
  const calls = { messages: [], clicks: [], commands: [], fetches: [], runtime: [], windows: [] };
  const listener = (list) => ({ addListener: (fn) => list.push(fn) });
  const extension = {
    commands: { onCommand: listener(calls.commands) },
    tabs: {
      query: async () => activeTabs,
      get: async (id) => ({ id, url: tabUrl, title: `tab ${id}` }),
      sendMessage: async (id, msg) => {
        calls.messages.push({ id, ...msg });
        return sendMessageImpl ? sendMessageImpl(id, msg) : undefined;
      },
    },
    runtime: {
      onMessage: listener(calls.runtime),
      getURL: (path) => `chrome-extension://test/${path}`,
    },
    windows: { create: async (opts) => calls.windows.push(opts) },
    storage: { sync: { get: async () => settings } },
  };
  if (api === 'browser-mv2') extension.browserAction = { onClicked: listener(calls.clicks) };
  else extension.action = { onClicked: listener(calls.clicks) };

  const context = {
    console: { log() {}, error() {} },
    fetch: async (url, init) => {
      calls.fetches.push({ url, init });
      return fetchImpl(url, init);
    },
  };
  if (api === 'browser-mv2') context.browser = extension;
  else context.chrome = extension;

  vm.createContext(context);
  vm.runInContext(source, context);
  return { ctx: context, calls, extension };
}

const ok = (json = {}) => ({ ok: true, status: 200, json: async () => json });
const fail = (status, text) => ({ ok: false, status, text: async () => text });

test('registers the icon click handler for MV3 (action) and MV2 (browserAction)', () => {
  assert.equal(load({ api: 'chrome' }).calls.clicks.length, 1);
  assert.equal(load({ api: 'browser-mv2' }).calls.clicks.length, 1);
  assert.equal(load().calls.commands.length, 1);
});

test('sendTab posts the tab title and url to the Godspeed API', async () => {
  const { ctx, calls } = load({ fetchImpl: () => ok({ id: 't1' }) });
  const result = await ctx.sendTab({ title: 'Hi', url: 'https://x.test/' }, 'KEY', '');
  assert.deepEqual(result, { id: 't1' });
  const { url, init } = calls.fetches[0];
  assert.equal(url, 'https://api.godspeedapp.com/tasks');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer KEY');
  assert.deepEqual(JSON.parse(init.body), { title: 'title: Hi url: https://x.test/' });
});

test('sendTab includes a trimmed list_id only when one is set', async () => {
  const { ctx, calls } = load({ fetchImpl: () => ok() });
  await ctx.sendTab({ title: 'a', url: 'u' }, 'K', '  list-1  ');
  await ctx.sendTab({ title: 'a', url: 'u' }, 'K', '   ');
  await ctx.sendTab({ title: 'a', url: 'u' }, 'K', undefined);
  assert.equal(JSON.parse(calls.fetches[0].init.body).list_id, 'list-1');
  assert.ok(!('list_id' in JSON.parse(calls.fetches[1].init.body)));
  assert.ok(!('list_id' in JSON.parse(calls.fetches[2].init.body)));
});

test('sendTab surfaces the API error message, or the HTTP status for non-JSON errors', async () => {
  let res = fail(401, JSON.stringify({ message: 'Bad token' }));
  const { ctx } = load({ fetchImpl: () => res });
  await assert.rejects(ctx.sendTab({ title: 'a', url: 'u' }, 'K'), { message: 'Bad token' });
  res = fail(500, JSON.stringify({ error: 'Boom' }));
  await assert.rejects(ctx.sendTab({ title: 'a', url: 'u' }, 'K'), { message: 'Boom' });
  res = fail(502, '<html>gateway</html>');
  await assert.rejects(ctx.sendTab({ title: 'a', url: 'u' }, 'K'), /HTTP 502: <html>gateway/);
});

test('without an API key the user is told to configure one and nothing is sent', async () => {
  const { ctx, calls } = load({ fetchImpl: () => ok(), settings: {} });
  await ctx.sendTabsToGodspeed([{ id: 7, title: 't', url: 'https://x.test' }]);
  await tick();
  assert.equal(calls.fetches.length, 0);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].type, 'error');
  assert.match(calls.messages[0].message, /API key/);
});

test('sending several tabs reports one combined success', async () => {
  const { ctx, calls } = load({ fetchImpl: () => ok(), settings: { apiKey: 'K' } });
  const tabs = [1, 2, 3].map((id) => ({ id, title: `t${id}`, url: `https://x.test/${id}` }));
  await ctx.sendTabsToGodspeed(tabs);
  await tick();
  assert.equal(calls.fetches.length, 3);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].type, 'success');
  assert.match(calls.messages[0].message, /3 tabs sent/);
});

test('a failing tab is reported as an error on that tab', async () => {
  const { ctx, calls } = load({
    fetchImpl: () => fail(400, JSON.stringify({ message: 'nope' })),
    settings: { apiKey: 'K' },
  });
  await ctx.sendTabsToGodspeed([{ id: 9, title: 'Broken', url: 'https://x.test' }]);
  await tick();
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].id, 9);
  assert.equal(calls.messages[0].type, 'error');
  assert.match(calls.messages[0].message, /Failed to send "Broken": nope/);
});

test('notifications are not sent to browser-internal pages', async () => {
  for (const tabUrl of ['about:blank', 'chrome://extensions']) {
    const { ctx, calls } = load({ fetchImpl: () => ok(), settings: {}, tabUrl });
    await ctx.sendTabsToGodspeed([{ id: 1, title: 't', url: tabUrl }]);
    await tick();
    assert.equal(calls.messages.length, 0, tabUrl);
  }
});

// ── Quick add ─────────────────────────────────────────────────────────────────

const quickCommand = (ctx, calls) => calls.commands[0]('quick-add-to-godspeed');
const sendRuntime = (calls, message, sender = {}) => calls.runtime[0](message, sender);
const taskTitle = (calls) => JSON.parse(calls.fetches[0].init.body).title;

test('quick-add text goes at the front of the task title', async () => {
  const { ctx, calls } = load({ fetchImpl: () => ok(), settings: { apiKey: 'K' } });
  await ctx.sendTab({ title: 'Page', url: 'https://x.test/' }, 'K', '', 'buy milk');
  assert.equal(taskTitle(calls), 'buy milk title: Page url: https://x.test/');
});

test('without quick-add text the title format is unchanged', async () => {
  const { ctx, calls } = load({ fetchImpl: () => ok() });
  await ctx.sendTab({ title: 'Page', url: 'https://x.test/' }, 'K', '', undefined);
  assert.equal(taskTitle(calls), 'title: Page url: https://x.test/');
});

test('the quick-add shortcut asks the active tab to show its box', async () => {
  const { ctx, calls } = load({
    activeTabs: [{ id: 5, url: 'https://x.test' }],
    sendMessageImpl: () => ({ ok: true }),
  });
  await quickCommand(ctx, calls);
  assert.deepEqual(calls.messages, [{ id: 5, action: 'openQuickAdd' }]);
  assert.equal(calls.windows.length, 0);
});

test('quick add falls back to a small window when the page cannot show the box', async () => {
  for (const sendMessageImpl of [
    () => undefined, // no content script answered
    () => { throw new Error('Receiving end does not exist'); },
  ]) {
    const { ctx, calls } = load({ activeTabs: [{ id: 8, url: 'about:newtab' }], sendMessageImpl });
    await quickCommand(ctx, calls);
    assert.equal(calls.windows.length, 1);
    assert.equal(calls.windows[0].url, 'chrome-extension://test/quick.html?tabId=8');
    assert.equal(calls.windows[0].type, 'popup');
    assert.equal(calls.windows[0].focused, true);
  }
});

test('quick add does nothing when there is no active tab', async () => {
  const { ctx, calls } = load({ activeTabs: [] });
  await quickCommand(ctx, calls);
  assert.equal(calls.messages.length, 0);
  assert.equal(calls.windows.length, 0);
});

test('typed text from the page box creates a task for that page with the text first', async () => {
  const { calls } = load({ fetchImpl: () => ok(), settings: { apiKey: 'K', listId: 'L' } });
  await sendRuntime(
    calls,
    { action: 'quickAdd', text: '  call dentist  ' },
    { tab: { id: 3, title: 'Clinic', url: 'https://clinic.test/' } },
  );
  await tick();
  assert.equal(calls.fetches.length, 1);
  const body = JSON.parse(calls.fetches[0].init.body);
  assert.equal(body.title, 'call dentist title: Clinic url: https://clinic.test/');
  assert.equal(body.list_id, 'L');
});

test('typed text from the fallback window targets the tab named in the message', async () => {
  const { calls } = load({ fetchImpl: () => ok(), settings: { apiKey: 'K' } });
  await sendRuntime(
    calls,
    { action: 'quickAdd', text: 'read later', tabId: 42 },
    { tab: { id: 999, title: 'the popup window', url: 'chrome-extension://test/quick.html' } },
  );
  await tick();
  assert.equal(taskTitle(calls), 'read later title: tab 42 url: https://example.com');
});

test('empty quick-add text and unrelated messages create nothing', async () => {
  const { calls } = load({ fetchImpl: () => ok(), settings: { apiKey: 'K' } });
  const sender = { tab: { id: 1, title: 't', url: 'u' } };
  await sendRuntime(calls, { action: 'quickAdd', text: '   ' }, sender);
  await sendRuntime(calls, { action: 'quickAdd' }, sender);
  await sendRuntime(calls, { action: 'somethingElse', text: 'x' }, sender);
  await sendRuntime(calls, undefined, sender);
  await tick();
  assert.equal(calls.fetches.length, 0);
});

test('the existing send shortcut still sends the tab immediately, without a box', async () => {
  const { calls } = load({
    fetchImpl: () => ok(),
    settings: { apiKey: 'K' },
    activeTabs: [{ id: 1, title: 'Page', url: 'https://x.test/' }],
  });
  await calls.commands[0]('send-to-godspeed');
  await tick();
  assert.equal(taskTitle(calls), 'title: Page url: https://x.test/');
  assert.equal(calls.windows.length, 0);
  assert.ok(!calls.messages.some((m) => m.action === 'openQuickAdd'));
});
