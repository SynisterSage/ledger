-- Migration: 059_create_notification_events
-- Description: Track notification delivery and dedupe across sources.

CREATE TABLE IF NOT EXISTS public.notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  delivered_in_app_at TIMESTAMPTZ,
  delivered_desktop_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  action_taken TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_events_dedupe
  ON public.notification_events(user_id, source_type, source_id, notification_type, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_notification_events_user_scheduled
  ON public.notification_events(user_id, scheduled_for DESC);

CREATE INDEX IF NOT EXISTS idx_notification_events_workspace
  ON public.notification_events(workspace_id, scheduled_for DESC);

CREATE INDEX IF NOT EXISTS idx_notification_events_source
  ON public.notification_events(source_type, source_id);

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own notification events" ON public.notification_events;
CREATE POLICY "Users can read own notification events"
  ON public.notification_events
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own notification events" ON public.notification_events;
CREATE POLICY "Users can create own notification events"
  ON public.notification_events
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notification events" ON public.notification_events;
CREATE POLICY "Users can update own notification events"
  ON public.notification_events
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own notification events" ON public.notification_events;
CREATE POLICY "Users can delete own notification events"
  ON public.notification_events
  FOR DELETE
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_notification_events_updated_at ON public.notification_events;
CREATE TRIGGER update_notification_events_updated_at
  BEFORE UPDATE ON public.notification_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
