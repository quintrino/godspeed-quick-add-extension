// Fallback quick-add window, used on pages where the in-page box can't be shown.
// Same behaviour: type, press Enter, done.

const tabId = Number(new URLSearchParams(location.search).get('tabId')) || undefined;
const input = document.getElementById('text');
input.focus();

input.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;

  if (event.key === 'Escape') {
    window.close();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    // Close once the message is on its way (or after a short cap, whichever is first)
    setTimeout(() => window.close(), 500);
    Promise.resolve(chrome.runtime.sendMessage({ action: 'quickAdd', text, tabId }))
      .catch(() => {})
      .then(() => window.close());
  }
});
