-- Migration: 056_create_extension_tokens
-- Description: Store hashed browser extension tokens for Ledger Inbox capture.

CREATE TABLE IF NOT EXISTS public.extension_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Browser Extension',
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_extension_tokens_user_id
  ON public.extension_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_extension_tokens_workspace_id
  ON public.extension_tokens(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_extension_tokens_revoked_at
  ON public.extension_tokens(revoked_at);

ALTER TABLE public.extension_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own extension tokens" ON public.extension_tokens;
CREATE POLICY "Users can manage own extension tokens"
  ON public.extension_tokens
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
