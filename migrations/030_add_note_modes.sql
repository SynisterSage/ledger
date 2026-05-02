-- Migration: 030_add_note_modes
-- Description: Add note mode (text or mind_map) and mind_map_structure column for hierarchical data.

ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'text' CHECK (mode IN ('text', 'mind_map'));
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS mind_map_structure JSONB;

CREATE INDEX IF NOT EXISTS idx_notes_mode ON public.notes(mode);
