// Background service worker

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  await sendTabsToGodspeed([tab]);
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'send-to-godspeed') {
    // Get all highlighted/selected tabs
    const tabs = await chrome.tabs.query({ highlighted: true, currentWindow: true });
    await sendTabsToGodspeed(tabs);
  }
});

async function sendTabsToGodspeed(tabs) {
  // Get settings
  const settings = await chrome.storage.sync.get(['apiKey', 'listId']);
  
  if (!settings.apiKey) {
    // Show error - no API key configured
    showNotification(tabs[0].id, 'error', 'Please configure your API key in extension options', 5000);
    return;
  }

  const results = {
    success: [],
    failed: []
  };

  // Send each tab
  for (const tab of tabs) {
    try {
      await sendTab(tab, settings.apiKey, settings.listId);
      results.success.push(tab);
    } catch (error) {
      results.failed.push({ tab, error });
    }
  }

  // Show results
  if (results.failed.length === 0) {
    // All succeeded
    const message = tabs.length === 1 
      ? 'Sent successfully' 
      : `${tabs.length} tabs sent successfully`;
    showNotification(tabs[0].id, 'success', message, 3000);
  } else if (results.success.length === 0) {
    // All failed
    for (const { tab, error } of results.failed) {
      const message = `Failed to send "${tab.title}": ${error.message}`;
      showNotification(tab.id, 'error', message, 10000);
    }
  } else {
    // Mixed results
    const successMsg = `${results.success.length} tab(s) sent successfully`;
    showNotification(tabs[0].id, 'success', successMsg, 3000);
    
    // Show errors for failed tabs
    for (const { tab, error } of results.failed) {
      const message = `Failed to send "${tab.title}": ${error.message}`;
      showNotification(tab.id, 'error', message, 10000);
    }
  }
}

async function sendTab(tab, apiKey, listId) {
  const title = `title: ${tab.title} url: ${tab.url}`;
  
  const body = {
    title: title
  };
  
  // Only include list_id if it's not empty
  if (listId && listId.trim()) {
    body.list_id = listId.trim();
  }

  const response = await fetch('https://api.godspeedapp.com/tasks', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorJson.error || `HTTP ${response.status}`;
    } catch {
      errorMessage = `HTTP ${response.status}: ${errorText}`;
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}

function showNotification(tabId, type, message, duration) {
  chrome.tabs.sendMessage(tabId, {
    action: 'showNotification',
    type: type,
    message: message,
    duration: duration
  }).catch(() => {
    // Tab might not have content script loaded (e.g., chrome:// pages)
    console.log('Could not show notification on this tab');
  });
}
