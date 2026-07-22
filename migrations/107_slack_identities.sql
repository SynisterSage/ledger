-- Migration: 107_slack_identities
-- Description: Store workspace-scoped, user-owned Slack identities separately from the shared connection.

CREATE TABLE IF NOT EXISTS public.slack_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ledger_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  integration_account_id UUID REFERENCES public.integration_accounts(id) ON DELETE SET NULL,
  slack_team_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  slack_display_name TEXT,
  slack_real_name TEXT,
  slack_email TEXT,
  slack_avatar_url TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'connected',
  linked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  last_verified_at TIMESTAMP WITH TIME ZONE,
  disconnected_at TIMESTAMP WITH TIME ZONE,
  error_code TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_identities_status_check CHECK (status IN ('connected', 'reauthorization_required', 'disconnected', 'error')),
  CONSTRAINT slack_identities_user_connection_unique UNIQUE (workspace_id, ledger_user_id, integration_account_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_identities_active_slack_user
  ON public.slack_identities(workspace_id, integration_account_id, slack_user_id)
  WHERE status <> 'disconnected';
CREATE INDEX IF NOT EXISTS idx_slack_identities_user
  ON public.slack_identities(workspace_id, ledger_user_id, updated_at DESC);

ALTER TABLE public.slack_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their Slack identity" ON public.slack_identities;
CREATE POLICY "Users can read their Slack identity"
  ON public.slack_identities FOR SELECT
  USING (ledger_user_id = auth.uid() AND (
    public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid())
  ));

DROP POLICY IF EXISTS "Users can manage their Slack identity" ON public.slack_identities;
CREATE POLICY "Users can manage their Slack identity"
  ON public.slack_identities FOR ALL
  USING (ledger_user_id = auth.uid() AND (
    public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid())
  ))
  WITH CHECK (ledger_user_id = auth.uid() AND (
    public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid())
  ));
