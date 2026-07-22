-- Migration: 109_slack_activity
-- Description: Queue Slack Events API deliveries and store matched normalized activity.

ALTER TABLE public.slack_watches
  ADD COLUMN IF NOT EXISTS activity_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.slack_event_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_account_id UUID REFERENCES public.integration_accounts(id) ON DELETE SET NULL,
  slack_team_id TEXT NOT NULL,
  slack_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'received',
  retry_count INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  processed_at TIMESTAMP WITH TIME ZONE,
  next_attempt_at TIMESTAMP WITH TIME ZONE,
  error_code TEXT,
  error_message TEXT,
  processing_duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_event_deliveries_status_check CHECK (status IN ('received', 'processing', 'processed', 'failed')),
  CONSTRAINT slack_event_deliveries_unique UNIQUE (slack_team_id, slack_event_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_event_deliveries_queue
  ON public.slack_event_deliveries(status, next_attempt_at, received_at);

CREATE TABLE IF NOT EXISTS public.slack_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_account_id UUID REFERENCES public.integration_accounts(id) ON DELETE SET NULL,
  slack_team_id TEXT NOT NULL,
  slack_event_id TEXT,
  slack_conversation_id TEXT NOT NULL,
  slack_message_ts TEXT NOT NULL,
  slack_root_thread_ts TEXT,
  activity_type TEXT NOT NULL,
  conversation_type TEXT NOT NULL,
  author_slack_user_id TEXT,
  target_slack_user_id TEXT,
  message_text TEXT,
  permalink TEXT,
  source_created_at TIMESTAMP WITH TIME ZONE,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  is_edited BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_activities_type_check CHECK (activity_type IN ('message', 'mention', 'reply', 'thread_reply', 'message_edited', 'message_deleted')),
  CONSTRAINT slack_activities_conversation_type_check CHECK (conversation_type IN ('public_channel', 'private_channel', 'group_conversation', 'direct_message')),
  CONSTRAINT slack_activities_message_unique UNIQUE (workspace_id, slack_team_id, slack_conversation_id, slack_message_ts)
);

CREATE INDEX IF NOT EXISTS idx_slack_activities_workspace_processed
  ON public.slack_activities(workspace_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_slack_activities_workspace_thread
  ON public.slack_activities(workspace_id, slack_conversation_id, slack_root_thread_ts);

CREATE TABLE IF NOT EXISTS public.slack_activity_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES public.slack_activities(id) ON DELETE CASCADE,
  slack_watch_id UUID REFERENCES public.slack_watches(id) ON DELETE SET NULL,
  slack_context_id UUID REFERENCES public.slack_contexts(id) ON DELETE SET NULL,
  ledger_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_activity_matches_type_check CHECK (match_type IN ('personal_watch', 'shared_watch', 'mention', 'reply', 'captured_context'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_activity_matches_unique
  ON public.slack_activity_matches(activity_id, COALESCE(slack_watch_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(slack_context_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(ledger_user_id, '00000000-0000-0000-0000-000000000000'::uuid), match_type);
CREATE INDEX IF NOT EXISTS idx_slack_activity_matches_user
  ON public.slack_activity_matches(workspace_id, ledger_user_id, created_at DESC);

ALTER TABLE public.slack_event_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_activity_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read Slack activities" ON public.slack_activities;
CREATE POLICY "Workspace members can read Slack activities"
  ON public.slack_activities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.slack_activity_matches match
      WHERE match.activity_id = slack_activities.id
        AND (
          match.ledger_user_id = auth.uid()
          OR (match.ledger_user_id IS NULL AND EXISTS (
            SELECT 1 FROM public.slack_watches watch
            WHERE watch.id = match.slack_watch_id
              AND watch.watch_type = 'shared'
              AND (public.is_workspace_owner(slack_activities.workspace_id, auth.uid()) OR public.is_workspace_member(slack_activities.workspace_id, auth.uid()))
          ))
        )
    )
  );

DROP POLICY IF EXISTS "Users can read their Slack activity matches" ON public.slack_activity_matches;
CREATE POLICY "Users can read their Slack activity matches"
  ON public.slack_activity_matches FOR SELECT
  USING (
    ledger_user_id = auth.uid()
    OR (ledger_user_id IS NULL AND EXISTS (
      SELECT 1 FROM public.slack_watches watch
      WHERE watch.id = slack_activity_matches.slack_watch_id
        AND watch.watch_type = 'shared'
        AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()))
    ))
  );

DROP POLICY IF EXISTS "Workspace members can read Slack event deliveries" ON public.slack_event_deliveries;
CREATE POLICY "Workspace members can read Slack event deliveries"
  ON public.slack_event_deliveries FOR SELECT
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));

