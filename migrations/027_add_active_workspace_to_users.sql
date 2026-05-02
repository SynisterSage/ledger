-- Migration: 027_add_active_workspace_to_users
-- Description: Persist each user's active workspace selection for cross-module consistency.

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS active_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_active_workspace_id
  ON public.users(active_workspace_id);
