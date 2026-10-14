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
// A single input that appears already focused. Enter sends the text to the
// background script (the box closes immediately, so it feels instant) and
// Escape cancels. Styles are set through the CSSOM rather than a <style> tag
// so strict page CSPs can't block them, and live in a shadow root so the page
// can't restyle the box.

let quickAddHost = null;
let quickAddInput = null;

function quickAddKeyAction(event) {
  // Enter that confirms an IME composition (e.g. Japanese input) must not submit
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.key === 'Enter') return 'submit';
  if (event.key === 'Escape') return 'cancel';
  return null;
}

function openQuickAdd() {
  // Already open: keep typing where you left off
  if (quickAddHost && quickAddHost.isConnected) {
    quickAddInput.focus();
    return;
  }

  const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

  const host = document.createElement('div');
  host.id = 'godspeed-quick-add';
  host.style.cssText =
    'all: initial; position: fixed; top: 18vh; left: 50%; transform: translateX(-50%);' +
    'width: min(560px, 90vw); z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Add to Godspeed — Enter to save, Esc to cancel';
  input.setAttribute('autocomplete', 'off');
  input.style.cssText =
    'box-sizing: border-box; width: 100%; padding: 14px 16px; font-size: 18px;' +
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
    'border-radius: 10px; outline: none; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);' +
    (dark
      ? 'background: #1f2937; color: #f9fafb; border: 1px solid #4b5563;'
      : 'background: #ffffff; color: #111827; border: 1px solid #d1d5db;');

  input.addEventListener('keydown', onQuickAddKeydown);
  // Keep the page's own shortcuts from reacting to what is typed here
  input.addEventListener('keyup', (e) => e.stopPropagation());
  input.addEventListener('keypress', (e) => e.stopPropagation());
  input.addEventListener('blur', closeQuickAdd);

  root.appendChild(input);
  (document.body || document.documentElement).appendChild(host);
  quickAddHost = host;
  quickAddInput = input;
  input.focus();
}

function closeQuickAdd() {
  if (!quickAddHost) return;
  const host = quickAddHost;
  quickAddHost = null;
  quickAddInput = null;
  host.remove();
}

function onQuickAddKeydown(event) {
  event.stopPropagation();
  const action = quickAddKeyAction(event);
  if (!action) return;
  event.preventDefault();

  if (action === 'cancel') {
    closeQuickAdd();
    return;
  }

  const text = quickAddInput.value.trim();
  if (!text) return; // Enter on an empty box does nothing
  closeQuickAdd();
  try {
    const sent = chrome.runtime.sendMessage({ action: 'quickAdd', text });
    if (sent && sent.catch) sent.catch(() => {});
  } catch (error) {
    // Extension was reloaded while the page stayed open; nothing more we can do
  }
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
