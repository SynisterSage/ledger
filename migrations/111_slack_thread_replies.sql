-- Migration: 111_slack_thread_replies
-- Description: Persist replies for Slack contexts and personal thread attention state.

ALTER TABLE public.slack_contexts
  ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS latest_reply_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.slack_contexts DROP CONSTRAINT IF EXISTS slack_contexts_sync_status_check;
ALTER TABLE public.slack_contexts
  ADD CONSTRAINT slack_contexts_sync_status_check
  CHECK (sync_status IN ('static', 'sync_ready', 'syncing', 'current', 'paused', 'access_lost', 'sync_error', 'disconnected'));

CREATE TABLE IF NOT EXISTS public.slack_thread_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slack_context_id UUID NOT NULL REFERENCES public.slack_contexts(id) ON DELETE CASCADE,
  slack_message_ts TEXT NOT NULL,
  slack_user_id TEXT,
  author_name TEXT,
  author_avatar_url TEXT,
  message_text TEXT,
  permalink TEXT,
  source_created_at TIMESTAMP WITH TIME ZONE,
  edited_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  is_edited BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_thread_replies_unique UNIQUE (slack_context_id, slack_message_ts)
);

CREATE INDEX IF NOT EXISTS idx_slack_thread_replies_context
  ON public.slack_thread_replies(workspace_id, slack_context_id, source_created_at);

CREATE TABLE IF NOT EXISTS public.slack_context_read_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slack_context_id UUID NOT NULL REFERENCES public.slack_contexts(id) ON DELETE CASCADE,
  ledger_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_viewed_reply_ts TEXT,
  last_viewed_at TIMESTAMP WITH TIME ZONE,
  unread_reply_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_context_read_states_unique UNIQUE (slack_context_id, ledger_user_id)
);

CREATE TABLE IF NOT EXISTS public.slack_context_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slack_context_id UUID NOT NULL REFERENCES public.slack_contexts(id) ON DELETE CASCADE,
  ledger_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_context_follows_unique UNIQUE (slack_context_id, ledger_user_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_context_read_states_user
  ON public.slack_context_read_states(workspace_id, ledger_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_slack_context_follows_user
  ON public.slack_context_follows(workspace_id, ledger_user_id, created_at DESC);

ALTER TABLE public.slack_thread_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_context_read_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_context_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read Slack thread replies" ON public.slack_thread_replies;
CREATE POLICY "Workspace members can read Slack thread replies"
  ON public.slack_thread_replies FOR SELECT
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Users can manage Slack context read state" ON public.slack_context_read_states;
CREATE POLICY "Users can manage Slack context read state"
  ON public.slack_context_read_states FOR ALL
  USING (ledger_user_id = auth.uid() AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid())))
  WITH CHECK (ledger_user_id = auth.uid() AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid())));

DROP POLICY IF EXISTS "Users can manage Slack context follows" ON public.slack_context_follows;
CREATE POLICY "Users can manage Slack context follows"
  ON public.slack_context_follows FOR ALL
  USING (ledger_user_id = auth.uid() AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid())))
  WITH CHECK (ledger_user_id = auth.uid() AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid())));
