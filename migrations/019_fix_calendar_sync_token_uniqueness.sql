-- Migration: 019_fix_calendar_sync_token_uniqueness
-- Description: Allow multiple historical revoked tokens per user, enforce only one active token.

ALTER TABLE public.calendar_sync_tokens
DROP CONSTRAINT IF EXISTS calendar_sync_tokens_user_id_is_active_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_calendar_sync_tokens_one_active_per_user
  ON public.calendar_sync_tokens(user_id)
  WHERE is_active = true;
