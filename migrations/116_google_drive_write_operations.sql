-- Phase 5: generic provider operations and reusable external folder templates.
CREATE TABLE IF NOT EXISTS public.external_provider_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  integration_connection_id UUID REFERENCES public.google_drive_connections(id) ON DELETE SET NULL,
  connected_source_id UUID REFERENCES public.connected_external_sources(id) ON DELETE SET NULL,
  operation_type TEXT NOT NULL,
  source_entity_type TEXT,
  source_entity_id UUID,
  source_provider_resource_id TEXT,
  destination_provider_resource_id TEXT,
  request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','validating','running','waiting_for_provider','completed','partially_completed','failed','cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  error_code TEXT,
  error_message TEXT,
  requested_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, provider, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_external_provider_operations_workspace ON public.external_provider_operations(workspace_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.external_folder_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  structure JSONB NOT NULL DEFAULT '{"folders":[]}'::jsonb,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, provider, name)
);
ALTER TABLE public.external_provider_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_folder_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace members can read provider operations" ON public.external_provider_operations;
CREATE POLICY "Workspace members can read provider operations" ON public.external_provider_operations FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can read folder templates" ON public.external_folder_templates;
CREATE POLICY "Workspace members can read folder templates" ON public.external_folder_templates FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace admins can manage folder templates" ON public.external_folder_templates;
CREATE POLICY "Workspace admins can manage folder templates" ON public.external_folder_templates FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = external_folder_templates.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'admin')) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = external_folder_templates.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'admin'));
