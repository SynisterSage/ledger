# Render Setup (Ledger iCal Service)

## 1) Create Web Service
- Render Dashboard -> New -> Web Service
- Connect this repo
- Root Directory: `backend-ical`
- Build Command: `npm install`
- Start Command: `npm start`

## 2) Environment Variables
- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` = service role key (not anon key)
- `PORT` = `3000` (optional; Render provides one)

## 3) Deploy
After deploy, verify:
- `GET /health` returns `{ "ok": true, ... }`

## 4) Run DB migrations in Supabase
Run these SQL files in order:
1. `migrations/013_create_daily_accountability.sql`
2. `migrations/014_create_calendar_system.sql`
3. `migrations/015_add_workspace_insert_policy.sql`
4. `migrations/016_fix_workspace_rls_recursion.sql`
5. `migrations/017_add_event_color.sql`
6. `migrations/018_create_calendar_sync_tokens.sql`

## 5) Create a sync token
POST to `/sync-tokens` with JSON body:
```json
{ "userId": "<supabase-user-id>" }
```

Response returns `{ "token": "..." }`.

## 6) Apple Calendar subscription URL
Use:
`https://<your-render-service>.onrender.com/ical/<token>.ics`

In Apple Calendar:
- File -> New Calendar Subscription
- Paste URL
