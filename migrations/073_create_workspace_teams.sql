-- Migration: 073_create_workspace_teams
-- Description: Persist workspace teams, membership, and team assignment on tasks and milestones

CREATE TABLE IF NOT EXISTS public.workspace_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  identifier TEXT NOT NULL,
  description TEXT,
  color VARCHAR(7) DEFAULT '#FF5F40' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(workspace_id, identifier)
);

CREATE INDEX IF NOT EXISTS idx_workspace_teams_workspace_id
  ON public.workspace_teams(workspace_id);

ALTER TABLE public.workspace_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read workspace teams"
  ON public.workspace_teams
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Workspace admins can manage teams"
  ON public.workspace_teams
  FOR ALL
  USING (
    created_by = auth.uid()
    OR workspace_id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

DO $$
BEGIN
  CREATE TYPE workspace_team_role AS ENUM ('lead', 'member');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.workspace_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.workspace_teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role workspace_team_role DEFAULT 'member' NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_team_members_workspace_id
  ON public.workspace_team_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_team_members_team_id
  ON public.workspace_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_workspace_team_members_user_id
  ON public.workspace_team_members(user_id);

ALTER TABLE public.workspace_team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read workspace team members"
  ON public.workspace_team_members
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Team leads and workspace admins can manage members"
  ON public.workspace_team_members
  FOR ALL
  USING (
    created_by = auth.uid()
    OR team_id IN (
      SELECT id FROM public.workspace_teams WHERE created_by = auth.uid()
    )
    OR workspace_id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assigned_team_id UUID REFERENCES public.workspace_teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_team_id
  ON public.tasks(assigned_team_id);

ALTER TABLE public.project_milestones
  ADD COLUMN IF NOT EXISTS assigned_team_id UUID REFERENCES public.workspace_teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_milestones_assigned_team_id
  ON public.project_milestones(assigned_team_id);
