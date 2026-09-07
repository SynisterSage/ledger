-- Migration: 136_workspace_scoped_calendar_sync_tokens
-- Description: Allow one active calendar feed token per user and workspace.
-- The original index was user-only, which prevented a user with multiple
-- workspaces from opening Calendar in a second workspace.

DROP INDEX IF EXISTS public.ux_calendar_sync_tokens_one_active_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS ux_calendar_sync_tokens_one_active_per_user_workspace
  ON public.calendar_sync_tokens(user_id, workspace_id)
  WHERE is_active = true AND workspace_id IS NOT NULL;

-- Preserve the legacy single active token behavior for rows that have not yet
-- been claimed by a workspace.
CREATE UNIQUE INDEX IF NOT EXISTS ux_calendar_sync_tokens_one_active_legacy
  ON public.calendar_sync_tokens(user_id)
  WHERE is_active = true AND workspace_id IS NULL;
