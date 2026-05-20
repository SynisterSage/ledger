-- Migration: 052_create_slack_integrations
-- Description: Store workspace-scoped integration accounts and captured external Slack sources.

CREATE TABLE IF NOT EXISTS public.integration_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_team_id TEXT,
  provider_team_name TEXT,
  provider_user_id TEXT,
  bot_user_id TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  installed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT integration_accounts_provider_check CHECK (provider <> '')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'integration_accounts_workspace_provider_team_key'
  ) THEN
    ALTER TABLE public.integration_accounts
      ADD CONSTRAINT integration_accounts_workspace_provider_team_key
      UNIQUE (workspace_id, provider, provider_team_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_accounts_workspace_provider_team
  ON public.integration_accounts(workspace_id, provider, provider_team_id)
  WHERE provider_team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integration_accounts_workspace_provider
  ON public.integration_accounts(workspace_id, provider);

CREATE TABLE IF NOT EXISTS public.external_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  integration_account_id UUID REFERENCES public.integration_accounts(id) ON DELETE SET NULL,
  external_id TEXT,
  external_url TEXT,
  source_type TEXT,
  channel_id TEXT,
  channel_name TEXT,
  author_id TEXT,
  author_name TEXT,
  captured_text TEXT,
  captured_at TIMESTAMP WITH TIME ZONE,
  raw_payload JSONB,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT external_sources_provider_check CHECK (provider <> '')
);

CREATE INDEX IF NOT EXISTS idx_external_sources_workspace_provider_created
  ON public.external_sources(workspace_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_sources_integration_account
  ON public.external_sources(integration_account_id);

CREATE INDEX IF NOT EXISTS idx_external_sources_external_id
  ON public.external_sources(provider, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.integration_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read workspace integration accounts" ON public.integration_accounts;
CREATE POLICY "Users can read workspace integration accounts"
  ON public.integration_accounts
  FOR SELECT
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Admins can manage workspace integration accounts" ON public.integration_accounts;
CREATE POLICY "Admins can manage workspace integration accounts"
  ON public.integration_accounts
  FOR ALL
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = integration_accounts.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = integration_accounts.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Users can read workspace external sources" ON public.external_sources;
CREATE POLICY "Users can read workspace external sources"
  ON public.external_sources
  FOR SELECT
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can manage workspace external sources" ON public.external_sources;
CREATE POLICY "Users can manage workspace external sources"
  ON public.external_sources
  FOR ALL
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = external_sources.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = external_sources.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'member')
    )
  );
