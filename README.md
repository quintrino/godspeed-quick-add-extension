# Godspeed Task Sender Extension

A cross-browser extension that sends your current browser tabs to Godspeed with a single click or keyboard shortcut.

## Features

- ✨ Send current tab or multiple selected tabs to Godspeed
- ⌨️ Keyboard shortcut: `Cmd+Shift+Y` (Mac) or `Ctrl+Shift+Y` (Windows/Linux)
- 🎯 Success/error notifications appear on the webpage
- ⚙️ Easy configuration via options page
- 🌐 Works on both Chrome and Firefox

## Installation

### Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the `godspeed-extension` folder
5. The extension is now installed!

### Firefox

**For Testing (Temporary Installation):**
1. Rename `manifest_firefox_v2.json` to `manifest.json` (backup the original first)
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Navigate to the `godspeed-extension` folder and select `manifest.json`
5. The extension is now installed! (Note: temporary installation requires reloading after browser restart)

**For Submission to Firefox Add-ons:**
1. Use `manifest_firefox_v2.json` (rename to `manifest.json`)
2. Create a zip file of all extension files
3. Submit to https://addons.mozilla.org/developers/
4. In the submission form, for "Does your extension collect user data?":
   - Select "No" (the extension only stores API keys locally and sends data to Godspeed API when user explicitly triggers it)
5. Fill in other required fields and submit for review

**To switch back to Chrome**: Use the original `manifest.json`

## Configuration

1. Right-click the extension icon in your browser toolbar
2. Select "Options" (Chrome) or "Manage Extension" → "Options" (Firefox)
3. Enter your Godspeed API key (required)
4. Optionally enter a List ID to send tasks to a specific list
5. Click "Save Settings"

## Usage

### Send Single Tab
- Click the extension icon, OR
- Press `Cmd+Shift+Y` (Mac) or `Ctrl+Shift+Y` (Windows/Linux)

### Send Multiple Tabs
1. Select multiple tabs (Cmd/Ctrl + click on tabs)
2. Click the extension icon or use the keyboard shortcut
3. Each tab will be sent as a separate task

### Task Format
Tasks are created with the following title format:
```
title: [Page Title] url: [Page URL]
```

## Notifications

- **Success**: Green notification appears for 3 seconds
- **Error**: Red notification appears for 10 seconds with error details
- **Multiple tabs**: Shows count of successful sends
- **Failures**: Individual error message for each failed tab

## API Details

The extension sends POST requests to:
```
POST https://api.godspeedapp.com/tasks
Authorization: Bearer {your-api-key}
Content-Type: application/json

{
  "title": "title: Example Page url: https://example.com",
  "list_id": "optional-list-id"
}
```

## Troubleshooting

**Extension icon is grayed out**: Make sure you're on a regular webpage (not chrome://, about:, or extension pages)

**No notification appears**: Some pages (like browser settings pages) block content scripts. The task should still be sent if configured correctly.

**API errors**: Check that your API key is correct in the options page. Error messages will appear in the notification.

## Browser Compatibility

- Chrome (Manifest V3)
- Firefox (Manifest V3)
- Other Chromium-based browsers (Edge, Brave, etc.)

## Files Structure

```
godspeed-extension/
├── manifest.json       # Extension configuration
├── background.js       # Service worker handling API calls
├── content.js          # Content script for notifications
├── content.css         # Notification styles
├── options.html        # Settings page UI
├── options.js          # Settings page logic
├── icon16.png          # 16x16 icon
├── icon48.png          # 48x48 icon
├── icon128.png         # 128x128 icon
└── README.md           # This file
```

## Privacy

This extension:
- Only sends data when you explicitly trigger it
- Stores your API key locally in browser sync storage
- Only makes requests to api.godspeedapp.com
- Does not track or collect any user data

## License

Free to use and modify as needed.
