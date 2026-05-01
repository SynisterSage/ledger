-- Migration: 016_fix_workspace_rls_recursion
-- Description: Remove recursive workspace/workspace_members policy chain.

-- Helper functions evaluated as definer to avoid recursive RLS cross-calls.
CREATE OR REPLACE FUNCTION public.is_workspace_owner(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = _workspace_id
      AND w.owner_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = _workspace_id
      AND wm.user_id = _user_id
  );
$$;

-- Replace recursive workspaces read policy.
DROP POLICY IF EXISTS "Members can read their workspaces" ON public.workspaces;
CREATE POLICY "Members can read their workspaces"
  ON public.workspaces
  FOR SELECT
  USING (public.is_workspace_member(id, auth.uid()));

-- Replace recursive workspace_members policies.
DROP POLICY IF EXISTS "Users can read workspace members" ON public.workspace_members;
DROP POLICY IF EXISTS "Admins can manage members" ON public.workspace_members;

CREATE POLICY "Users can read workspace members"
  ON public.workspace_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );

CREATE POLICY "Owners can manage workspace members"
  ON public.workspace_members
  FOR ALL
  USING (public.is_workspace_owner(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()));
