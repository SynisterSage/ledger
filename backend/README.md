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
- `SLACK_CLIENT_ID` - Slack app client id
- `SLACK_CLIENT_SECRET` - Slack app client secret
- `SLACK_SIGNING_SECRET` - Slack request signing secret
- `SLACK_REDIRECT_URI` - Slack OAuth callback URL
- `SLACK_APP_ID` - Slack app id
- `SLACK_SETTINGS_REDIRECT_URL` - Optional post-install redirect back to Ledger settings

Create the backend env file from `backend/.env.example`. Slack secrets stay on the server and are not exposed to the renderer.

For production Slack setup, point callbacks at `https://api.ledgerworkspace.com/api/integrations/slack/...`.

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

## Tier Limits (Freemium)

**Free:**

- 3 projects
- 50 tasks
- 100 events
- 100 notes

**Pro:** Unlimited
