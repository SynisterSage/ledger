-- Migration: 048_relax_note_images_storage_insert_policy
-- Purpose: Unblock Notes image upload by using bucket-scoped authenticated policies.
-- Context: Some projects run migrations under roles that cannot reliably evaluate
-- workspace-membership checks inside storage.objects policies.

-- Keep bucket present.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-images',
  'note-images',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do nothing;

-- Remove prior strict policies from migration 047 if they exist.
drop policy if exists "Note images are readable by workspace members" on storage.objects;
drop policy if exists "Note images are insertable by workspace members" on storage.objects;
drop policy if exists "Note images are updatable by workspace members" on storage.objects;
drop policy if exists "Note images are deletable by workspace members" on storage.objects;

-- Add permissive bucket-scoped policies for authenticated users.
-- This unblocks Cmd+V / paste / drop uploads in the notes editor.
drop policy if exists "Note images read for authenticated users" on storage.objects;
create policy "Note images read for authenticated users"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'note-images');

drop policy if exists "Note images insert for authenticated users" on storage.objects;
create policy "Note images insert for authenticated users"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'note-images');

drop policy if exists "Note images update for authenticated users" on storage.objects;
create policy "Note images update for authenticated users"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'note-images')
  with check (bucket_id = 'note-images');

drop policy if exists "Note images delete for authenticated users" on storage.objects;
create policy "Note images delete for authenticated users"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'note-images');
