CREATE TABLE IF NOT EXISTS note_smart_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_text TEXT NOT NULL,
  source_start_offset INTEGER,
  source_end_offset INTEGER,
  linked_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  linked_reminder_id UUID REFERENCES reminders(id) ON DELETE SET NULL,
  dismissed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, note_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_note_smart_links_workspace_note
  ON note_smart_links(workspace_id, note_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_note_smart_links_event_id
  ON note_smart_links(linked_event_id);

CREATE INDEX IF NOT EXISTS idx_note_smart_links_reminder_id
  ON note_smart_links(linked_reminder_id);

ALTER TABLE note_smart_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read workspace note smart links" ON note_smart_links;
CREATE POLICY "Users can read workspace note smart links"
  ON note_smart_links
  FOR SELECT
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can manage workspace note smart links" ON note_smart_links;
CREATE POLICY "Users can manage workspace note smart links"
  ON note_smart_links
  FOR ALL
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );
