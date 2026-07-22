# GitHub release checklist

## Configuration

- [ ] Backend environment contains `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, and `GITHUB_API_VERSION`.
- [ ] The private key was generated and downloaded from GitHub before installing the App through Ledger. Store its escaped-newline PEM contents only in the backend secret manager.
- [ ] App permissions remain read-only: Metadata, Issues, Pull requests, Checks, and Commit statuses.
- [ ] No Contents, Actions, Administration, Workflows, or write permissions are enabled.
- [ ] Webhook subscriptions are Installation, Installation repositories, Issues, Pull request, Pull request review, Check run, Check suite, Status, and Repository.
- [ ] Callback and webhook URLs point at the production API.

## Deploy order

1. Back up the database and apply migrations 095, 096, 098, 099, 100, 101, and 102 in order. Migration 097 is not present in this checkout; do not invent or renumber applied migrations.
2. Deploy the backend and frontend together so the health response and compact Settings card agree.
3. Confirm Render environment secrets are present without printing them.
4. Confirm Supabase RLS remains enabled for GitHub installations, repositories, references, links, capture rules, attention, and notification tables.
5. Run the manual QA checklist in a disposable personal and team workspace.

## Smoke tests

- [ ] Connect, callback, repository sync, refresh, and Ledger disconnect work.
- [ ] Installation tokens are generated on demand and never appear in database writes, logs, or responses.
- [ ] One issue can move GitHub → Intake → task → project without duplicating its external reference.
- [ ] Notes, Quick capture, Search, Overview, Task Linked work, and Project Development show compact safe context.
- [ ] Webhook signatures, delivery idempotency, lifecycle changes, retries, and out-of-order updates behave safely.
- [ ] Notifications and attention signals are deduplicated and deep-link to the correct workspace object.
- [ ] Figma, Slack, browser extension, MCP, and non-GitHub project/note flows pass their existing smoke tests.

## Observability

- [ ] Development Supabase instrumentation reports explicit selected fields, row counts, and approximate response size without content.
- [ ] GitHub health shows last successful sync, last successful webhook processing, and a bounded recoverable error when present.
- [ ] Webhook delivery failures are safe-coded and do not expose payloads or provider secrets.
- [ ] Alerts/watchers cover elevated webhook failures, repository sync failures, rate limits, and delayed/suspended installations.

## Rollback and recovery

- [ ] Roll back the application first if needed; do not edit or reverse applied migrations destructively.
- [ ] If migration 102 must be reverted, use a reviewed forward migration after confirming no health fields are required by the deployed code.
- [ ] Disconnect/reconnect recovery preserves nothing beyond the intended Ledger association removal and never uninstalls GitHub.
- [ ] Restore repository access, refresh Ledger, and verify unavailable references recover without creating duplicates.
- [ ] If GitHub is unavailable, keep existing metadata visible and retry later; do not mark the installation disconnected.

## Read-only gate

- [ ] No GitHub write API calls are present.
- [ ] No GitHub write permissions are present.
- [ ] No GitHub comments, labels, assignments, issue edits, PR merges, or task automation are enabled.

## Commands

- [ ] `npm test` from `backend/`
- [ ] `npx tsc -p tsconfig.json --noEmit`
- [ ] `node --check backend/server.js`
- [ ] `npx vite build`
- [ ] `npx electron-builder --dir`
- [ ] `git diff --check`

DMG packaging may remain environment-blocked when `hdiutil` is unavailable; directory packaging is the release-readiness fallback.
