-- Migration: 034_add_note_hierarchy
-- Description: Add parent/ordering metadata for nested note trees.

ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.notes(id) ON DELETE SET NULL;

ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS depth INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_notes_parent_id ON public.notes(parent_id);
CREATE INDEX IF NOT EXISTS idx_notes_parent_sort_order ON public.notes(parent_id, sort_order, updated_at DESC);
