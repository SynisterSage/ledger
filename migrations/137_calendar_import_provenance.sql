-- Migration: 137_calendar_import_provenance
-- Description: Preserve enough ICS provenance to safely group imported events.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS import_batch_id UUID,
  ADD COLUMN IF NOT EXISTS import_series_key TEXT;

CREATE INDEX IF NOT EXISTS idx_events_workspace_import_batch
  ON public.events(workspace_id, import_batch_id)
  WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_workspace_calendar_import_series
  ON public.events(workspace_id, calendar_id, import_series_key)
  WHERE import_series_key IS NOT NULL;
