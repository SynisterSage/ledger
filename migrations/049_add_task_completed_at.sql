-- Migration: 049_add_task_completed_at
-- Description: Add completed_at timestamp to tasks to track when a task was completed

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

-- Backfill: when status is 'completed' and completed_at is null, set completed_at = updated_at
UPDATE public.tasks
SET completed_at = updated_at
WHERE status = 'completed' AND completed_at IS NULL;
