CREATE TABLE IF NOT EXISTS public.github_installation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, state_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_github_installation_sessions_expiry ON public.github_installation_sessions(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS public.github_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  installation_id BIGINT NOT NULL UNIQUE, github_account_id BIGINT NOT NULL, github_account_login TEXT NOT NULL,
  github_account_type TEXT NOT NULL CHECK (github_account_type IN ('User', 'Organization')), repository_selection TEXT NOT NULL CHECK (repository_selection IN ('all', 'selected')),
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb, events JSONB NOT NULL DEFAULT '[]'::jsonb, management_url TEXT,
  installed_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL, installed_by_github_user_id BIGINT, installed_by_github_login TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted', 'error')), last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_github_installations_workspace_status ON public.github_installations(workspace_id, status);

CREATE TABLE IF NOT EXISTS public.github_repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  github_installation_id UUID NOT NULL REFERENCES public.github_installations(id) ON DELETE CASCADE, github_repository_id BIGINT NOT NULL,
  owner_login TEXT NOT NULL, name TEXT NOT NULL, full_name TEXT NOT NULL, html_url TEXT NOT NULL, is_private BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false, is_disabled BOOLEAN NOT NULL DEFAULT false, default_branch TEXT, last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(github_installation_id, github_repository_id)
);
CREATE INDEX IF NOT EXISTS idx_github_repositories_workspace ON public.github_repositories(workspace_id, full_name);

ALTER TABLE public.github_installation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_repositories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read GitHub installations" ON public.github_installations;
CREATE POLICY "Workspace members can read GitHub installations" ON public.github_installations FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND (w.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id = auth.uid())))
);
DROP POLICY IF EXISTS "Workspace members can read GitHub repositories" ON public.github_repositories;
CREATE POLICY "Workspace members can read GitHub repositories" ON public.github_repositories FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND (w.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id = auth.uid())))
);
DROP POLICY IF EXISTS "Users can manage their GitHub installation sessions" ON public.github_installation_sessions;
CREATE POLICY "Users can manage their GitHub installation sessions" ON public.github_installation_sessions FOR ALL USING (requested_by_user_id = auth.uid()) WITH CHECK (requested_by_user_id = auth.uid());
