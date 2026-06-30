-- Migration: 069_add_task_milestone_link
-- Description: Link project actions to project milestones.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES public.project_milestones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_milestone_id
  ON public.tasks(milestone_id)
  WHERE milestone_id IS NOT NULL;
