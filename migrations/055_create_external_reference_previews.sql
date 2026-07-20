-- Migration: 055_create_external_reference_previews
-- Description: Provider-neutral stored preview snapshots for external references.

CREATE TABLE IF NOT EXISTS public.external_reference_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  external_reference_id UUID NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  file_size BIGINT NOT NULL DEFAULT 0,
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  source_last_modified_at TIMESTAMP WITH TIME ZONE,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT external_reference_previews_reference_workspace_fk
    FOREIGN KEY (external_reference_id, workspace_id)
    REFERENCES public.external_references(id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT external_reference_previews_status_check CHECK (status IN ('pending', 'ready', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_external_reference_previews_latest
  ON public.external_reference_previews(workspace_id, external_reference_id, status, captured_at DESC);

ALTER TABLE public.external_reference_previews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace members can read external reference previews" ON public.external_reference_previews;
CREATE POLICY "Workspace members can read external reference previews" ON public.external_reference_previews FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can manage external reference previews" ON public.external_reference_previews;
CREATE POLICY "Workspace members can manage external reference previews" ON public.external_reference_previews FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = external_reference_previews.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member'))) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = external_reference_previews.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')));
