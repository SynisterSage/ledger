-- Migration: 116_calendar_subscription_settings
-- Description: Add workspace-scoped, read-only Ledger calendar subscription settings.

ALTER TABLE public.calendar_sync_tokens
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_calendar_sync_tokens_workspace_id
  ON public.calendar_sync_tokens(workspace_id);

-- The original token table allowed one active token per user and exported all
-- owner workspaces. Keep those legacy rows usable while new subscriptions are
-- scoped to one workspace.
ALTER TABLE public.calendar_sync_tokens
  DROP CONSTRAINT IF EXISTS calendar_sync_tokens_user_id_is_active_key;

CREATE TABLE IF NOT EXISTS public.calendar_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  include_events BOOLEAN NOT NULL DEFAULT true,
  include_reminders BOOLEAN NOT NULL DEFAULT true,
  include_tasks BOOLEAN NOT NULL DEFAULT false,
  include_milestones BOOLEAN NOT NULL DEFAULT false,
  include_project_deadlines BOOLEAN NOT NULL DEFAULT false,
  include_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS public.calendar_subscription_calendars (
  subscription_id UUID NOT NULL REFERENCES public.calendar_subscriptions(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
  PRIMARY KEY(subscription_id, calendar_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_subscriptions_workspace_id
  ON public.calendar_subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_calendar_subscription_calendars_calendar_id
  ON public.calendar_subscription_calendars(calendar_id);

CREATE TABLE IF NOT EXISTS public.calendar_subscription_feed_items (
  token_hash TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id UUID NOT NULL,
  uid TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tombstoned_at TIMESTAMPTZ,
  PRIMARY KEY(token_hash, uid)
);

CREATE INDEX IF NOT EXISTS idx_calendar_subscription_feed_items_tombstones
  ON public.calendar_subscription_feed_items(token_hash, tombstoned_at);

ALTER TABLE public.calendar_subscription_feed_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calendar_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_subscription_calendars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own calendar subscriptions" ON public.calendar_subscriptions;
CREATE POLICY "Users can manage own calendar subscriptions"
  ON public.calendar_subscriptions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage own subscription calendars" ON public.calendar_subscription_calendars;
CREATE POLICY "Users can manage own subscription calendars"
  ON public.calendar_subscription_calendars
  FOR ALL
  USING (
    subscription_id IN (
      SELECT id FROM public.calendar_subscriptions WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    subscription_id IN (
      SELECT id FROM public.calendar_subscriptions WHERE user_id = auth.uid()
    )
  );
