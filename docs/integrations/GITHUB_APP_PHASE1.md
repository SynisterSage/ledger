# GitHub App setup (Phase 1–3.5)

Create a GitHub App named `Ledger` with homepage `https://ledgerworkspace.com`, callback `https://api.ledgerworkspace.com/api/integrations/github/callback`, and webhook `https://api.ledgerworkspace.com/api/integrations/github/webhook`. Enable “Request user authorization during installation” and configure a webhook secret. Make the app public when installations outside the owner account are needed.

Request read-only repository permissions for Metadata, Issues, Pull requests, Checks, and Commit statuses. Subscribe to:

- Installation
- Installation repositories
- Issues
- Pull request
- Pull request review
- Check run
- Check suite
- Status
- Repository

Phase 3.5 remains read-only. The event subscriptions above are used for linked-work awareness and explicitly enabled capture rules; they do not grant Ledger permission to create or modify GitHub data. Do not request Contents, Actions, Administration, Workflows, organization permissions, or any write permission. Do not subscribe to push, commit, review-comment, or other unrelated activity.

Set the backend variables in `backend/.env` (never as `VITE_` variables):

```text
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=
GITHUB_APP_WEBHOOK_SECRET=
GITHUB_API_VERSION=2022-11-28
```

Generate and download the App private key before trying to install the app through Ledger. The complete `.pem` contents become `GITHUB_APP_PRIVATE_KEY`; escaped `\n` line breaks are supported. Installation access tokens are generated temporarily from this key and are never created manually or stored.

Apply migrations `095_github_app_phase1.sql`, `096_github_external_references_phase2.sql`, `098_note_preview_and_metadata_queries.sql`, `099_github_phase3_live_awareness.sql`, and `100_github_phase35_capture_rules.sql` before testing. Phase 3.5 capture rules are disabled until a workspace owner/admin explicitly enables them in the existing GitHub disclosure. Webhook deliveries remain signed, deduplicated through `integration_webhook_events`, and scoped to approved repositories.
