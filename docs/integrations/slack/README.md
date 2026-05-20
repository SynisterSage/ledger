# Ledger Slack Integration

Phase 1 sets up the Slack app foundation for intentional capture. Ledger does not sync channel history, import every Slack message, or act as a Slack client.

`ledgerworkspace.com` is the marketing site. `api.ledgerworkspace.com` is the backend host for Slack OAuth and interactivity.

## MVP behavior

A user opens a Slack message action, chooses **Save to Ledger**, and Ledger stores the message as an external source record in the connected workspace. Later phases can convert that captured source into a task, note, reminder, event, or project context.

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
10. Test the message shortcut: Slack message -> More actions -> **Save to Ledger**.

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
- `POST /api/integrations/slack/interactivity` verifies Slack signatures and captures `save_to_ledger` message shortcut payloads.

The desktop Settings UI uses an authenticated install URL helper so Ledger can validate the active workspace before opening Slack OAuth externally.

## Out of scope for Phase 1

- Slack modal conversion UI
- Full Inbox redesign
- Automatic task extraction
- AI summarization
- Slack channel sync or search
- Calendar/reminder creation from Slack
- Production Slack marketplace submission
