-- Migration: 038_make_created_by_nullable
-- Description: Make created_by nullable for system templates

ALTER TABLE public.note_templates
ALTER COLUMN created_by DROP NOT NULL;
