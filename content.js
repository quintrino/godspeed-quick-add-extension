// Content script to show notifications on the webpage

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showNotification') {
    showNotification(request.type, request.message, request.duration);
  }
});

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
