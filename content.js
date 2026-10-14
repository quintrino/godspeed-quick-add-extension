// Content script: shows notifications and the quick-add box on the webpage

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showNotification') {
    showNotification(request.type, request.message, request.duration);
  } else if (request.action === 'openQuickAdd') {
    openQuickAdd();
    // Lets the background script know this page can show the box (no fallback needed)
    sendResponse({ ok: true });
  }
});

// ── Quick add ───────────────────────────────────────────────────────────────
// The box is the extension's own page (quick.html) shown in an iframe. It has to
// be: if the input lived in the web page, the page's key handlers, and those of
// other extensions such as Vimium, would run on every keystroke (they listen on
// the window before the input does, and can't tell a field inside a shadow root
// is editable), so shortcut keys would trigger their commands instead of typing.
// Keystrokes inside the frame never reach the page's document at all.
//
// The frame reports back with postMessage: 'ready' once it has loaded and 'close'
// when the user is done. If 'ready' doesn't arrive (a page whose CSP blocks the
// frame), the background script opens the small fallback window instead. The
// frame sits in a shadow root so the page can't restyle it.

const QUICK_ADD_READY_TIMEOUT_MS = 1000;

let quickAddHost = null;
let quickAddFrame = null;
let quickAddTimer = null;

// Messages from the frame carry the extension's origin; the page can't fake that
function quickAddOrigin() {
  return chrome.runtime.getURL('').replace(/\/$/, '');
}

function focusQuickAdd() {
  if (!quickAddFrame) return;
  quickAddFrame.focus();
  try {
    quickAddFrame.contentWindow.focus();
  } catch (error) {
    // Not reachable yet; the frame focuses its own input once it loads
  }
}

function openQuickAdd() {
  // Already open: keep typing where you left off
  if (quickAddHost && quickAddHost.isConnected) {
    focusQuickAdd();
    return;
  }

  const host = document.createElement('div');
  host.id = 'godspeed-quick-add';
  host.style.cssText =
    'all: initial; position: fixed; top: 18vh; left: 50%; transform: translateX(-50%);' +
    'width: min(560px, 90vw); z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });

  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('quick.html');
  frame.title = 'Add to Godspeed';
  frame.style.cssText =
    'all: initial; display: block; width: 100%; height: 62px; border: 0;' +
    'border-radius: 10px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);';
  frame.addEventListener('load', focusQuickAdd);

  root.appendChild(frame);
  (document.body || document.documentElement).appendChild(host);
  quickAddHost = host;
  quickAddFrame = frame;

  window.addEventListener('message', onQuickAddMessage);
  quickAddTimer = setTimeout(quickAddUnavailable, QUICK_ADD_READY_TIMEOUT_MS);
  focusQuickAdd();
}

function onQuickAddMessage(event) {
  if (event.origin !== quickAddOrigin()) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.godspeedQuickAdd === 'ready') {
    clearTimeout(quickAddTimer);
    quickAddTimer = null;
    focusQuickAdd();
  } else if (data.godspeedQuickAdd === 'close') {
    closeQuickAdd();
  }
}

// The frame never loaded, so ask the background script for the fallback window
function quickAddUnavailable() {
  closeQuickAdd();
  try {
    const sent = chrome.runtime.sendMessage({ action: 'openQuickAddWindow' });
    if (sent && sent.catch) sent.catch(() => {});
  } catch (error) {
    // Extension was reloaded while the page stayed open; nothing more we can do
  }
}

function closeQuickAdd() {
  clearTimeout(quickAddTimer);
  quickAddTimer = null;
  window.removeEventListener('message', onQuickAddMessage);
  if (!quickAddHost) return;
  const host = quickAddHost;
  quickAddHost = null;
  quickAddFrame = null;
  host.remove();
}

function showNotification(type, message, duration) {
  // Remove any existing notifications
  const existing = document.getElementById('godspeed-notification');
  if (existing) {
    existing.remove();
  }

  // Create notification element
  const notification = document.createElement('div');
  notification.id = 'godspeed-notification';
  notification.className = `godspeed-notification godspeed-${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  // Trigger animation
  setTimeout(() => {
    notification.classList.add('godspeed-show');
  }, 10);

  // Remove after duration
  setTimeout(() => {
    notification.classList.remove('godspeed-show');
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, duration);
}
