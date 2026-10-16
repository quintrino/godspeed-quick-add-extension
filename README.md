# Godspeed Task Sender Extension

A cross-browser extension that sends your current browser tabs to Godspeed with a single click or keyboard shortcut.

## Features

- ✨ Send current tab or multiple selected tabs to Godspeed
- ⌨️ Keyboard shortcut: `Cmd+Shift+Y` (Mac) or `Ctrl+Shift+Y` (Windows/Linux)
- ⚡ Quick add: `Cmd+Shift+U` / `Ctrl+Shift+U` opens a box to type a note first
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
5. Choose whether Quick Add text goes in the task title (default) or the task notes
6. Click "Save Settings"

## Usage

### Send Single Tab
- Click the extension icon, OR
- Press `Cmd+Shift+Y` (Mac) or `Ctrl+Shift+Y` (Windows/Linux)

### Send Multiple Tabs
1. Select multiple tabs (Cmd/Ctrl + click on tabs)
2. Click the extension icon or use the keyboard shortcut
3. Each tab will be sent as a separate task

### Quick Add (type a note first)
1. Press `Cmd+Shift+U` (Mac) or `Ctrl+Shift+U` (Windows/Linux)
2. Start typing straight away. The box is already focused
3. Press `Enter` to save (or `Esc` to cancel)

The box closes as soon as you press Enter, and the usual success or error message
appears on the page. Enter on an empty box does nothing.

The box is the extension's own page shown in a frame, so what you type never reaches
the web page or other extensions. Vimium, Surfingkeys, Gmail's single-key shortcuts and
the like won't react to it. On pages that can't show the box (new tab, `about:` and
`chrome://` pages, the extension stores, or a site whose security policy blocks the
frame) a small window opens instead and works the same way.

Change the shortcut at `chrome://extensions/shortcuts` (Chrome) or
`about:addons` → gear icon → *Manage Extension Shortcuts* (Firefox).

### Task Format
Tasks are created with the following title format:
```
title: [Page Title] url: [Page URL]
```
With Quick Add, what you typed goes at the front:
```
[Your note] title: [Page Title] url: [Page URL]
```
If you set Quick Add text to go in the notes, the title keeps the usual format and what
you typed is saved as the task's notes instead.

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
  "list_id": "optional-list-id",
  "notes": "only with Quick Add text when set to go in the notes"
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

## Development and releasing

```bash
npm test         # run the test suite (Node 22+, no dependencies to install)
npm run build    # build dist/*-firefox-<version>.zip and dist/*-chrome-<version>.zip
```

`manifest.json` (Manifest V2) is the single source of truth and is what Firefox
receives. The Chrome package is generated from it as Manifest V3 at build time,
so the name, version and commands can never drift apart.

On every push to `main`, GitHub Actions runs the tests. If they pass, it submits
the new version to **Firefox Add-ons** and the **Chrome Web Store** for review.
A store is only submitted to when the `version` in `manifest.json` is new for
that store (tracked with `firefox-v<version>` and `chrome-v<version>` git tags),
so **bump `version` in `manifest.json` to release**. Pushes without a bump only
run the tests.

Required repository secrets:

| Secret | Used for |
| --- | --- |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | Firefox: API key and secret from https://addons.mozilla.org/developers/addon/api/key/ |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | Chrome: OAuth credentials with the `chromewebstore` scope |
| `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID` | Chrome: from the Developer Dashboard |

If a store's secrets are missing, that store is skipped with a warning.

## Privacy

This extension:
- Only sends data when you explicitly trigger it
- Stores your API key locally in browser sync storage
- Only makes requests to api.godspeedapp.com
- Does not track or collect any user data

## License

Free to use and modify as needed.
