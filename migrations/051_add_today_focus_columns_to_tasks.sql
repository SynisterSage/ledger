-- Migration: 051_add_today_focus_columns_to_tasks
-- Description: Store Today visibility and focus flags directly on tasks.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS show_in_today BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS is_today_focus BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_show_in_today
  ON public.tasks(show_in_today)
  WHERE show_in_today = true;

CREATE INDEX IF NOT EXISTS idx_tasks_is_today_focus
  ON public.tasks(is_today_focus)
  WHERE is_today_focus = true;

UPDATE public.tasks
SET show_in_today = COALESCE(show_in_today, false),
    is_today_focus = COALESCE(is_today_focus, false);
