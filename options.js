// Options page script
//
// The saved API key is never put back into the form. An empty key field means "keep
// the key I already saved", so the other settings can be changed without retyping it.
// (It also keeps the secret out of the page, where browser password managers can
// autofill or overwrite it.)

const KEY_PLACEHOLDER = 'Enter your Godspeed API key';
const SAVED_KEY_PLACEHOLDER = 'Saved. Leave blank to keep it, or enter a new key';

document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('settings-form').addEventListener('submit', saveSettings);
document.getElementById('clearKey').addEventListener('click', clearApiKey);

function showKeySaved(saved) {
  document.getElementById('apiKey').placeholder = saved ? SAVED_KEY_PLACEHOLDER : KEY_PLACEHOLDER;
  document.getElementById('clearKey').hidden = !saved;
}

async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get(['apiKey', 'listId', 'quickAddTarget']);

    showKeySaved(!!settings.apiKey);

    if (settings.listId) {
      document.getElementById('listId').value = settings.listId;
    }

    document.getElementById('quickAddTarget').value =
      settings.quickAddTarget === 'notes' ? 'notes' : 'title';
  } catch (error) {
    showStatus('Error loading settings: ' + error.message, 'error');
  }
}

async function saveSettings(e) {
  e.preventDefault();

  const newApiKey = document.getElementById('apiKey').value.trim();
  const listId = document.getElementById('listId').value.trim();
  const quickAddTarget = document.getElementById('quickAddTarget').value === 'notes' ? 'notes' : 'title';

  try {
    const { apiKey: savedApiKey } = await chrome.storage.sync.get('apiKey');

    if (!newApiKey && !savedApiKey) {
      showStatus('Please enter an API key', 'error');
      return;
    }

    const changes = { listId, quickAddTarget };
    if (newApiKey) {
      changes.apiKey = newApiKey;
    }
    await chrome.storage.sync.set(changes);

    document.getElementById('apiKey').value = '';
    showKeySaved(true);
    showStatus('Settings saved successfully!', 'success');
  } catch (error) {
    showStatus('Error saving settings: ' + error.message, 'error');
  }
}

async function clearApiKey() {
  try {
    await chrome.storage.sync.remove('apiKey');
    document.getElementById('apiKey').value = '';
    showKeySaved(false);
    showStatus('API key removed', 'success');
  } catch (error) {
    showStatus('Error removing API key: ' + error.message, 'error');
  }
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status ' + type;
  status.style.display = 'block';
  
  setTimeout(() => {
    status.style.display = 'none';
  }, 3000);
}
