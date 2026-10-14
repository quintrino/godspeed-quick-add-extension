// Background script - compatible with both Chrome (MV3) and Firefox (MV2)

// Detect browser API (Firefox uses 'browser', Chrome uses 'chrome')
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Handle extension icon click - works for both browser_action (MV2) and action (MV3)
if (browserAPI.browserAction) {
  // Manifest V2 (Firefox)
  browserAPI.browserAction.onClicked.addListener(async (tab) => {
    console.log('Extension icon clicked! (MV2)', tab);
    await sendTabsToGodspeed([tab]);
  });
} else if (browserAPI.action) {
  // Manifest V3 (Chrome)
  browserAPI.action.onClicked.addListener(async (tab) => {
    console.log('Extension icon clicked! (MV3)', tab);
    await sendTabsToGodspeed([tab]);
  });
}

// Handle keyboard shortcut
browserAPI.commands.onCommand.addListener(async (command) => {
  console.log('Command received:', command);
  if (command === 'send-to-godspeed') {
    // Get all highlighted/selected tabs
    const tabs = await browserAPI.tabs.query({ highlighted: true, currentWindow: true });
    console.log('Selected tabs:', tabs);
    await sendTabsToGodspeed(tabs);
  }
});

async function sendTabsToGodspeed(tabs) {
  console.log('sendTabsToGodspeed called with:', tabs);

  // Get settings
  let settings;
  try {
    settings = await browserAPI.storage.sync.get(['apiKey', 'listId']);
    console.log('Settings loaded:', { hasApiKey: !!settings.apiKey, listId: settings.listId });
  } catch (error) {
    console.error('Error loading settings from storage:', error);
    showNotification(tabs[0].id, 'error', 'Error loading settings: ' + error.message, 5000);
    return;
  }

  if (!settings.apiKey) {
    // Show error - no API key configured
    console.log('No API key configured');
    showNotification(tabs[0].id, 'error', 'Please configure your API key in extension options', 5000);
    return;
  }

  const results = {
    success: [],
    failed: []
  };

  // Send each tab
  for (const tab of tabs) {
    console.log('Sending tab:', tab.title);
    try {
      await sendTab(tab, settings.apiKey, settings.listId);
      console.log('Tab sent successfully:', tab.title);
      results.success.push(tab);
    } catch (error) {
      console.error('Failed to send tab:', tab.title, error);
      results.failed.push({ tab, error });
    }
  }

  console.log('Results:', results);

  // Show results
  if (results.failed.length === 0) {
    // All succeeded
    const message = tabs.length === 1
      ? 'Sent successfully'
      : `${tabs.length} tabs sent successfully`;
    console.log('Showing success notification:', message);
    showNotification(tabs[0].id, 'success', message, 3000);
  } else if (results.success.length === 0) {
    // All failed
    console.log('All tabs failed');
    for (const { tab, error } of results.failed) {
      const message = `Failed to send "${tab.title}": ${error.message}`;
      showNotification(tab.id, 'error', message, 10000);
    }
  } else {
    // Mixed results
    console.log('Mixed results');
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
  // First verify the tab exists and is valid
  browserAPI.tabs.get(tabId).then((tab) => {
    // Only send message if tab exists and has a valid URL (not about:, chrome:, etc.)
    if (tab && tab.url && !tab.url.startsWith('about:') && !tab.url.startsWith('chrome:')) {
      return browserAPI.tabs.sendMessage(tabId, {
        action: 'showNotification',
        type: type,
        message: message,
        duration: duration
      });
    }
  }).catch((error) => {
    // Tab might not exist, be closed, or content script not loaded
    console.log('Could not show notification on this tab:', error.message);
  });
}
