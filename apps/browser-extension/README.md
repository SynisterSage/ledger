# Ledger Browser Extension

Build the Chromium extension bundle:

```bash
npm run build:extension
```

Load `apps/browser-extension/dist` as an unpacked extension in Chrome.

The popup stores the Ledger extension token in `chrome.storage.local` and sends browser captures to:

- `POST https://api.ledgerworkspace.com/api/inbox/browser`

Available capture modes:

- `link`
- `selection`
- `manual`

Context menu actions are created from the background service worker:

- `Save page to Ledger`
- `Save selection to Ledger`
