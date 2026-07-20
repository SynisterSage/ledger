-- Phase 8: idempotency records for Figma plugin work creation.
-- The result is a compact, safe response summary; Ledger remains canonical.
CREATE TABLE IF NOT EXISTS public.figma_plugin_action_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  result JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE (workspace_id, user_id, action, idempotency_key)
);
ALTER TABLE public.figma_plugin_action_keys ALTER COLUMN result DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_figma_plugin_action_keys_created_at
  ON public.figma_plugin_action_keys(created_at);
ALTER TABLE public.figma_plugin_action_keys ENABLE ROW LEVEL SECURITY;
