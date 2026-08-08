-- Secure existing note assets without changing their workspace-scoped paths.
-- Existing uploads use workspaces/<workspace_id>/..., so the policies below
-- preserve access for authorized members while removing bucket-wide access.

UPDATE storage.buckets
SET public = false
WHERE id IN ('note-images', 'note-files');

DROP POLICY IF EXISTS "Note images read for authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "Note images insert for authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "Note images update for authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "Note images delete for authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "Note files read for authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "Note files insert for authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "Note files update for authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "Note files delete for authenticated users" ON storage.objects;

DROP POLICY IF EXISTS "Note images readable by workspace members" ON storage.objects;
CREATE POLICY "Note images readable by workspace members"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id::text = (storage.foldername(name))[2] AND w.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id::text = (storage.foldername(name))[2] AND wm.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Note images writable by workspace members" ON storage.objects;
CREATE POLICY "Note images writable by workspace members"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id::text = (storage.foldername(name))[2] AND w.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id::text = (storage.foldername(name))[2] AND wm.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Note images updatable by workspace members" ON storage.objects;
CREATE POLICY "Note images updatable by workspace members"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id::text = (storage.foldername(name))[2] AND w.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id::text = (storage.foldername(name))[2] AND wm.user_id = auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id::text = (storage.foldername(name))[2] AND w.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id::text = (storage.foldername(name))[2] AND wm.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Note images deletable by workspace members" ON storage.objects;
CREATE POLICY "Note images deletable by workspace members"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id::text = (storage.foldername(name))[2] AND w.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id::text = (storage.foldername(name))[2] AND wm.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Note files readable by workspace members" ON storage.objects;
CREATE POLICY "Note files readable by workspace members"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id::text = (storage.foldername(name))[2] AND w.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id::text = (storage.foldername(name))[2] AND wm.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Note files writable by workspace members" ON storage.objects;
CREATE POLICY "Note files writable by workspace members"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id::text = (storage.foldername(name))[2] AND w.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id::text = (storage.foldername(name))[2] AND wm.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Note files updatable by workspace members" ON storage.objects;
CREATE POLICY "Note files updatable by workspace members"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id::text = (storage.foldername(name))[2] AND w.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id::text = (storage.foldername(name))[2] AND wm.user_id = auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id::text = (storage.foldername(name))[2] AND w.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id::text = (storage.foldername(name))[2] AND wm.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Note files deletable by workspace members" ON storage.objects;
CREATE POLICY "Note files deletable by workspace members"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (
      EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id::text = (storage.foldername(name))[2] AND w.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id::text = (storage.foldername(name))[2] AND wm.user_id = auth.uid())
    )
  );
