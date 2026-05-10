-- Migration: 033_add_notes_to_tasks
-- Description: Add per-task notes field for project task detail context.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS notes TEXT;

