# Ledger browser environment contract

Status: Phase 13 contract

These are public browser configuration values. Never place service-role keys,
backend secrets, OAuth client secrets, or access/refresh tokens in Vite values
or URLs.

## Canonical origins

```text
Production public/product origin: https://ledgerworkspace.com
Canonical API origin:            https://api.ledgerworkspace.com
Canonical invite origin:         https://ledgerworkspace.com
```

`www.ledgerworkspace.com` should redirect to the apex origin and must not be a
second independent application origin.

## Browser variables

| Variable | Development | Staging | Production |
|---|---|---|---|
| `VITE_API_URL` | local/configured API | staging API | `https://api.ledgerworkspace.com` |
| `VITE_SUPABASE_URL` | development project | staging project | production project |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable/anon key | publishable/anon key | publishable/anon key |
| `VITE_SUPABASE_ANON_KEY` | legacy fallback | legacy fallback | legacy fallback |
| `VITE_LEDGER_WEB_URL` | local public origin | staging public origin | `https://ledgerworkspace.com` |
| `VITE_LEDGER_APP_URL` | `/app` | `/app` | `/app` |
| `VITE_INVITE_BASE_URL` | local public origin | staging public origin | `https://ledgerworkspace.com` |
| `VITE_LEDGER_OPEN_URL` | local browser origin | staging browser origin | `https://ledgerworkspace.com/app` |

Ledger reads these values from Vite and can also receive the same public values
through `window.__LEDGER_RUNTIME__`. `npm run build:web` uses the browser
target and writes `dist-web`; it does not include Electron main/preload code.

## Auth and deployment rules

- Ledger's Supabase browser client is the product auth owner.
- Use one Supabase storage policy on the final product origin.
- Do not copy tokens between storage keys or repositories.
- General auth callbacks return to the canonical origin.
- Provider-specific backend callbacks remain on `api.ledgerworkspace.com`.
- `returnTo` may contain only an internal `/app` path and is validated by
  `src/web/returnTo.ts`.
- Browser invite continuation uses the same-origin `ledger:browser-invite:v1`
  session-storage key and is never encoded into `returnTo`.
- The public host serves `ledger-web` for marketing routes and routes `/app`
  plus `/app/*` to the Ledger `dist-web` deployment.
- The Ledger host rewrites every `/app/*` request to its SPA `index.html`.
- Hashed assets may be immutable; HTML must revalidate.
- HTTPS is required for auth, clipboard, media permissions, and notifications.
