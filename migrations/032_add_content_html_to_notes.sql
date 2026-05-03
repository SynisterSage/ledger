-- Migration: 032_add_content_html_to_notes
-- Add HTML content column for rich text notes and backfill from plain-text content

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS content_html TEXT;

-- Backfill: convert existing plain-text content to minimal HTML paragraphs
UPDATE public.notes
SET content_html = '<p>' || REPLACE(content, E'\n', '</p><p>') || '</p>'
WHERE content_html IS NULL AND content IS NOT NULL;

-- Note: keep `content` for search indexing and rollback safety.
