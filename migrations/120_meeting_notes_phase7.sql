-- Migration: 120_meeting_notes_phase7
-- Description: Make transcript deletion recoverable for a short-lived undo flow.

ALTER TABLE public.meeting_note_transcript_segments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_meeting_transcript_deleted
  ON public.meeting_note_transcript_segments(workspace_id, note_id, deleted_at, updated_at);
