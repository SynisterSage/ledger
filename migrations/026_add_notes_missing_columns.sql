-- Migration: 026_add_notes_missing_columns
-- Description: Add missing columns to notes table (date, mood, source)

-- Add date column if it doesn't exist
ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS date DATE DEFAULT CURRENT_DATE;

-- Add mood column if it doesn't exist
ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS mood TEXT;

-- Add source column if it doesn't exist
ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'workspace';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notes_date ON public.notes(date);
CREATE INDEX IF NOT EXISTS idx_notes_source ON public.notes(source);
