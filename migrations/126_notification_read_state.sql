-- Migration: 126_notification_read_state
-- Description: Keep notification read state independent from workflow actions.

ALTER TABLE public.notification_events
ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

UPDATE public.notification_events
SET read_at = COALESCE(updated_at, NOW())
WHERE read_at IS NULL
  AND action_taken = 'open';

CREATE INDEX IF NOT EXISTS idx_notification_events_user_read_at
  ON public.notification_events(user_id, read_at, scheduled_for DESC);
