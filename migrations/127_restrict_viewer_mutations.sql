-- Restrict shared note structure and note assets to users who can edit.
-- Viewers retain read access but cannot mutate sections or storage objects.

DROP POLICY IF EXISTS "Users can create sections in their workspace" ON public.note_sections;
CREATE POLICY "Members can create sections in their workspace"
  ON public.note_sections FOR INSERT
  WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = note_sections.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('admin', 'member')
    )
  );

DROP POLICY IF EXISTS "Users can update sections in their workspace" ON public.note_sections;
CREATE POLICY "Members can update sections in their workspace"
  ON public.note_sections FOR UPDATE
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = note_sections.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('admin', 'member')
    )
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = note_sections.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('admin', 'member')
    )
  );

DROP POLICY IF EXISTS "Users can delete sections in their workspace" ON public.note_sections;
CREATE POLICY "Members can delete sections in their workspace"
  ON public.note_sections FOR DELETE
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = note_sections.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('admin', 'member')
    )
  );

DROP POLICY IF EXISTS "Note images writable by workspace members" ON storage.objects;
CREATE POLICY "Note images writable by workspace editors"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      public.is_workspace_owner(((storage.foldername(name))[2])::uuid, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id::text = (storage.foldername(name))[2]
          AND wm.user_id = auth.uid()
          AND wm.role IN ('admin', 'member')
      )
    )
  );

DROP POLICY IF EXISTS "Note images updatable by workspace members" ON storage.objects;
CREATE POLICY "Note images updatable by workspace editors"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      public.is_workspace_owner(((storage.foldername(name))[2])::uuid, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id::text = (storage.foldername(name))[2]
          AND wm.user_id = auth.uid()
          AND wm.role IN ('admin', 'member')
      )
    )
  )
  WITH CHECK (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      public.is_workspace_owner(((storage.foldername(name))[2])::uuid, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id::text = (storage.foldername(name))[2]
          AND wm.user_id = auth.uid()
          AND wm.role IN ('admin', 'member')
      )
    )
  );

DROP POLICY IF EXISTS "Note images deletable by workspace members" ON storage.objects;
CREATE POLICY "Note images deletable by workspace editors"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      public.is_workspace_owner(((storage.foldername(name))[2])::uuid, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id::text = (storage.foldername(name))[2]
          AND wm.user_id = auth.uid()
          AND wm.role IN ('admin', 'member')
      )
    )
  );

DROP POLICY IF EXISTS "Note files writable by workspace members" ON storage.objects;
CREATE POLICY "Note files writable by workspace editors"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      public.is_workspace_owner(((storage.foldername(name))[2])::uuid, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id::text = (storage.foldername(name))[2]
          AND wm.user_id = auth.uid()
          AND wm.role IN ('admin', 'member')
      )
    )
  );

DROP POLICY IF EXISTS "Note files updatable by workspace members" ON storage.objects;
CREATE POLICY "Note files updatable by workspace editors"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      public.is_workspace_owner(((storage.foldername(name))[2])::uuid, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id::text = (storage.foldername(name))[2]
          AND wm.user_id = auth.uid()
          AND wm.role IN ('admin', 'member')
      )
    )
  )
  WITH CHECK (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      public.is_workspace_owner(((storage.foldername(name))[2])::uuid, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id::text = (storage.foldername(name))[2]
          AND wm.user_id = auth.uid()
          AND wm.role IN ('admin', 'member')
      )
    )
  );

DROP POLICY IF EXISTS "Note files deletable by workspace members" ON storage.objects;
CREATE POLICY "Note files deletable by workspace editors"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      public.is_workspace_owner(((storage.foldername(name))[2])::uuid, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id::text = (storage.foldername(name))[2]
          AND wm.user_id = auth.uid()
          AND wm.role IN ('admin', 'member')
      )
    )
  );
