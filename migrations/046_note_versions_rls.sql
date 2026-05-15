ALTER TABLE public.note_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view note versions in their workspace" ON public.note_versions;
CREATE POLICY "Users can view note versions in their workspace"
  ON public.note_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members
      WHERE workspace_members.workspace_id = note_versions.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create note versions in their workspace" ON public.note_versions;
CREATE POLICY "Users can create note versions in their workspace"
  ON public.note_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspace_members
      WHERE workspace_members.workspace_id = note_versions.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete note versions in their workspace" ON public.note_versions;
CREATE POLICY "Users can delete note versions in their workspace"
  ON public.note_versions FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members
      WHERE workspace_members.workspace_id = note_versions.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
  );
