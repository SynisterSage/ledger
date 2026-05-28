-- Migration: 062_add_series_metadata_to_calendar_items
-- Description: Add series metadata for specific-date event and reminder groups.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS series_id UUID,
  ADD COLUMN IF NOT EXISTS series_type TEXT;

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS series_id UUID,
  ADD COLUMN IF NOT EXISTS series_type TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;

CREATE INDEX IF NOT EXISTS idx_events_series_id ON public.events(series_id);
CREATE INDEX IF NOT EXISTS idx_events_workspace_series_id ON public.events(workspace_id, series_id);
CREATE INDEX IF NOT EXISTS idx_reminders_series_id ON public.reminders(series_id);
CREATE INDEX IF NOT EXISTS idx_reminders_workspace_series_id ON public.reminders(workspace_id, series_id);
