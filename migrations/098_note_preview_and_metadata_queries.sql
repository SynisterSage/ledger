ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS preview TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.refresh_note_preview()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.preview := left(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(NEW.content_html, NEW.content, ''), '<[^>]*>', ' ', 'g'),
        '&nbsp;', ' ', 'gi'
      ),
      '\\s+', ' ', 'g'
    ),
    320
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notes_refresh_preview ON public.notes;
CREATE TRIGGER notes_refresh_preview
BEFORE INSERT OR UPDATE OF content, content_html ON public.notes
FOR EACH ROW EXECUTE FUNCTION public.refresh_note_preview();

UPDATE public.notes
SET preview = left(
  regexp_replace(
    regexp_replace(
      regexp_replace(coalesce(content_html, content, ''), '<[^>]*>', ' ', 'g'),
      '&nbsp;', ' ', 'gi'
    ),
    '\\s+', ' ', 'g'
  ),
  320
)
WHERE preview = '';

CREATE INDEX IF NOT EXISTS idx_notes_workspace_updated_at
  ON public.notes(workspace_id, updated_at DESC);
