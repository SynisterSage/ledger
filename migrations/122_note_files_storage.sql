-- Migration: 122_note_files_storage
-- Purpose: Workspace-scoped storage for Write mode file attachment blocks.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-files',
  'note-files',
  true,
  26214400,
  null
)
on conflict (id) do nothing;

drop policy if exists "Note files read for authenticated users" on storage.objects;
create policy "Note files read for authenticated users"
  on storage.objects for select to authenticated
  using (bucket_id = 'note-files');

drop policy if exists "Note files insert for authenticated users" on storage.objects;
create policy "Note files insert for authenticated users"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'note-files');

drop policy if exists "Note files update for authenticated users" on storage.objects;
create policy "Note files update for authenticated users"
  on storage.objects for update to authenticated
  using (bucket_id = 'note-files')
  with check (bucket_id = 'note-files');

drop policy if exists "Note files delete for authenticated users" on storage.objects;
create policy "Note files delete for authenticated users"
  on storage.objects for delete to authenticated
  using (bucket_id = 'note-files');
