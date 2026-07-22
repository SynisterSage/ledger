-- Migration: 108_slack_watches
-- Description: Configure personal and shared Slack conversation watches without importing activity.

-- Phase 3 may already have created this foreign key with cascading deletion.
-- Keep identities and future watches when the shared connection is disconnected.
ALTER TABLE IF EXISTS public.slack_identities
  ALTER COLUMN integration_account_id DROP NOT NULL;
ALTER TABLE IF EXISTS public.slack_identities
  DROP CONSTRAINT IF EXISTS slack_identities_integration_account_id_fkey;
ALTER TABLE IF EXISTS public.slack_identities
  ADD CONSTRAINT slack_identities_integration_account_id_fkey
  FOREIGN KEY (integration_account_id) REFERENCES public.integration_accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.slack_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_account_id UUID REFERENCES public.integration_accounts(id) ON DELETE SET NULL,
  slack_team_id TEXT,
  slack_conversation_id TEXT NOT NULL,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  owner_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  watch_type TEXT NOT NULL,
  conversation_type TEXT NOT NULL,
  conversation_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  watch_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  activation_latest_message_ts TEXT,
  last_activity_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_watches_type_check CHECK (watch_type IN ('personal', 'shared')),
  CONSTRAINT slack_watches_conversation_type_check CHECK (conversation_type IN ('public_channel', 'private_channel', 'group_conversation', 'direct_message')),
  CONSTRAINT slack_watches_status_check CHECK (status IN ('active', 'paused', 'access_lost', 'disconnected', 'removed')),
  CONSTRAINT slack_watches_shared_public_check CHECK (watch_type <> 'shared' OR conversation_type = 'public_channel'),
  CONSTRAINT slack_watches_owner_check CHECK ((watch_type = 'personal' AND owner_user_id IS NOT NULL) OR (watch_type = 'shared' AND owner_user_id IS NULL))
);

ALTER TABLE public.slack_watches
  ADD COLUMN IF NOT EXISTS slack_team_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_watches_personal_unique
  ON public.slack_watches(workspace_id, integration_account_id, slack_conversation_id, owner_user_id)
  WHERE watch_type = 'personal' AND status <> 'removed';
CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_watches_shared_unique
  ON public.slack_watches(workspace_id, integration_account_id, slack_conversation_id)
  WHERE watch_type = 'shared' AND status <> 'removed';
CREATE INDEX IF NOT EXISTS idx_slack_watches_workspace_owner
  ON public.slack_watches(workspace_id, owner_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.slack_watch_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slack_watch_id UUID NOT NULL REFERENCES public.slack_watches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  include_in_daily_recap BOOLEAN NOT NULL DEFAULT true,
  show_mentions BOOLEAN NOT NULL DEFAULT true,
  show_replies BOOLEAN NOT NULL DEFAULT true,
  show_active_threads BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_watch_preferences_unique UNIQUE (slack_watch_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_watch_preferences_user
  ON public.slack_watch_preferences(workspace_id, user_id, updated_at DESC);

ALTER TABLE public.slack_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_watch_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read Slack watches they can see" ON public.slack_watches;
CREATE POLICY "Users can read Slack watches they can see"
  ON public.slack_watches FOR SELECT
  USING (
    (watch_type = 'personal' AND owner_user_id = auth.uid())
    OR (watch_type = 'shared' AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid())))
  );

DROP POLICY IF EXISTS "Users can manage their Slack watches" ON public.slack_watches;
CREATE POLICY "Users can manage their Slack watches"
  ON public.slack_watches FOR ALL
  USING (
    (watch_type = 'personal' AND owner_user_id = auth.uid())
    OR (watch_type = 'shared' AND (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = slack_watches.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'admin')))
  )
  WITH CHECK (
    (watch_type = 'personal' AND owner_user_id = auth.uid())
    OR (watch_type = 'shared' AND (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = slack_watches.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'admin')))
  );

DROP POLICY IF EXISTS "Users can read Slack watch preferences" ON public.slack_watch_preferences;
CREATE POLICY "Users can read Slack watch preferences"
  ON public.slack_watch_preferences FOR SELECT
  USING (
    user_id = auth.uid()
    AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()))
    AND EXISTS (SELECT 1 FROM public.slack_watches watch WHERE watch.id = slack_watch_preferences.slack_watch_id AND watch.workspace_id = slack_watch_preferences.workspace_id AND ((watch.watch_type = 'personal' AND watch.owner_user_id = auth.uid()) OR watch.watch_type = 'shared'))
  );

DROP POLICY IF EXISTS "Users can manage Slack watch preferences" ON public.slack_watch_preferences;
CREATE POLICY "Users can manage Slack watch preferences"
  ON public.slack_watch_preferences FOR ALL
  USING (
    user_id = auth.uid()
    AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()))
    AND EXISTS (SELECT 1 FROM public.slack_watches watch WHERE watch.id = slack_watch_preferences.slack_watch_id AND watch.workspace_id = slack_watch_preferences.workspace_id AND ((watch.watch_type = 'personal' AND watch.owner_user_id = auth.uid()) OR watch.watch_type = 'shared'))
  )
  WITH CHECK (
    user_id = auth.uid()
    AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()))
    AND EXISTS (SELECT 1 FROM public.slack_watches watch WHERE watch.id = slack_watch_preferences.slack_watch_id AND watch.workspace_id = slack_watch_preferences.workspace_id AND ((watch.watch_type = 'personal' AND watch.owner_user_id = auth.uid()) OR watch.watch_type = 'shared'))
  );
