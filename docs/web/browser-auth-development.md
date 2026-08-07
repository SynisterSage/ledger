# Browser authentication development contract

Production browser authentication is same-origin: `ledgerworkspace.com` hosts the public `ledger-web` pages and the Ledger browser product under `/app/*`. Both use the same Supabase project and the Supabase browser storage key `ledger-auth`.

Separate localhost ports do not share `localStorage`, even when they use the same Supabase project. Do not copy access or refresh tokens between the public site and Ledger Web, and do not put them in query strings or hashes.

For local testing, use one same-origin host configuration that serves the public login and proxies `/app/*` to the Ledger Vite server, or test the Ledger browser build directly at the same origin as the login surface. If that proxy is not available, validate authentication independently in each app and treat cross-port session sharing as unsupported.

The public login may send only a validated internal `returnTo` beginning with `/app`. Invalid, external, protocol-relative, backslash-containing, or credential-bearing values resolve to `/app`.

Browser invites use the scoped `ledger:browser-invite:v1` session-storage continuation. The public invite page stores the token locally for the current tab and navigates to `/app`; Ledger validates and accepts it after authentication, then activates the returned workspace. The token is never placed in `returnTo`.

The MCP and Figma authorization pages intentionally retain their separate `ledger-web-auth-session` flow. That key is not product authentication and must not be used by `/login` or `/app`.
