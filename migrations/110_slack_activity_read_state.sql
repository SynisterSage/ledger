-- Migration: 110_slack_activity_read_state
-- Description: Store per-user read boundaries for Slack activity and watched conversations.

CREATE TABLE IF NOT EXISTS public.slack_activity_read_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slack_activity_id UUID NOT NULL REFERENCES public.slack_activities(id) ON DELETE CASCADE,
  ledger_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  read_at TIMESTAMP WITH TIME ZONE,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_activity_read_states_unique UNIQUE (slack_activity_id, ledger_user_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_activity_read_states_user
  ON public.slack_activity_read_states(workspace_id, ledger_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.slack_watch_read_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slack_watch_id UUID NOT NULL REFERENCES public.slack_watches(id) ON DELETE CASCADE,
  ledger_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_viewed_message_ts TEXT,
  last_viewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_watch_read_states_unique UNIQUE (slack_watch_id, ledger_user_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_watch_read_states_user
  ON public.slack_watch_read_states(workspace_id, ledger_user_id, updated_at DESC);

ALTER TABLE public.slack_activity_read_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_watch_read_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their Slack activity read state" ON public.slack_activity_read_states;
CREATE POLICY "Users can manage their Slack activity read state"
  ON public.slack_activity_read_states FOR ALL
  USING (
    ledger_user_id = auth.uid()
    AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()))
  )
  WITH CHECK (
    ledger_user_id = auth.uid()
    AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()))
  );

DROP POLICY IF EXISTS "Users can manage their Slack watch read state" ON public.slack_watch_read_states;
CREATE POLICY "Users can manage their Slack watch read state"
  ON public.slack_watch_read_states FOR ALL
  USING (
    ledger_user_id = auth.uid()
    AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()))
  )
  WITH CHECK (
    ledger_user_id = auth.uid()
    AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()))
  );

