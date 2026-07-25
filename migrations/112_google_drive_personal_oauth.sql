-- Phase 1: personal Google Drive OAuth connections.
CREATE TABLE IF NOT EXISTS public.google_drive_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  provider_account_id TEXT,
  provider_account_email TEXT,
  encrypted_refresh_token TEXT NOT NULL,
  encrypted_access_token TEXT,
  granted_scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'expired', 'revoked', 'error', 'disconnected')),
  token_expires_at TIMESTAMPTZ,
  last_error TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_google_drive_connections_status ON public.google_drive_connections(user_id, status);
ALTER TABLE public.google_drive_connections ALTER COLUMN encrypted_refresh_token DROP NOT NULL;
ALTER TABLE public.google_drive_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own Google Drive connection" ON public.google_drive_connections;
CREATE POLICY "Users can read own Google Drive connection" ON public.google_drive_connections FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can manage own Google Drive connection" ON public.google_drive_connections;
CREATE POLICY "Users can manage own Google Drive connection" ON public.google_drive_connections FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
