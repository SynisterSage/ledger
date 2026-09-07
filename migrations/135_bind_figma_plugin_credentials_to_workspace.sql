ALTER TABLE public.figma_plugin_credentials
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_figma_plugin_credentials_workspace
  ON public.figma_plugin_credentials(workspace_id, revoked_at, expires_at);
