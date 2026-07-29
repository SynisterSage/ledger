-- Migration: 118_meeting_notes_phase1
-- Description: Add meeting-note metadata and ordered transcript segments to the existing notes model.

-- Extend the existing note mode rather than introducing a second note type column.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.notes'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%mode%mind_map%'
  LOOP
    EXECUTE format('ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.notes
  ADD CONSTRAINT notes_mode_check
  CHECK (mode IN ('text', 'mind_map', 'meeting_note'));

-- A composite key lets the child tables enforce that note_id and workspace_id
-- always refer to the same note/workspace pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_workspace_id_id
  ON public.notes(workspace_id, id);

CREATE TABLE IF NOT EXISTS public.meeting_note_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  calendar_event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  calendar_series_id UUID,
  meeting_start_at TIMESTAMPTZ,
  meeting_end_at TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  transcription_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (transcription_status IN ('idle', 'recording', 'paused', 'processing', 'complete', 'failed')),
  microphone_enabled BOOLEAN NOT NULL DEFAULT false,
  system_audio_enabled BOOLEAN NOT NULL DEFAULT false,
  audio_retention TEXT NOT NULL DEFAULT 'delete_after_transcription'
    CHECK (audio_retention IN ('delete_after_transcription', 'retain')),
  attendees JSONB,
  transcription_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(note_id),
  CONSTRAINT meeting_note_metadata_note_workspace_fkey
    FOREIGN KEY (workspace_id, note_id)
    REFERENCES public.notes(workspace_id, id)
    ON DELETE CASCADE,
  CHECK (meeting_end_at IS NULL OR meeting_start_at IS NULL OR meeting_end_at >= meeting_start_at)
);

CREATE INDEX IF NOT EXISTS idx_meeting_note_metadata_workspace_id
  ON public.meeting_note_metadata(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meeting_note_metadata_calendar_event_id
  ON public.meeting_note_metadata(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_meeting_note_metadata_calendar_series_id
  ON public.meeting_note_metadata(calendar_series_id);

CREATE TABLE IF NOT EXISTS public.meeting_note_transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  audio_source TEXT NOT NULL
    CHECK (audio_source IN ('user_microphone', 'system_audio')),
  speaker_label TEXT,
  start_ms BIGINT NOT NULL CHECK (start_ms >= 0),
  end_ms BIGINT NOT NULL CHECK (end_ms >= start_ms),
  transcript_text TEXT NOT NULL,
  confidence NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  segment_order INTEGER NOT NULL CHECK (segment_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meeting_note_transcript_note_workspace_fkey
    FOREIGN KEY (workspace_id, note_id)
    REFERENCES public.notes(workspace_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_note_transcript_note_order
  ON public.meeting_note_transcript_segments(note_id, start_ms, segment_order, created_at);
CREATE INDEX IF NOT EXISTS idx_meeting_note_transcript_workspace_note
  ON public.meeting_note_transcript_segments(workspace_id, note_id);

ALTER TABLE public.meeting_note_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_note_transcript_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read meeting note metadata in their workspace" ON public.meeting_note_metadata;
CREATE POLICY "Users can read meeting note metadata in their workspace"
  ON public.meeting_note_metadata FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = public.meeting_note_metadata.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = public.meeting_note_metadata.workspace_id AND wm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members can create meeting note metadata" ON public.meeting_note_metadata;
CREATE POLICY "Workspace members can create meeting note metadata"
  ON public.meeting_note_metadata FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = public.meeting_note_metadata.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = public.meeting_note_metadata.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))
  );

DROP POLICY IF EXISTS "Workspace members can update meeting note metadata" ON public.meeting_note_metadata;
CREATE POLICY "Workspace members can update meeting note metadata"
  ON public.meeting_note_metadata FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = public.meeting_note_metadata.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = public.meeting_note_metadata.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))
  );

DROP POLICY IF EXISTS "Workspace members can delete meeting note metadata" ON public.meeting_note_metadata;
CREATE POLICY "Workspace members can delete meeting note metadata"
  ON public.meeting_note_metadata FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = public.meeting_note_metadata.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = public.meeting_note_metadata.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))
  );

DROP POLICY IF EXISTS "Users can read transcript segments in their workspace" ON public.meeting_note_transcript_segments;
CREATE POLICY "Users can read transcript segments in their workspace"
  ON public.meeting_note_transcript_segments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = public.meeting_note_transcript_segments.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = public.meeting_note_transcript_segments.workspace_id AND wm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members can create transcript segments" ON public.meeting_note_transcript_segments;
CREATE POLICY "Workspace members can create transcript segments"
  ON public.meeting_note_transcript_segments FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = public.meeting_note_transcript_segments.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = public.meeting_note_transcript_segments.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))
  );

DROP POLICY IF EXISTS "Workspace members can update transcript segments" ON public.meeting_note_transcript_segments;
CREATE POLICY "Workspace members can update transcript segments"
  ON public.meeting_note_transcript_segments FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = public.meeting_note_transcript_segments.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = public.meeting_note_transcript_segments.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))
  );

DROP POLICY IF EXISTS "Workspace members can delete transcript segments" ON public.meeting_note_transcript_segments;
CREATE POLICY "Workspace members can delete transcript segments"
  ON public.meeting_note_transcript_segments FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = public.meeting_note_transcript_segments.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = public.meeting_note_transcript_segments.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))
  );
