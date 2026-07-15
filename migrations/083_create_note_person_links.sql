CREATE TABLE IF NOT EXISTS public.note_person_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  person_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_text TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, note_id, person_user_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_note_person_links_note_id
  ON public.note_person_links(workspace_id, note_id);

CREATE INDEX IF NOT EXISTS idx_note_person_links_person_id
  ON public.note_person_links(workspace_id, person_user_id);

ALTER TABLE public.note_person_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read note person links" ON public.note_person_links;
CREATE POLICY "Workspace members can read note person links"
  ON public.note_person_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members
      WHERE workspace_members.workspace_id = note_person_links.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workspace members can manage note person links" ON public.note_person_links;
CREATE POLICY "Workspace members can manage note person links"
  ON public.note_person_links
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members
      WHERE workspace_members.workspace_id = note_person_links.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspace_members
      WHERE workspace_members.workspace_id = note_person_links.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
  );
