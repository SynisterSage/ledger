-- Migration: 036_add_template_id_to_notes
-- Description: Add template_id foreign key to notes table

ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.note_templates(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_notes_template_id ON public.notes(template_id);
