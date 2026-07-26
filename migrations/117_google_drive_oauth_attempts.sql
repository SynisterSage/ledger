-- Phase 1 follow-up: short-lived, single-use OAuth state records.
-- Refresh tokens and authorization codes are never stored here.
CREATE TABLE IF NOT EXISTS public.google_drive_oauth_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_drive_oauth_attempts_user
  ON public.google_drive_oauth_attempts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_google_drive_oauth_attempts_expiry
  ON public.google_drive_oauth_attempts(expires_at);

ALTER TABLE public.google_drive_oauth_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own Google Drive OAuth attempts"
  ON public.google_drive_oauth_attempts;
CREATE POLICY "Users can read own Google Drive OAuth attempts"
  ON public.google_drive_oauth_attempts FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage own Google Drive OAuth attempts"
  ON public.google_drive_oauth_attempts;
CREATE POLICY "Users can manage own Google Drive OAuth attempts"
  ON public.google_drive_oauth_attempts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
