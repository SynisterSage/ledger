-- Migration: 074_extend_workspace_teams_settings
-- Description: Add team settings fields, archival state, and viewer membership support

DO $$
BEGIN
  ALTER TYPE workspace_team_role ADD VALUE IF NOT EXISTS 'viewer';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.workspace_teams
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_task_scope TEXT DEFAULT 'long_term' NOT NULL,
  ADD COLUMN IF NOT EXISTS default_project_visibility TEXT DEFAULT 'workspace' NOT NULL,
  ADD COLUMN IF NOT EXISTS default_assignee_behavior TEXT DEFAULT 'team' NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_teams_archived_at
  ON public.workspace_teams(archived_at);

