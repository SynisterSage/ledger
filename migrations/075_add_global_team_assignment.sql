-- Migration: 075_add_global_team_assignment
-- Description: Add global assignment and team-linking columns for tasks, milestones, projects, and notes

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES public.workspace_teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.tasks
SET
  assigned_to_user_id = COALESCE(assigned_to_user_id, assigned_to),
  assigned_to_team_id = COALESCE(assigned_to_team_id, assigned_team_id)
WHERE assigned_to_user_id IS NULL OR assigned_to_team_id IS NULL;

UPDATE public.tasks
SET
  assigned_to = COALESCE(assigned_to, assigned_to_user_id),
  assigned_team_id = COALESCE(assigned_team_id, assigned_to_team_id)
WHERE assigned_to IS NULL OR assigned_team_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_user_id
  ON public.tasks(assigned_to_user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_team_id
  ON public.tasks(assigned_to_team_id);

ALTER TABLE public.project_milestones
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES public.workspace_teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE;

UPDATE public.project_milestones
SET
  assigned_to_user_id = COALESCE(assigned_to_user_id, assigned_to),
  assigned_to_team_id = COALESCE(assigned_to_team_id, assigned_team_id)
WHERE assigned_to_user_id IS NULL OR assigned_to_team_id IS NULL;

UPDATE public.project_milestones
SET
  assigned_to = COALESCE(assigned_to, assigned_to_user_id),
  assigned_team_id = COALESCE(assigned_team_id, assigned_to_team_id)
WHERE assigned_to IS NULL OR assigned_team_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_milestones_assigned_to_user_id
  ON public.project_milestones(assigned_to_user_id);

CREATE INDEX IF NOT EXISTS idx_project_milestones_assigned_to_team_id
  ON public.project_milestones(assigned_to_team_id);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_team_id UUID REFERENCES public.workspace_teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_owner_team_id
  ON public.projects(owner_team_id);

CREATE TABLE IF NOT EXISTS public.note_team_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.workspace_teams(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(workspace_id, note_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_note_team_links_workspace_id
  ON public.note_team_links(workspace_id);

CREATE INDEX IF NOT EXISTS idx_note_team_links_note_id
  ON public.note_team_links(note_id);

CREATE INDEX IF NOT EXISTS idx_note_team_links_team_id
  ON public.note_team_links(team_id);
