-- Phase 3.7: provider-neutral indexes for compact external-reference search.
-- Keeps GitHub and Figma reference lookup workspace scoped without changing data shape.

CREATE INDEX IF NOT EXISTS idx_external_references_workspace_provider_type_updated
  ON public.external_references(workspace_id, provider, external_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_reference_links_workspace_reference_target
  ON public.external_reference_links(workspace_id, external_reference_id, target_type, target_id);
