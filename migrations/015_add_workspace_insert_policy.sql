-- Migration: 015_add_workspace_insert_policy
-- Description: Allow authenticated users to create their own workspaces.

CREATE POLICY "Users can create own workspaces"
  ON public.workspaces
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());
