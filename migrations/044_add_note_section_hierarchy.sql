-- Add hierarchical folders for note_sections
ALTER TABLE public.note_sections
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.note_sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_note_sections_parent_id
ON public.note_sections(parent_id);

CREATE INDEX IF NOT EXISTS idx_note_sections_workspace_parent_sort
ON public.note_sections(workspace_id, parent_id, sort_order);
