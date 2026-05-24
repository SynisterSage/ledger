-- Migration: 058_create_notification_preferences
-- Description: Store global per-user notification preferences.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  desktop_enabled BOOLEAN NOT NULL DEFAULT false,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  events_enabled BOOLEAN NOT NULL DEFAULT true,
  tasks_enabled BOOLEAN NOT NULL DEFAULT false,
  project_deadlines_enabled BOOLEAN NOT NULL DEFAULT true,
  inbox_captures_enabled BOOLEAN NOT NULL DEFAULT false,
  overdue_enabled BOOLEAN NOT NULL DEFAULT true,
  default_event_lead_minutes INTEGER NOT NULL DEFAULT 10,
  default_task_timing TEXT NOT NULL DEFAULT 'morning_of',
  default_project_deadline_lead_days INTEGER NOT NULL DEFAULT 1,
  default_snooze_minutes INTEGER NOT NULL DEFAULT 10,
  keep_overdue_visible BOOLEAN NOT NULL DEFAULT true,
  notify_while_fullscreen BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_preferences_default_task_timing_check CHECK (
    default_task_timing IN ('morning_of', 'at_due_time', 'day_before', 'none')
  ),
  CONSTRAINT notification_preferences_default_event_lead_check CHECK (
    default_event_lead_minutes IN (0, 5, 10, 30, 60)
  ),
  CONSTRAINT notification_preferences_default_project_deadline_lead_check CHECK (
    default_project_deadline_lead_days IN (0, 1, 3, 7)
  ),
  CONSTRAINT notification_preferences_default_snooze_check CHECK (
    default_snooze_minutes IN (10, 30, 60, 1440)
  )
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id
  ON public.notification_preferences(user_id);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can read own notification preferences"
  ON public.notification_preferences
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can create own notification preferences"
  ON public.notification_preferences
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can update own notification preferences"
  ON public.notification_preferences
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can delete own notification preferences"
  ON public.notification_preferences
  FOR DELETE
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
