ALTER TABLE public.external_reference_links
  ADD COLUMN IF NOT EXISTS link_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_external_reference_links_metadata
  ON public.external_reference_links USING GIN (link_metadata);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_reference_links_one_primary_project
  ON public.external_reference_links (workspace_id, target_id)
  WHERE target_type = 'project' AND link_metadata->>'role' = 'primary';

CREATE OR REPLACE FUNCTION public.set_primary_external_reference_link(
  p_workspace_id UUID,
  p_link_id UUID
)
RETURNS public.external_reference_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected public.external_reference_links;
BEGIN
  SELECT * INTO selected
  FROM public.external_reference_links
  WHERE id = p_link_id AND workspace_id = p_workspace_id AND target_type = 'project';
  IF selected.id IS NULL THEN RAISE EXCEPTION 'External reference project link not found'; END IF;

  UPDATE public.external_reference_links
  SET link_metadata = COALESCE(link_metadata, '{}'::jsonb) || jsonb_build_object('role', 'supporting')
  WHERE workspace_id = p_workspace_id AND target_type = 'project' AND target_id = selected.target_id AND id <> p_link_id
    AND link_metadata->>'role' = 'primary';
  UPDATE public.external_reference_links
  SET link_metadata = COALESCE(link_metadata, '{}'::jsonb) || jsonb_build_object('role', 'primary')
  WHERE id = p_link_id AND workspace_id = p_workspace_id;
  SELECT * INTO selected FROM public.external_reference_links WHERE id = p_link_id;
  RETURN selected;
END;
$$;

ALTER TABLE public.external_reference_links ENABLE ROW LEVEL SECURITY;
