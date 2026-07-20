CREATE TABLE IF NOT EXISTS public.figma_workspace_settings (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  preview_sharing_accepted BOOLEAN NOT NULL DEFAULT false,
  preview_sharing_policy_version TEXT NOT NULL DEFAULT '2026-07-20',
  preview_sharing_accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  preview_sharing_accepted_at TIMESTAMP WITH TIME ZONE,
  orphan_candidate_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.external_reference_previews
  ADD COLUMN IF NOT EXISTS orphan_candidate_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.external_references
  ADD COLUMN IF NOT EXISTS orphan_candidate_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.figma_workspace_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace members can read Figma privacy settings" ON public.figma_workspace_settings;
CREATE POLICY "Workspace members can read Figma privacy settings" ON public.figma_workspace_settings FOR SELECT USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace admins can manage Figma privacy settings" ON public.figma_workspace_settings;
CREATE POLICY "Workspace admins can manage Figma privacy settings" ON public.figma_workspace_settings FOR ALL USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = figma_workspace_settings.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'admin')) WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = figma_workspace_settings.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'admin'));
