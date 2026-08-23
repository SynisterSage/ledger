-- Phase 3: keep resolved/suggested identity separate from the raw transcript label.
ALTER TABLE public.meeting_note_transcript_segments
  ADD COLUMN IF NOT EXISTS speaker_identity JSONB;

COMMENT ON COLUMN public.meeting_note_transcript_segments.speaker_identity IS
  'Phase 3 identity metadata; speaker_label and audio_source remain the raw transcript evidence.';
