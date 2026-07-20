-- Migration: 054_create_external_references
-- Description: Generic workspace-scoped external references and polymorphic links.

CREATE TABLE IF NOT EXISTS public.external_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_type TEXT NOT NULL DEFAULT 'unknown',
  external_id TEXT NOT NULL,
  external_identity TEXT NOT NULL,
  external_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  access_status TEXT NOT NULL DEFAULT 'unresolved',
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  last_resolved_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT external_references_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT external_references_provider_check CHECK (provider <> ''),
  CONSTRAINT external_references_status_check CHECK (access_status IN ('unresolved', 'accessible', 'inaccessible', 'connection_required', 'not_found', 'revoked', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_references_workspace_identity
  ON public.external_references(workspace_id, provider, external_identity);
CREATE INDEX IF NOT EXISTS idx_external_references_workspace_url
  ON public.external_references(workspace_id, normalized_url);

CREATE TABLE IF NOT EXISTS public.external_reference_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  external_reference_id UUID NOT NULL,
  CONSTRAINT external_reference_links_reference_workspace_fk
    FOREIGN KEY (external_reference_id, workspace_id)
    REFERENCES public.external_references(id, workspace_id)
    ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT external_reference_links_target_check CHECK (target_type <> ''),
  CONSTRAINT external_reference_links_unique UNIQUE (workspace_id, external_reference_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_external_reference_links_reference ON public.external_reference_links(external_reference_id);
CREATE INDEX IF NOT EXISTS idx_external_reference_links_target ON public.external_reference_links(workspace_id, target_type, target_id);

ALTER TABLE public.external_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_reference_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read external references" ON public.external_references;
CREATE POLICY "Workspace members can read external references" ON public.external_references FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can manage external references" ON public.external_references;
CREATE POLICY "Workspace members can manage external references" ON public.external_references FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = external_references.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = external_references.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')));
DROP POLICY IF EXISTS "Workspace members can read external reference links" ON public.external_reference_links;
CREATE POLICY "Workspace members can read external reference links" ON public.external_reference_links FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can manage external reference links" ON public.external_reference_links;
CREATE POLICY "Workspace members can manage external reference links" ON public.external_reference_links FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = external_reference_links.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = external_reference_links.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')));
