-- Add section_id column to notes table
ALTER TABLE public.notes ADD COLUMN section_id UUID REFERENCES public.note_sections(id) ON DELETE SET NULL;

-- Create index for efficient queries
CREATE INDEX idx_notes_section_id ON public.notes(section_id);
CREATE INDEX idx_notes_workspace_section ON public.notes(workspace_id, section_id);
