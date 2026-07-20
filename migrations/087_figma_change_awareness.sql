-- Phase 11: provider-neutral external-reference change awareness and Figma automation.

ALTER TABLE public.external_reference_previews
  ADD COLUMN IF NOT EXISTS source_version TEXT;

CREATE TABLE IF NOT EXISTS public.external_reference_change_states (
  external_reference_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  change_state TEXT NOT NULL DEFAULT 'unknown',
  source_last_modified_at TIMESTAMP WITH TIME ZONE,
  source_version TEXT,
  preview_captured_at TIMESTAMP WITH TIME ZONE,
  preview_source_modified_at TIMESTAMP WITH TIME ZONE,
  preview_source_version TEXT,
  last_checked_at TIMESTAMP WITH TIME ZONE,
  error_code TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT external_reference_change_states_reference_workspace_fk
    FOREIGN KEY (external_reference_id, workspace_id)
    REFERENCES public.external_references(id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT external_reference_change_states_state_check
    CHECK (change_state IN ('unknown', 'current', 'updated', 'checking', 'unavailable', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_external_reference_change_states_workspace
  ON public.external_reference_change_states(workspace_id, change_state, last_checked_at DESC);

CREATE TABLE IF NOT EXISTS public.figma_workspace_automation_settings (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  change_detection_enabled BOOLEAN NOT NULL DEFAULT true,
  notify_linked_work BOOLEAN NOT NULL DEFAULT false,
  automatically_refresh_previews BOOLEAN NOT NULL DEFAULT false,
  create_intake_on_change BOOLEAN NOT NULL DEFAULT false,
  webhook_health TEXT NOT NULL DEFAULT 'not_configured',
  webhook_id TEXT,
  webhook_event_type TEXT,
  webhook_passcode_hash TEXT,
  last_webhook_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT figma_workspace_automation_health_check
    CHECK (webhook_health IN ('not_supported', 'not_configured', 'active', 'degraded', 'failed'))
);

CREATE TABLE IF NOT EXISTS public.integration_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  event_type TEXT NOT NULL,
  external_resource_id TEXT,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  CONSTRAINT integration_webhook_events_status_check
    CHECK (status IN ('pending', 'processed', 'ignored', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_webhook_events_provider_id
  ON public.integration_webhook_events(provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_integration_webhook_events_pending
  ON public.integration_webhook_events(provider, status, received_at);

ALTER TABLE public.external_reference_change_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace members can read external reference change states" ON public.external_reference_change_states;
CREATE POLICY "Workspace members can read external reference change states" ON public.external_reference_change_states
  FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can manage external reference change states" ON public.external_reference_change_states;
CREATE POLICY "Workspace members can manage external reference change states" ON public.external_reference_change_states
  FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = external_reference_change_states.workspace_id
      AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')
  )) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = external_reference_change_states.workspace_id
      AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')
  ));

ALTER TABLE public.figma_workspace_automation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace members can read Figma automation settings" ON public.figma_workspace_automation_settings;
CREATE POLICY "Workspace members can read Figma automation settings" ON public.figma_workspace_automation_settings
  FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace admins can manage Figma automation settings" ON public.figma_workspace_automation_settings;
CREATE POLICY "Workspace admins can manage Figma automation settings" ON public.figma_workspace_automation_settings
  FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = figma_workspace_automation_settings.workspace_id
      AND wm.user_id = auth.uid() AND wm.role = 'admin'
  )) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = figma_workspace_automation_settings.workspace_id
      AND wm.user_id = auth.uid() AND wm.role = 'admin'
  ));

ALTER TABLE public.integration_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace admins can read integration webhook events" ON public.integration_webhook_events;
CREATE POLICY "Workspace admins can read integration webhook events" ON public.integration_webhook_events
  FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = integration_webhook_events.workspace_id
      AND wm.user_id = auth.uid() AND wm.role = 'admin'
  ));
