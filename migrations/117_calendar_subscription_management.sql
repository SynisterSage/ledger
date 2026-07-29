-- Migration: 117_calendar_subscription_management
-- Description: Add lifecycle and request tracking for private calendar feeds.

ALTER TABLE public.calendar_subscriptions
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_calendar_subscriptions_enabled
  ON public.calendar_subscriptions(enabled);
