ALTER TABLE public.meeting_note_metadata
  ADD COLUMN IF NOT EXISTS meeting_template TEXT,
  ADD COLUMN IF NOT EXISTS meeting_template_instructions TEXT;

ALTER TABLE public.meeting_note_metadata
  DROP CONSTRAINT IF EXISTS meeting_note_metadata_template_check;

ALTER TABLE public.meeting_note_metadata
  ADD CONSTRAINT meeting_note_metadata_template_check
  CHECK (meeting_template IS NULL OR meeting_template IN ('auto', 'one_on_one', 'team_sync', 'project_review', 'customer_sales', 'interview', 'custom'));
