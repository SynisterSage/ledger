-- Migration: 024_add_note_source
-- Description: Separate quick capture notes from workspace notes

ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'workspace';

CREATE INDEX IF NOT EXISTS idx_notes_source ON public.notes(source);
