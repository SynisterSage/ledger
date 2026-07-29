-- Migration: 121_meeting_transcript_links
-- Description: Preserve workspace-scoped links from transcript segments to Ledger items and meeting references.

CREATE TABLE IF NOT EXISTS public.meeting_transcript_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  meeting_note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  transcript_segment_id UUID NOT NULL REFERENCES public.meeting_note_transcript_segments(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('ledger_item', 'action_item', 'decision', 'key_point', 'meeting_note')),
  ledger_item_type TEXT CHECK (ledger_item_type IN ('task', 'reminder', 'event', 'intake')),
  ledger_item_id UUID,
  quoted_text TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL CHECK (timestamp_ms >= 0),
  speaker_label TEXT,
  audio_source TEXT NOT NULL CHECK (audio_source IN ('user_microphone', 'system_audio')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (link_type = 'ledger_item' AND ledger_item_type IS NOT NULL AND ledger_item_id IS NOT NULL)
    OR (link_type <> 'ledger_item' AND ledger_item_type IS NULL AND ledger_item_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_meeting_transcript_links_note
  ON public.meeting_transcript_links(workspace_id, meeting_note_id, created_at);
CREATE INDEX IF NOT EXISTS idx_meeting_transcript_links_segment
  ON public.meeting_transcript_links(workspace_id, transcript_segment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_meeting_transcript_links_item
  ON public.meeting_transcript_links(workspace_id, ledger_item_type, ledger_item_id);

ALTER TABLE public.meeting_transcript_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read transcript links" ON public.meeting_transcript_links;
CREATE POLICY "Workspace members can read transcript links"
  ON public.meeting_transcript_links FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members can create transcript links" ON public.meeting_transcript_links;
CREATE POLICY "Workspace members can create transcript links"
  ON public.meeting_transcript_links FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))
  );
