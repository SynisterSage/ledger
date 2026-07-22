# Ledger Slack Integration

Phase 8 supports intentional capture, personal Slack identities, watched conversations, asynchronous activity ingestion, and one-way syncing for captured or linked threads. Ledger does not act as a Slack client or bulk-import channel history.

`ledgerworkspace.com` is the marketing site. `api.ledgerworkspace.com` is the backend host for Slack OAuth and interactivity.

## MVP behavior

A user opens a Slack message action, chooses **Send to Ledger Intake**, and Ledger stores the message in the workspace Inbox. Later phases can convert that inbox item into a task, note, reminder, event, or project context.

## Local development setup

Use a personal or dedicated Slack development workspace. Do not use a company Slack workspace for development.

1. Create a personal Slack development workspace.
2. Go to [Slack API](https://api.slack.com/apps) -> **Your Apps** -> **Create New App**.
3. Choose **From a manifest**.
4. Paste `docs/integrations/slack/manifest.json`.
5. The manifest points at `https://api.ledgerworkspace.com/api/integrations/slack/...`.
6. Create the app.
7. Add the environment variables below to the backend environment.
8. Install the app to the dev workspace after the OAuth route is running.
9. Confirm **Interactivity** is enabled and points at `/api/integrations/slack/interactivity`.
10. Test the message shortcut: Slack message -> More actions -> **Send to Ledger Intake**.

Local Slack testing requires a public HTTPS URL. For example, with ngrok:

```bash
ngrok http 3000
```

For local testing, either:

1. temporarily point Slack to your ngrok URL in the manifest, or
2. keep `api.ledgerworkspace.com` as the production target and test against the deployed backend.

If using ngrok locally, set:

```bash
PUBLIC_BACKEND_URL=https://xxxx.ngrok-free.app
SLACK_REDIRECT_URI=https://xxxx.ngrok-free.app/api/integrations/slack/oauth/callback
```

## Required backend environment variables

```bash
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
SLACK_REDIRECT_URI=
SLACK_APP_ID=
```

Optional for local/public URL construction:

```bash
PUBLIC_BACKEND_URL=https://api.ledgerworkspace.com
SLACK_SETTINGS_REDIRECT_URL=ledger://settings/integrations
```

Do not hardcode Slack secrets. Slack request verification uses `SLACK_SIGNING_SECRET` and the raw request body.

## Routes

- `GET /api/integrations/slack/install` starts Slack OAuth for authenticated requests.
- `GET /api/integrations/slack/oauth/callback` exchanges the Slack OAuth code and stores the workspace-scoped integration account.
- `GET /api/integrations/slack/identity/connect-url` starts personal Slack identity OAuth for an authenticated workspace member.
- `GET /api/integrations/slack/identity` reads the current user's linked Slack identity without returning credentials.
- `DELETE /api/integrations/slack/identity` disconnects only the current user's Slack identity.
- `GET /api/integrations/slack/conversations` lists conversations available to the linked Slack identity.
- `GET /api/integrations/slack/watches` lists personal and shared watches visible to the current user.
- `POST /api/integrations/slack/watches` creates a personal or admin-managed shared watch.
- `DELETE /api/integrations/slack/watches/:id` pauses a personal watch or removes an authorized watch.
- `PATCH /api/integrations/slack/watches/:id/preferences` updates per-user watch preferences.
- `POST /api/integrations/slack/events` verifies and acknowledges Slack Events API deliveries.
- `POST /api/integrations/slack/interactivity` verifies Slack signatures and captures `save_to_ledger` message shortcut payloads into the workspace Inbox.
- `GET /api/integrations/slack/contexts/:id/thread` reads stored replies and personal thread state.
- `POST /api/integrations/slack/contexts/:id/refresh` refreshes one captured or linked thread.
- `POST /api/integrations/slack/contexts/:id/follow` and `/read` manage personal reply attention.

The desktop Settings UI uses an authenticated install URL helper so Ledger can validate the active workspace before opening Slack OAuth externally.

Thread synchronization is one-way (`Slack → Ledger`). Ledger never posts comments, task updates, or replies back to Slack.

## Out of scope

- Slack modal conversion UI
- Full Inbox redesign
- Automatic task extraction
- AI summarization
- Slack channel sync or search
- Full Slack activity page and daily recap UI
- Automatic Intake creation from activity
- Calendar/reminder creation from Slack
- Production Slack marketplace submission
