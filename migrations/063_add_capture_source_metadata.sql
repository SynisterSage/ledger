-- Migration: 063_add_capture_source_metadata
-- Description: Add capture source metadata to shared capture objects for mobile/Siri workflows.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'workspace',
ADD COLUMN IF NOT EXISTS source_platform TEXT;

ALTER TABLE public.reminders
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'workspace',
ADD COLUMN IF NOT EXISTS source_platform TEXT;

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'workspace',
ADD COLUMN IF NOT EXISTS source_platform TEXT;

ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS source_platform TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_source ON public.tasks(source);
CREATE INDEX IF NOT EXISTS idx_reminders_source ON public.reminders(source);
CREATE INDEX IF NOT EXISTS idx_events_source ON public.events(source);
