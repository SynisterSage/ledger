-- Migration: 119_meeting_calendar_integration
-- Description: Preserve internal and external calendar identity alongside Meeting Notes.

ALTER TABLE public.meeting_note_metadata
  ADD COLUMN IF NOT EXISTS calendar_provider TEXT,
  ADD COLUMN IF NOT EXISTS calendar_event_key TEXT,
  ADD COLUMN IF NOT EXISTS calendar_series_key TEXT,
  ADD COLUMN IF NOT EXISTS calendar_source_name TEXT,
  ADD COLUMN IF NOT EXISTS calendar_event_title TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS calendar_event_deleted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.meeting_note_metadata
  DROP CONSTRAINT IF EXISTS meeting_note_metadata_calendar_provider_check;

ALTER TABLE public.meeting_note_metadata
  ADD CONSTRAINT meeting_note_metadata_calendar_provider_check
  CHECK (calendar_provider IS NULL OR calendar_provider IN ('ledger', 'google', 'apple'));

CREATE INDEX IF NOT EXISTS idx_meeting_metadata_calendar_identity
  ON public.meeting_note_metadata(workspace_id, calendar_provider, calendar_event_key)
  WHERE calendar_provider IS NOT NULL AND calendar_event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meeting_metadata_calendar_series_key
  ON public.meeting_note_metadata(workspace_id, calendar_provider, calendar_series_key)
  WHERE calendar_provider IS NOT NULL AND calendar_series_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_metadata_external_calendar_event
  ON public.meeting_note_metadata(workspace_id, calendar_provider, calendar_event_key)
  WHERE calendar_event_key IS NOT NULL;
