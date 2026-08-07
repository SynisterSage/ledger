# Ledger Web deployment contract

Ledger Web is the authenticated Ledger product rendered by the shared React
renderer. The public `ledger-web` surface owns marketing, authentication entry
points, invites, and integration callbacks; it must not copy Ledger modules.

The canonical public and product origin is now:

```text
https://ledgerworkspace.com
```

`www.ledgerworkspace.com` should redirect to the apex origin. See
[`environment-contract.md`](./environment-contract.md) for the complete
development, staging, and production variable contract.

## Runtime configuration

Build or inject these values per environment. No production build should rely
on a localhost URL:

```text
VITE_API_URL=https://api.ledgerworkspace.com
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_LEDGER_WEB_URL=https://ledgerworkspace.com
VITE_INVITE_BASE_URL=https://ledgerworkspace.com
```

The dedicated browser production command is:

```bash
npm run build:web
```

It runs the shared browser renderer without the Electron plugin and writes the
static SPA artifact to `dist-web`. The existing `npm run build` remains the
Electron packaging path.

`src/config/runtime.ts` accepts Vite variables and an optional
`window.__LEDGER_RUNTIME__` object for deployments that inject configuration at
startup. Supabase browser persistence stores the session through Supabase's
client; Ledger does not put tokens in route URLs or custom local storage.

Use separate values for development, staging, and production. OAuth redirect
origins must be registered for each deployed origin, including
`/auth/callback` and any integration callback paths.

## Hosting requirements

The browser host must serve the `dist-web` SPA `index.html` for authenticated
deep links such as:

```text
/app
/app/w/<workspaceId>/notes/<noteId>
/app/w/<workspaceId>/capture/task
```

Static assets should be served with immutable, hashed-cache headers. HTML
should revalidate so a new deployment can update the entry chunk. HTTPS is
required in staging and production because authentication, media permissions,
clipboard behavior, and browser notifications depend on a secure context.

## Phase 16 deployment contract

The preferred public flow is:

```text
ledgerworkspace.com → public login/invite → /app → Ledger Web shell
```

Ledger now has an independent Vercel artifact contract in the repository
`vercel.json`:

```text
build command: npm run build:web
output:        dist-web
/app           -> /index.html
/app/*         -> /index.html
```

The `/app` rewrites are scoped to the product paths, so hashed assets are not
captured by the SPA fallback. `dist-web/index.html` is revalidated while
`dist-web/assets/*` can be cached immutably.

Deploy this project first to a preview or staging hostname and verify the
artifact there. Only after that hostname is known should the public Vercel
project add external rewrites for `/app` and `/app/*`. Vercel's rewrite target
must be the real Ledger browser deployment URL; this repository intentionally
does not contain a guessed hostname.

The public routing contract is:

```text
ledgerworkspace.com/*      -> ledger-web
ledgerworkspace.com/app    -> Ledger browser deployment /index.html
ledgerworkspace.com/app/*  -> Ledger browser deployment /index.html
```

The rewrite must preserve the browser URL and query string. Do not use a
redirect to the internal deployment hostname, and do not proxy authenticated
API responses through the static hosting layer.

The current `ledger-web` Vercel project does not have a safe destination for
that proxy. The final public-host rule is intentionally deferred until the
independent Ledger deployment has been tested through its preview/staging
hostname.

Rollback: remove the two `/app` rewrites from the public `ledger-web` Vercel
project and redeploy it. Existing marketing, auth, and invite routes remain
owned by `ledger-web`; the independent Ledger deployment can then be disabled
without changing Electron or the backend.

## Known browser limitations

Native window controls, docking, always-on-top, Mica/vibrancy, local-path
reveal, and desktop-level system-audio capture remain Electron capabilities.
The browser shell exposes explicit fallbacks for these features. The current
production build also reports a pre-existing `rrule` export warning and a
large initial chunk; these are documented follow-up performance work rather
than a change to desktop behavior.
