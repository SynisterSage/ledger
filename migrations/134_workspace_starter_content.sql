-- Migration: 134_workspace_starter_content
-- Description: Mark idempotent first-run starter records without mixing them
-- with ordinary user-created work.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS starter_key TEXT;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS starter_key TEXT;

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS starter_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_workspace_starter_key
  ON public.projects(workspace_id, starter_key)
  WHERE starter_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_workspace_starter_key
  ON public.tasks(workspace_id, starter_key)
  WHERE starter_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_workspace_starter_key
  ON public.notes(workspace_id, starter_key)
  WHERE starter_key IS NOT NULL;
