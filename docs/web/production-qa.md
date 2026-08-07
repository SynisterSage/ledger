# Ledger Web Production QA

## Status

**Blocked before production end-to-end execution.** No authenticated Vercel
deployment target or real Ledger browser preview hostname is available in this
workspace. The public `ledger-web` `/app` rewrite was therefore not changed.

## Intended environment

- Browser deployment: `dist-web` Vercel project
- Deployment hostname: `https://dist-4t6ym6gim-lex-9316s-projects.vercel.app`
- Canonical public URL: `https://ledgerworkspace.com`
- Public host owner: `ledger-web`
- Product path owner: Ledger browser build under `/app/*`

## Repository-side validation

Passed locally:

- `npm run test:web-deployment-phase16`
- `npm run build:web`
- `npx tsc -p tsconfig.json --noEmit`
- `git diff --check` in Ledger
- `npm run build` in `ledger-web`
- `git diff --check` in `ledger-web`
- `npm run dev` Electron startup smoke test

The Ledger browser artifact is emitted to `dist-web`. Static inspection found
no Electron startup dependency in the generated browser output. The build
still reports the existing `rrule` export warning and large initial chunk.

## Production flows not yet tested

The following require an anonymously reachable preview and real browser
session:

- Public login/signup/invite to `/app`
- Shared `ledger-auth` session and logout across tabs
- `/app/*` rewrite and deep-link refresh
- Workspace/resource authorization
- Quick Capture to Intake conversion
- Browser compatibility matrix
- `www` to apex redirect
- Production API/Supabase environment values

## Launch blockers

1. Remove or appropriately configure the Vercel SSO/deployment protection on
   the preview, without weakening the eventual production public domain.
2. Add the exact hostname above as the `ledger-web` `/app` and `/app/*` rewrite
   destination.
3. Run the browser and production-host QA matrix above.

The preview currently returns a Vercel SSO redirect to anonymous requests.
Authenticated Vercel CLI inspection returned the Ledger SPA entry for `/app`;
this is not sufficient for public routing validation.

No DNS, public rewrite, or production behavior was changed during this audit.

## Rollback

If the public rewrite is later enabled and fails, remove the two `/app`
rewrites from the `ledger-web` Vercel project and redeploy it. Marketing,
authentication, invite, Electron, and backend paths remain independently
owned.
