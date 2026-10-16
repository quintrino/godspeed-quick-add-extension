// Options page script

document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('settings-form').addEventListener('submit', saveSettings);

async function loadSettings() {
  const settings = await chrome.storage.sync.get(['apiKey', 'listId', 'quickAddTarget']);
  
  if (settings.apiKey) {
    document.getElementById('apiKey').value = settings.apiKey;
  }
  
  if (settings.listId) {
    document.getElementById('listId').value = settings.listId;
  }

  document.getElementById('quickAddTarget').value =
    settings.quickAddTarget === 'notes' ? 'notes' : 'title';
}

async function saveSettings(e) {
  e.preventDefault();
  
  const apiKey = document.getElementById('apiKey').value.trim();
  const listId = document.getElementById('listId').value.trim();
  const quickAddTarget = document.getElementById('quickAddTarget').value === 'notes' ? 'notes' : 'title';
  
  if (!apiKey) {
    showStatus('Please enter an API key', 'error');
    return;
  }
  
  try {
    await chrome.storage.sync.set({
      apiKey: apiKey,
      listId: listId,
      quickAddTarget: quickAddTarget
    });
    
    showStatus('Settings saved successfully!', 'success');
  } catch (error) {
    showStatus('Error saving settings: ' + error.message, 'error');
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
