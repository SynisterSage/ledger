-- Phase 4: one Drive change watch and cursor per personal connection.
CREATE TABLE IF NOT EXISTS public.google_drive_change_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_connection_id UUID NOT NULL UNIQUE REFERENCES public.google_drive_connections(id) ON DELETE CASCADE,
  current_page_token TEXT NOT NULL,
  last_successful_drain_at TIMESTAMPTZ,
  last_reconciliation_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  processing_worker_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.google_drive_watch_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_connection_id UUID NOT NULL REFERENCES public.google_drive_connections(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL UNIQUE,
  resource_id TEXT NOT NULL,
  resource_uri TEXT,
  channel_token_hash TEXT NOT NULL,
  expiration_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','active','renewing','expired','stopped','error')),
  last_message_number BIGINT,
  last_notification_at TIMESTAMPTZ,
  last_renewed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_google_drive_watch_channels_active ON public.google_drive_watch_channels(integration_connection_id, status, expiration_at);
CREATE TABLE IF NOT EXISTS public.google_drive_change_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_connection_id UUID REFERENCES public.google_drive_connections(id) ON DELETE CASCADE,
  channel_id TEXT,
  resource_id TEXT,
  message_number BIGINT,
  state TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','processed','failed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  UNIQUE(channel_id, message_number)
);
CREATE INDEX IF NOT EXISTS idx_google_drive_change_deliveries_queue ON public.google_drive_change_deliveries(status, received_at);

CREATE TABLE IF NOT EXISTS public.external_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  integration_connection_id UUID REFERENCES public.google_drive_connections(id) ON DELETE SET NULL,
  connected_source_id UUID REFERENCES public.connected_external_sources(id) ON DELETE SET NULL,
  provider_resource_id TEXT,
  canonical_resource_id UUID REFERENCES public.external_references(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  provider_event_key TEXT NOT NULL,
  metadata_before JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_after JSONB NOT NULL DEFAULT '{}'::jsonb,
  relevance_reason TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, integration_connection_id, provider_event_key)
);
CREATE INDEX IF NOT EXISTS idx_external_change_events_workspace ON public.external_change_events(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.integration_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  connected_source_id UUID REFERENCES public.connected_external_sources(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  last_triggered_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integration_rules_source ON public.integration_rules(connected_source_id, enabled);
CREATE TABLE IF NOT EXISTS public.integration_rule_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.integration_rules(id) ON DELETE CASCADE,
  external_change_event_id UUID REFERENCES public.external_change_events(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','partially_succeeded','failed','skipped')),
  matched_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integration_rule_executions_rule ON public.integration_rule_executions(rule_id, created_at DESC);

ALTER TABLE public.google_drive_change_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_drive_watch_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_drive_change_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_rule_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace members can read Drive events" ON public.external_change_events;
CREATE POLICY "Workspace members can read Drive events" ON public.external_change_events FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can read integration rules" ON public.integration_rules;
CREATE POLICY "Workspace members can read integration rules" ON public.integration_rules FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can manage integration rules" ON public.integration_rules;
CREATE POLICY "Workspace members can manage integration rules" ON public.integration_rules FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = integration_rules.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin','member'))) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = integration_rules.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin','member')));
