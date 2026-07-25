-- Phase 2: reusable connected external sources and manual folder snapshots.
CREATE TABLE IF NOT EXISTS public.connected_external_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  source_type TEXT NOT NULL,
  provider_source_id TEXT NOT NULL,
  integration_connection_id UUID,
  connected_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  icon_url TEXT,
  external_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_mode TEXT NOT NULL DEFAULT 'manual' CHECK (sync_mode = 'manual'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'refreshing', 'connection_required', 'inaccessible', 'not_found', 'stale', 'error')),
  last_refreshed_at TIMESTAMPTZ,
  last_successful_refresh_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, provider, source_type, provider_source_id)
);
CREATE INDEX IF NOT EXISTS idx_connected_external_sources_workspace ON public.connected_external_sources(workspace_id, provider, source_type);

CREATE TABLE IF NOT EXISTS public.connected_source_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_source_id UUID NOT NULL REFERENCES public.connected_external_sources(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type = 'project'),
  entity_id UUID NOT NULL,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connected_source_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_connected_source_relationships_entity ON public.connected_source_relationships(workspace_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.connected_source_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_source_id UUID NOT NULL REFERENCES public.connected_external_sources(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_item_id TEXT NOT NULL,
  parent_provider_item_id TEXT,
  name TEXT NOT NULL,
  mime_type TEXT,
  item_type TEXT NOT NULL CHECK (item_type IN ('file', 'folder')),
  modified_time TIMESTAMPTZ,
  trashed BOOLEAN NOT NULL DEFAULT false,
  access_status TEXT NOT NULL DEFAULT 'accessible' CHECK (access_status IN ('accessible', 'inaccessible', 'not_found', 'trashed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_hash TEXT,
  last_seen_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connected_source_id, provider_item_id)
);
CREATE INDEX IF NOT EXISTS idx_connected_source_items_parent ON public.connected_source_items(connected_source_id, parent_provider_item_id, name);

ALTER TABLE public.connected_external_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_source_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_source_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace members can read connected sources" ON public.connected_external_sources;
CREATE POLICY "Workspace members can read connected sources" ON public.connected_external_sources FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can manage connected sources" ON public.connected_external_sources;
CREATE POLICY "Workspace members can manage connected sources" ON public.connected_external_sources FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = connected_external_sources.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = connected_external_sources.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')));
DROP POLICY IF EXISTS "Workspace members can read connected source relationships" ON public.connected_source_relationships;
CREATE POLICY "Workspace members can read connected source relationships" ON public.connected_source_relationships FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can manage connected source relationships" ON public.connected_source_relationships;
CREATE POLICY "Workspace members can manage connected source relationships" ON public.connected_source_relationships FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = connected_source_relationships.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = connected_source_relationships.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')));
DROP POLICY IF EXISTS "Workspace members can read connected source items" ON public.connected_source_items;
CREATE POLICY "Workspace members can read connected source items" ON public.connected_source_items FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can manage connected source items" ON public.connected_source_items;
CREATE POLICY "Workspace members can manage connected source items" ON public.connected_source_items FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = connected_source_items.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = connected_source_items.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')));
