-- Migration: 072_add_task_horizon
-- Description: Distinguish short-term today tasks from long-term tasks

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS task_horizon TEXT DEFAULT 'long_term';

UPDATE public.tasks
SET task_horizon = CASE
  WHEN COALESCE(is_today_focus, false) = true
    OR COALESCE(show_in_today, false) = true
  THEN 'today'
  ELSE COALESCE(NULLIF(task_horizon, ''), 'long_term')
END
WHERE task_horizon IS NULL OR task_horizon = '';

ALTER TABLE public.tasks
ALTER COLUMN task_horizon SET DEFAULT 'long_term';

ALTER TABLE public.tasks
ALTER COLUMN task_horizon SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_task_horizon
  ON public.tasks(task_horizon);
