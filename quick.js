// The quick-add input page. It runs in two places:
//
//  - Embedded: content.js frames this page inside the web page. It is a separate
//    document, so the page's own scripts and other extensions' key handlers (Vimium
//    and friends) never see what is typed here. This is the normal case.
//  - In a small popup window, on pages that can't show the frame (new tab, about:,
//    chrome://, the extension stores, or a page whose CSP blocks the frame).
//
// Either way: type, press Enter, done. Escape cancels.

const embedded = window.parent !== window;
const tabId = Number(new URLSearchParams(location.search).get('tabId')) || undefined;
const input = document.getElementById('text');

// Closing is the parent page's job when embedded, and the window's own otherwise
function finish() {
  if (embedded) {
    window.parent.postMessage({ godspeedQuickAdd: 'close' }, '*');
  } else {
    window.close();
  }
}

input.focus();

if (embedded) {
  // Focus can land on the frame before the input; hand it on
  window.addEventListener('focus', () => input.focus());
  // Clicking back into the page closes the box, as a dialog would
  window.addEventListener('blur', finish);
  // Tells content.js the frame loaded, so it doesn't fall back to a window
  window.parent.postMessage({ godspeedQuickAdd: 'ready' }, '*');
}

input.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;

  if (event.key === 'Escape') {
    finish();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    // Close once the message is on its way (or after a short cap, whichever is first)
    setTimeout(finish, 500);
    Promise.resolve(chrome.runtime.sendMessage({ action: 'quickAdd', text, tabId }))
      .catch(() => {})
      .then(finish);
  }
});
