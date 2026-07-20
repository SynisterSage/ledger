-- Migration: 053_add_figma_integration_oauth
-- Description: Add health metadata and one-time state tracking for workspace-scoped Figma OAuth.

ALTER TABLE public.integration_accounts
  ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'connected',
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS connection_error TEXT;

CREATE TABLE IF NOT EXISTS public.integration_oauth_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_integration_oauth_attempts_lookup
  ON public.integration_oauth_attempts(provider, workspace_id, user_id, expires_at);

ALTER TABLE public.integration_oauth_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own integration oauth attempts" ON public.integration_oauth_attempts;
CREATE POLICY "Users can read own integration oauth attempts"
  ON public.integration_oauth_attempts FOR SELECT
  USING (user_id = auth.uid());
