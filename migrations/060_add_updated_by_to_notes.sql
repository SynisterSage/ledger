ALTER TABLE public.notes
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notes_workspace_updated_at
ON public.notes(workspace_id, updated_at DESC);
