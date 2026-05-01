-- Migration: 018_create_calendar_sync_tokens
-- Description: Per-user secret tokens for iCal subscription feeds.

CREATE TABLE IF NOT EXISTS public.calendar_sync_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(user_id, is_active)
);

ALTER TABLE public.calendar_sync_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own calendar sync tokens"
  ON public.calendar_sync_tokens
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own calendar sync tokens"
  ON public.calendar_sync_tokens
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own calendar sync tokens"
  ON public.calendar_sync_tokens
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own calendar sync tokens"
  ON public.calendar_sync_tokens
  FOR DELETE
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_calendar_sync_tokens_user_id
  ON public.calendar_sync_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_tokens_token
  ON public.calendar_sync_tokens(token);
