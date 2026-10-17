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
  } else if (command === 'quick-add-to-godspeed') {
    await openQuickAdd();
  }
});

// The quick-add box sends the typed text here. A page whose CSP blocked the box's
// frame asks for the fallback window instead.
browserAPI.runtime.onMessage.addListener((message, sender) => {
  if (message && message.action === 'quickAdd') {
    handleQuickAdd(message, sender);
  } else if (message && message.action === 'openQuickAddWindow' && sender && sender.tab) {
    openQuickAddWindow(sender.tab.id);
  }
});

// Show the quick-add box on the active tab. The content script is already loaded
// there, so this is a single message. Pages that can't run content scripts
// (new tab, about:, chrome://, the extension stores) get a small window instead.
async function openQuickAdd() {
  const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    const reply = await browserAPI.tabs.sendMessage(tab.id, { action: 'openQuickAdd' });
    if (reply && reply.ok) return;
  } catch (error) {
    console.log('Quick add not available on this page, using a window:', error.message);
  }

  await openQuickAddWindow(tab.id);
}

// The box as a small window, for pages that can't show it in the page itself
async function openQuickAddWindow(tabId) {
  await browserAPI.windows.create({
    url: browserAPI.runtime.getURL(`quick.html?tabId=${tabId}`),
    type: 'popup',
    width: 560,
    height: 90,
    focused: true
  });
}

async function handleQuickAdd(message, sender) {
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (!text) return;

  // From the page overlay the sender is the tab itself; from the fallback window
  // it is the window's own tab, so the target tab id travels in the message.
  let tab = sender && sender.tab;
  if (message.tabId) {
    try {
      tab = await browserAPI.tabs.get(message.tabId);
    } catch (error) {
      console.error('Quick add target tab is gone:', error);
      return;
    }
  }
  if (!tab) return;

  await sendTabsToGodspeed([tab], text);
}

async function sendTabsToGodspeed(tabs, prefix) {
  console.log('sendTabsToGodspeed called with:', tabs);

  // Nothing highlighted (e.g. no tab in the window): nothing to send or report on
  if (!tabs || tabs.length === 0) return;

  // Get settings
  let settings;
  try {
    settings = await browserAPI.storage.sync.get(['apiKey', 'listId', 'quickAddTarget']);
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
      await sendTab(tab, settings.apiKey, settings.listId, prefix, settings.quickAddTarget);
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

async function sendTab(tab, apiKey, listId, prefix, quickAddTarget) {
  // Quick-add text, when given, goes at the front of the task title, or into the
  // task's notes when the user chose that in the options
  const toNotes = quickAddTarget === 'notes';
  const title = `${prefix && !toNotes ? prefix + ' ' : ''}title: ${tab.title} url: ${tab.url}`;

  const body = {
    title: title
  };

  if (prefix && toNotes) {
    body.notes = prefix;
  }

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

  // The task is already created at this point; an empty or non-JSON body is not a failure
  return response.json().catch(() => null);
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
