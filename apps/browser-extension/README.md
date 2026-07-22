# Ledger Browser Extension

Build the Chromium extension bundle:

```bash
npm run build:extension
```

Load `apps/browser-extension/dist` as an unpacked extension in Chrome.

The popup stores the Ledger extension token in `chrome.storage.local` and sends browser captures to:

- `POST https://api.ledgerworkspace.com/api/inbox/browser`

## Backend CORS

The API only accepts explicitly configured extension origins. In the backend/Render
environment, set `BROWSER_EXTENSION_ORIGINS` to the exact origin shown for the
installed extension in `chrome://extensions`, for example:

```text
BROWSER_EXTENSION_ORIGINS=chrome-extension://abcdefghijklmnopabcdefghijklmnop
```

For multiple builds, provide a comma-separated list. Do not use a wildcard. An
unpacked extension can receive a different ID when its signing key changes, so
update this value and redeploy the backend when that happens.

Available capture modes:

- `link`
- `selection`
- `manual`

Context menu actions are created from the background service worker:

- `Save page to Ledger`
- `Save selection to Ledger`
