# Ledger Backend

Express.js API for Ledger - handles quota enforcement, validation, and Supabase integration.

## Setup

### Local Development

```bash
cd backend
npm install
cp .env.example .env.local
# Add your Supabase credentials and Slack app values to .env.local
npm run dev
```

### Environment Variables

- `VITE_SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (backend only, full permissions)
- `PORT` - Server port (default: 3000)
- `PUBLIC_BACKEND_URL` - Public HTTPS backend URL for integration callbacks during local testing or production
- `FRONTEND_URL` - Public website URL for `ledgerworkspace.com`
- `INVITE_BASE_URL` - Public invite landing base. Use `https://ledgerworkspace.com` in production.
- `SLACK_CLIENT_ID` - Slack app client id
- `SLACK_CLIENT_SECRET` - Slack app client secret
- `SLACK_SIGNING_SECRET` - Slack request signing secret
- `SLACK_REDIRECT_URI` - Slack OAuth callback URL
- `SLACK_APP_ID` - Slack app id
- `SLACK_SETTINGS_REDIRECT_URL` - Optional fallback redirect after install (Ledger deep link or HTTPS page)

Create the backend env file from `backend/.env.example`. Slack secrets stay on the server and are not exposed to the renderer.

For production Slack setup, point callbacks at `https://api.ledgerworkspace.com/api/integrations/slack/...`.
Invite links should be generated from `INVITE_BASE_URL` or `FRONTEND_URL`, not the request origin.

### Deployment to Render

1. Create a new Web Service on Render
2. Connect your GitHub repo
3. Set runtime to Node
4. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - Slack variables above if Slack integration is enabled
5. Build command: `cd backend && npm install`
6. Start command: `cd backend && npm start`

## API Endpoints

### Browser Extension

- `GET /api/extension/me` - Validate a browser extension token and return the default workspace
- `GET /api/extension/workspaces` - Return accessible workspaces for the token user
- `POST /api/inbox/browser` - Save a browser capture into Ledger Inbox

### Projects

- `GET /api/projects` - List active projects
- `POST /api/projects` - Create project (checks quota)
- `PATCH /api/projects/:id` - Update status/completeness
- `DELETE /api/projects/:id` - Delete project

### Events

- `GET /api/events/upcoming` - Get next 30 days
- `POST /api/events` - Create event (checks quota)

### Daily Accountability

- `GET /api/daily-accountability` - Get today's entry
- `POST /api/daily-accountability` - Save/update

### Notes

- `GET /api/notes` - List notes
- `POST /api/notes` - Create note (checks quota)

## Features

✅ Token-based auth (Supabase JWT)
✅ Quota enforcement by tier
✅ Input validation
✅ Error handling
✅ CORS enabled

## Browser Extension Tokens

Browser extension requests use a Ledger-issued token in the `Authorization: Bearer <token>` header.

To create a dev token before the Settings UI exists:

1. Generate a raw token and its SHA-256 hash.

```bash
node -e "const crypto=require('node:crypto'); const token=crypto.randomBytes(32).toString('base64url'); console.log('RAW_TOKEN='+token); console.log('TOKEN_HASH='+crypto.createHash('sha256').update(token).digest('hex'));"
```

2. Insert the hash into `extension_tokens` for an existing user.

```sql
insert into public.extension_tokens (user_id, workspace_id, name, token_hash)
values ('<user-uuid>', '<workspace-uuid-or-null>', 'Browser Extension', '<sha256-hash>');
```

3. Use the raw token value in the browser extension popup later.

## Tier Limits (Freemium)

**Free:**

- 3 projects
- 50 tasks
- 100 events
- 100 notes

**Pro:** Unlimited
