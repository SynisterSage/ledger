-- Ensure the account Sessions metadata table exists and is visible to PostgREST.
-- This is intentionally idempotent because the first app_sessions migration may
-- have been run before the schema cache refresh was added.

CREATE TABLE IF NOT EXISTS public.app_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT,
  platform TEXT NOT NULL DEFAULT 'desktop',
  app_name TEXT,
  app_version TEXT,
  user_agent TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id
  ON public.app_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_last_seen
  ON public.app_sessions(user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_sessions_revoked_at
  ON public.app_sessions(revoked_at);

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own app sessions" ON public.app_sessions;
CREATE POLICY "Users can read own app sessions"
  ON public.app_sessions
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own app sessions" ON public.app_sessions;
CREATE POLICY "Users can create own app sessions"
  ON public.app_sessions
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own app sessions" ON public.app_sessions;
CREATE POLICY "Users can update own app sessions"
  ON public.app_sessions
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own app sessions" ON public.app_sessions;
CREATE POLICY "Users can delete own app sessions"
  ON public.app_sessions
  FOR DELETE
  USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
