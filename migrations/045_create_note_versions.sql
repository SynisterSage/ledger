CREATE TABLE IF NOT EXISTS public.note_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  versioned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT 'update',
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_html TEXT NOT NULL DEFAULT '<p></p>',
  date DATE,
  mood TEXT,
  source TEXT,
  mode TEXT NOT NULL DEFAULT 'text',
  mind_map_structure JSONB,
  parent_id UUID,
  section_id UUID REFERENCES public.note_sections(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  depth INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_note_versions_note_id_created_at
ON public.note_versions(note_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_note_versions_workspace_note
ON public.note_versions(workspace_id, note_id);
