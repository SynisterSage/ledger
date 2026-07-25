-- Phase 3: Google Drive captures extend the generic Intake record.
ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS provider_resource_id TEXT,
  ADD COLUMN IF NOT EXISTS canonical_resource_id UUID REFERENCES public.external_references(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS connected_source_id UUID REFERENCES public.connected_external_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS integration_connection_id UUID REFERENCES public.google_drive_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capture_method TEXT,
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS access_status TEXT,
  ADD COLUMN IF NOT EXISTS last_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS placed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS placed_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_google_drive_identity
  ON public.inbox_items(workspace_id, source_provider, provider_resource_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_active_google_drive_identity
  ON public.inbox_items(workspace_id, source_provider, provider_resource_id)
  WHERE source_provider = 'google_drive'
    AND provider_resource_id IS NOT NULL
    AND status IN ('unprocessed', 'snoozed');
