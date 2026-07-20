# Ledger Figma plugin

This package is isolated from the Electron renderer. Build it with:

```sh
npm run typecheck:figma-plugin
npm run build:figma-plugin
npm --prefix figma-plugin run manifest:check
```

Import `figma-plugin/manifest.json` into Figma using the generated `dist/code.js`
and `dist/ui.html` files. Production builds use only the approved Ledger API
domains. Local development may set `VITE_API_URL` and use a development-only
manifest with local domains; never submit that manifest to Figma.

The plugin uses Ledger’s browser approval flow, stores credentials only through
controller-side `figma.clientStorage`, and sends sanitized selection metadata.
It can create/link work, update supported properties, check a linked design for
a newer source version, and manually refresh a saved Ledger preview. Change
checks and preview refreshes are server-side; no version or preview data is
written into Figma node data.

Release checklist:

- verify `manifest.json` has only production domains
- run `npm run typecheck:figma-plugin`
- run `npm run build:figma-plugin`
- run `npm --prefix figma-plugin run manifest:check`
- confirm no development endpoint, mock authentication, or bundled secret is present
