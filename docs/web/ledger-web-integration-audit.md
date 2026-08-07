# Ledger Web integration and ownership audit

Status: Phase 12 audit-only document

This compares `/Users/lex/Desktop/ledger-web` with
`/Users/lex/Desktop/ledger`. No runtime or deployment behavior was changed.

## Executive summary

The intended split is sound but is not implemented yet:

```text
ledgerworkspace.com       -> ledger-web public surface
ledgerworkspace.com/app/* -> Ledger browser renderer
api.ledgerworkspace.com   -> Ledger backend API
Supabase                  -> shared auth/database provider
```

The current repositories do not provide a shared browser login session.
Ledger owns the real product authentication flow. `ledger-web`'s primary
`/login` page currently validates an email in the browser but does not call
Supabase, submit credentials, create a session, or redirect to `/app`.

`ledger-web` does contain separate, hand-written Supabase REST authentication
inside MCP/Figma authorization pages. Those pages store tokens under
`ledger-web-auth-session`, which is not Ledger's Supabase storage key. That
implementation must not become the general application auth system.

Therefore, a user who signs into the current `ledger-web` public login page
will not currently be recognized as authenticated by Ledger Web. Shared
Supabase project credentials alone do not share browser storage or sessions.

## 1. Current auth architecture

### `ledger-web`

The main entry is `src/home.tsx`. It routes `/login` to
`src/pages/LoginPage.tsx`.

The public login page:

- has login/signup presentation state;
- validates only that the email looks valid;
- does not collect or submit a password;
- does not import a Supabase client or auth provider;
- has a Google button with no auth action;
- has no logout, password-reset, session-restoration, or `/app` handoff.

The public invite surface is `src/invite.tsx` plus
`src/pages/InviteLandingPage.tsx`. It validates an invite with:

```text
GET https://api.ledgerworkspace.com/api/invitations/:token
```

The current browser-facing invite action attempts to open
`ledger://invite/:token`; it does not accept the invitation into a browser
Ledger session. The accepted state also points back to the installed app.

The MCP and Figma authorization pages are exceptions, not general auth. They
call Supabase Auth REST endpoints directly, parse OAuth tokens from the URL
hash, and use `ledger-web-auth-session` in local storage. They are external
client authorization handoffs and should remain isolated.

### `ledger`

Ledger creates its browser-compatible Supabase client in
`src/services/supabase.ts` and owns auth through `src/context/AuthContext.tsx`
and `src/hooks/useAuth.ts`.

The client currently uses:

```text
persistSession: true
autoRefreshToken: true
detectSessionInUrl: true
storageKey: ledger-auth
```

`src/services/auth.ts` provides password sign-in, sign-up, local sign-out,
password reset, session restoration, profile updates, and an OAuth helper for
Google/GitHub. `src/components/Common/LoginForm.tsx` is the shared product
login surface and supports password sign-in, sign-up, and password reset.

`src/main.tsx` selects `WebAppShell` when Electron's `window.desktopWindow` is
absent. The browser product therefore uses Ledger's `AuthProvider`, not
`ledger-web`'s public page state.

## 2. Supabase and session comparison

| Concern | `ledger-web` current state | `ledger` current state | Finding |
|---|---|---|---|
| Main Supabase client | None in the public app | `src/services/supabase.ts` uses `createClient` | Ledger owns product auth |
| Auth provider/context | None in public app | `AuthProvider` + `useAuth` | Not shared |
| Public login | Email-only validation UI | Real password auth through Supabase | Public login cannot authenticate Ledger |
| OAuth | Manual REST flow only in MCP/Figma pages | OAuth helper plus URL detection | Needs one general callback contract |
| Session persistence | None in public app | Supabase-managed browser persistence | Different behavior |
| Storage key | `ledger-web-auth-session` in special pages | `ledger-auth` | Not compatible |
| Token URL handling | OAuth hash parsed then removed in special pages | `detectSessionInUrl` enabled | Must define one callback policy |
| Logout | No general public flow | `signOut({ scope: 'local' })` | Preserve local-device semantics |

The local `ledger-web/.env.local` contains these relevant values/names:

```text
VITE_API_URL=https://api.ledgerworkspace.com
VITE_LEDGER_WEB_URL=https://ledgerworkspace.com
VITE_SUPABASE_URL=https://cocaffekowzejftiehql.supabase.co
VITE_SUPABASE_ANON_KEY=<configured locally>
VITE_SUPABASE_PUBLISHABLE_KEY=<configured locally>
```

Ledger's source expects `VITE_API_URL`, `VITE_SUPABASE_URL`, and
`VITE_SUPABASE_PUBLISHABLE_KEY` with anon-key fallback. No Ledger repository
environment file was present in this checkout to independently compare the
actual Supabase URL or key. The URL above is not proof of project equivalence
until deployment environments are compared directly.

Ledger's `render.yaml` also uses
`PUBLIC_FRONTEND_URL=https://www.ledgerworkspace.com`, while the public repo
uses the apex `https://ledgerworkspace.com`. The `www` versus apex difference
must be resolved before OAuth and origin assumptions are finalized.

### Session-sharing conclusion

Current session sharing is **not available**:

1. The public `ledger-web` login does not create a Supabase session.
2. Its special auth pages use a different storage key.
3. Browser storage is origin-scoped; shared Supabase credentials do not make
   sessions appear across unrelated storage keys or deployments.
4. Ledger's product client expects its Supabase-managed `ledger-auth` session.

Phase 13 must choose one deliberate handoff. It must not copy tokens from
`ledger-web-auth-session` into `ledger-auth` or place access/refresh tokens in
URLs.

## 3. Invite ownership and current flow

### Current public flow

```text
/invite/:token
  -> GET /api/invitations/:token
  -> show workspace/inviter/expiry information
  -> attempt ledger://invite/:token
```

`ledger-web` owns invite presentation and validation, but not browser invite
acceptance.

### Current Ledger browser flow

Ledger's `AppShell` reads `/invite/:token`, validates the invitation through
the authenticated API, waits for login if necessary, then calls
`acceptWorkspaceInvitation`. It refreshes workspaces, activates the accepted
workspace, and routes the browser to `/app/w/:workspaceId/home`.

The current token extraction also rewrites the invite path to `/?token=...`.
This is existing behavior and a Phase 13 hardening item: keep invite handling
explicit without turning a credential into a general return URL or leaving it
in an unnecessary query string.

Future ownership should be:

- `ledger-web`: public invite landing and continuation entry;
- `ledger`: authentication, acceptance, onboarding, workspace activation, and
  product rendering;
- backend: token validity, expiry, acceptance, membership, and authorization.

The invite token is a credential, not a `returnTo` value. It requires explicit
encoding, expiry, log redaction, and no access-token query parameters.

## 4. `/app`, deep links, and `returnTo`

Ledger already defines `/app`, `/app/onboarding`, `/app/workspaces`, and
`/app/w/:workspaceId/*` in `docs/web/route-contract.md` and
`src/web/webRouteState.ts`. Ledger resolves `/app` through auth, onboarding,
workspace selection, and last-used workspace logic. `ledger-web` currently has
no `/app` route or rewrite.

Eventually the public host must send `/app` and every `/app/*` deep link to the
Ledger browser build while leaving marketing pages in `ledger-web`.

The future `returnTo` contract must accept only a normalized internal path:

- pathname begins with `/app`;
- no scheme, host, protocol-relative prefix, or backslash;
- no `javascript:`, `data:`, `file:`, custom protocol, or external URL;
- invite tokens, access tokens, refresh tokens, OAuth codes, and hashes never
  appear in `returnTo`;
- malformed or oversized values fall back to `/app`.

Valid examples:

```text
/app
/app/w/<workspaceId>/notes/<noteId>?view=write
/app/w/<workspaceId>/calendar?date=2026-08-06
```

Reject `https://evil.example/`, `//evil.example/`, `javascript:...`, and
`/invite/<token>`. `/login?returnTo=...` may be used temporarily, but the
receiving app must validate and canonicalize it before navigation.

## 5. OAuth and callback comparison

Ledger's `authService.signInWithOAuth` builds redirects from
`window.location.origin` and appends `/auth/callback`. The current browser
route parser does not define a dedicated callback page; Supabase URL detection
is expected to process the return. This needs explicit production verification.

`ledger-web` has no general OAuth callback page for public login. Its MCP and
Figma pages redirect back to their current URL, parse the returned hash, and
remove it from history. Those specialized callbacks must not become the
general `/app` login mechanism without a unified session policy.

Known provider/backend callback assumptions include:

- Figma: `https://api.ledgerworkspace.com/api/integrations/figma/oauth/callback`
- GitHub documentation: `https://api.ledgerworkspace.com/api/integrations/github/callback`
- Render frontend assumption: `https://www.ledgerworkspace.com`

Phase 13 needs a callback matrix for development, staging, apex production,
and `www` production, then registration in Supabase and each provider.

## 6. Deployment ownership audit

### `ledger-web`

`ledger-web` is a Vercel static build using `@vercel/static-build`. Its
`vercel.json` maps public pages to multiple static HTML entry points and
rewrites `/login` and `/invite/(.*)` to those pages. It has no `/app` rewrite.

### `ledger`

Ledger's `render.yaml` defines the `ledger-backend` Node service; it is not a
browser static deployment. Ledger Vite can run the browser shell in
development, but the production settings still contain Electron-oriented
behavior, including relative asset handling and the Electron plugin in
production. There is no independent browser production hosting contract in
this repository.

### Target shape

The target can be supported with:

1. one host with edge/path routing, serving public paths from `ledger-web` and
   proxying `/app` plus `/app/*` to a browser-only Ledger build;
2. a same-origin reverse proxy in front of two deployments; or
3. a subdomain such as `app.ledgerworkspace.com` if same-origin path routing
   cannot be provided.

Path routing under the apex is preferred because it minimizes origin and
OAuth complexity. It requires a browser-only production build, SPA fallback
for `/app/*`, asset/base-path verification, and a deliberate cache policy.
Do not point `/app` at the current Electron-oriented build without proving
that its plugin and asset behavior are safe in a normal browser.

## 7. Ownership matrix

| Concern | `ledger-web` | `ledger` | Future owner | Change required |
|---|---|---|---|---|
| Login | Presentation-only `/login` | Real `AuthContext` and password login | Public entry in `ledger-web`; auth implementation shared with Ledger | Connect to the canonical Supabase client and restore safe `returnTo` |
| Signup | Presentation-only toggle | Real `signUp` | Public entry plus Ledger auth flow | Add real signup without duplicating auth logic |
| Logout | None generally | Local Supabase sign-out | Ledger product/session layer | Coordinate same-origin product tabs |
| Password reset | None | `resetPasswordForEmail` | Shared Ledger auth service | Define request and callback origin |
| Invite entry | Public validation and desktop protocol link | Reads invite state | `ledger-web` entry | Browser-safe continuation |
| Invite acceptance | Not accepted in browser | `acceptWorkspaceInvitation` | Ledger + backend | Route public invite into authenticated Ledger acceptance |
| Session persistence | None public; special `ledger-web-auth-session` | Supabase `ledger-auth` | Canonical Ledger client | One client/storage policy on product origin |
| Onboarding | None | `AppShell` onboarding | Ledger | Preserve requested route; keep Electron path unchanged |
| Workspace selection | None | `WorkspaceContext` | Ledger | No duplicate store in `ledger-web` |
| Deep-link restoration | No `/app` route | Web parser/startup resolution | Ledger browser shell | Host must proxy `/app/*`; validate `returnTo` |
| OAuth callbacks | Specialized MCP/Figma only | `/auth/callback` helper + URL detection | Shared auth contract; provider callbacks isolated | Register exact origins |
| `/app` | Unowned/no rewrite | Browser shell owns product routes | Ledger | Add edge rewrite/proxy |
| Environment config | Vite API/site-lock/Supabase values | Vite API/Supabase plus runtime injection | Deployment per environment | Align names, values, origin, and secret handling |
| Production deployment | Vercel public static site | Render backend; no browser host | Edge/origin owner to choose | Create browser build and routing contract |

## 8. Risks and blockers

### P0: No shared public login session

The current public login cannot authenticate. A redirect alone would create a
false-success flow.

### P0: `/app` is not deployed by `ledger-web`

Current Vercel rules do not send `/app` or `/app/*` to Ledger. Product deep
links will not work from the intended public host.

### P0: Browser production target is undefined

Ledger's Vite production configuration was designed around Electron. A
browser-only artifact and asset/base-path contract must be verified first.

### P1: Apex/`www` mismatch

The backend deployment names `www.ledgerworkspace.com`; local public config
uses `ledgerworkspace.com`. This can change OAuth callback URLs and storage
origins.

### P1: Two token/session conventions

`ledger-web-auth-session` and `ledger-auth` must remain separate until one
canonical owner is selected. Do not migrate tokens through URLs or ad hoc
local-storage copying.

### P1: Invite flows differ

The public page is desktop-protocol oriented while Ledger browser acceptance is
product-oriented. The current Ledger extraction also rewrites invite paths to
query state.

### P1: OAuth callback is implicit

`detectSessionInUrl` may process the return, but production callback hosting and
cleanup are not proven.

## 9. Exact Phase 13 implementation handoff

1. Choose the canonical product origin; prefer the apex or explicitly choose
   `www` before registering OAuth redirects.
2. Create a browser production build target in Ledger while leaving
   `npm run dev` and Electron builds unchanged. Verify no Electron startup,
   browser-safe assets, and SPA fallback for `/app/*`.
3. Define one Supabase browser client/storage policy on the final product
   origin. Do not use `ledger-web-auth-session` for product auth.
4. Connect `ledger-web` login/signup to that canonical flow, either by serving
   shared auth at the same origin or by a safe validated internal `returnTo`.
5. Add public-host rewrites/proxy rules for `/app` and `/app/*`; preserve
   marketing routes and add the Ledger SPA fallback.
6. Define browser invite continuation. Keep `/invite/:token` public, then
   authenticate and accept in Ledger without putting access/refresh tokens or
   the invite credential into `returnTo`.
7. Register callback origins for development, staging, apex, and `www` across
   Supabase and relevant providers.
8. Add handoff tests for deep links, safe/unsafe `returnTo`, login restoration,
   refresh, invite acceptance, logout, callback cleanup, and canonical host.
9. Smoke-test deployed `/app`, workspace deep links, login restoration, invite
   acceptance, refresh, Back/Forward, and session restoration before DNS or
   redirect changes.

## 10. Out of scope for this audit

- No redirects, rewrites, Supabase settings, or provider settings changed.
- No login, signup, invite, or session behavior changed.
- No repositories were merged and no Ledger modules were copied into
  `ledger-web`.
- No Electron startup, desktop navigation, or native behavior changed.

