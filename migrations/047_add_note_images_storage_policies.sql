-- Migration: 047_add_note_images_storage_policies
-- Purpose: Enable workspace-scoped image uploads for Notes editor in Supabase Storage.

-- Ensure the bucket exists with sane defaults.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-images',
  'note-images',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled in Supabase-managed projects.
-- Avoid ALTER TABLE here because some migration runners are not the owner of storage.objects.

drop policy if exists "Note images are readable by workspace members" on storage.objects;
create policy "Note images are readable by workspace members"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = 'workspaces'
    and (
      exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id::text = (storage.foldername(name))[2]
          and wm.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.workspaces w
        where w.id::text = (storage.foldername(name))[2]
          and w.owner_id = auth.uid()
      )
    )
  );

drop policy if exists "Note images are insertable by workspace members" on storage.objects;
create policy "Note images are insertable by workspace members"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = 'workspaces'
    and (
      exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id::text = (storage.foldername(name))[2]
          and wm.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.workspaces w
        where w.id::text = (storage.foldername(name))[2]
          and w.owner_id = auth.uid()
      )
    )
  );

drop policy if exists "Note images are updatable by workspace members" on storage.objects;
create policy "Note images are updatable by workspace members"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = 'workspaces'
    and (
      exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id::text = (storage.foldername(name))[2]
          and wm.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.workspaces w
        where w.id::text = (storage.foldername(name))[2]
          and w.owner_id = auth.uid()
      )
    )
  )
  with check (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = 'workspaces'
    and (
      exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id::text = (storage.foldername(name))[2]
          and wm.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.workspaces w
        where w.id::text = (storage.foldername(name))[2]
          and w.owner_id = auth.uid()
      )
    )
  );

drop policy if exists "Note images are deletable by workspace members" on storage.objects;
create policy "Note images are deletable by workspace members"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = 'workspaces'
    and (
      exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id::text = (storage.foldername(name))[2]
          and wm.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.workspaces w
        where w.id::text = (storage.foldername(name))[2]
          and w.owner_id = auth.uid()
      )
    )
  );
