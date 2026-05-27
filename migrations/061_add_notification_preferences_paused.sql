-- Migration: 061_add_notification_preferences_paused
-- Description: Add a global pause toggle for notification delivery.

ALTER TABLE public.notification_preferences
ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false;
