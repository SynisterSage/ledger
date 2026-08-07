# Ledger Web deployment contract

Ledger Web is the authenticated Ledger product rendered by the shared React
renderer. The public `ledger-web` surface owns marketing, authentication entry
points, invites, and integration callbacks; it must not copy Ledger modules.

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

`src/config/runtime.ts` accepts Vite variables and an optional
`window.__LEDGER_RUNTIME__` object for deployments that inject configuration at
startup. Supabase browser persistence stores the session through Supabase's
client; Ledger does not put tokens in route URLs or custom local storage.

Use separate values for development, staging, and production. OAuth redirect
origins must be registered for each deployed origin, including
`/auth/callback` and any integration callback paths.

## Hosting requirements

The browser host must serve `index.html` for authenticated deep links such as:

```text
/app
/app/w/<workspaceId>/notes/<noteId>
/app/w/<workspaceId>/capture/task
```

Static assets should be served with immutable, hashed-cache headers. HTML
should revalidate so a new deployment can update the entry chunk. HTTPS is
required in staging and production because authentication, media permissions,
clipboard behavior, and browser notifications depend on a secure context.

## Future ledger-web handoff

The preferred public flow is:

```text
ledgerworkspace.com → public login/invite → /app → Ledger Web shell
```

This can be implemented either by serving the same build under the public
origin or by proxying `/app/*` to a separate Ledger Web deployment. The proxy
must preserve the `Host`/origin used for OAuth, forward API requests only to
the configured API origin, and apply the SPA fallback to `/app/*`. Do not add a
second router or module fork in `ledger-web`.

## Known browser limitations

Native window controls, docking, always-on-top, Mica/vibrancy, local-path
reveal, and desktop-level system-audio capture remain Electron capabilities.
The browser shell exposes explicit fallbacks for these features. The current
production build also reports a pre-existing `rrule` export warning and a
large initial chunk; these are documented follow-up performance work rather
than a change to desktop behavior.
