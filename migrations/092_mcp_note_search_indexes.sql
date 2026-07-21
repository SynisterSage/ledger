-- MCP note search: accelerate workspace-scoped title and content matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_notes_workspace_date_search
  ON public.notes(workspace_id, date DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_title_trgm_search
  ON public.notes USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_notes_content_trgm_search
  ON public.notes USING GIN (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_notes_content_html_trgm_search
  ON public.notes USING GIN (content_html gin_trgm_ops);
