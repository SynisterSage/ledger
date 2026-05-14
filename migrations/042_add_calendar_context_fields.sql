-- Migration: 042_add_calendar_context_fields
-- Description: Add calendar visibility plus event/reminder project and note context fields.

ALTER TABLE public.calendars
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.events
SET project_id = linked_project_id
WHERE project_id IS NULL AND linked_project_id IS NOT NULL;

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_calendar_id ON public.events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_events_project_id ON public.events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_note_id ON public.events(note_id);
CREATE INDEX IF NOT EXISTS idx_reminders_project_id ON public.reminders(project_id);
CREATE INDEX IF NOT EXISTS idx_reminders_note_id ON public.reminders(note_id);