-- Migration: 064_create_mobile_push_tokens
-- Description: Store mobile push tokens for Expo push delivery.

CREATE TABLE IF NOT EXISTS public.mobile_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'ios',
  push_token TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mobile_push_tokens_platform_check CHECK (platform IN ('ios', 'android'))
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_user_id
  ON public.mobile_push_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_platform
  ON public.mobile_push_tokens(platform);

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_enabled
  ON public.mobile_push_tokens(user_id, platform, enabled)
  WHERE revoked_at IS NULL;

ALTER TABLE public.mobile_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own mobile push tokens" ON public.mobile_push_tokens;
CREATE POLICY "Users can read own mobile push tokens"
  ON public.mobile_push_tokens
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own mobile push tokens" ON public.mobile_push_tokens;
CREATE POLICY "Users can create own mobile push tokens"
  ON public.mobile_push_tokens
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own mobile push tokens" ON public.mobile_push_tokens;
CREATE POLICY "Users can update own mobile push tokens"
  ON public.mobile_push_tokens
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own mobile push tokens" ON public.mobile_push_tokens;
CREATE POLICY "Users can delete own mobile push tokens"
  ON public.mobile_push_tokens
  FOR DELETE
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_mobile_push_tokens_updated_at ON public.mobile_push_tokens;
CREATE TRIGGER update_mobile_push_tokens_updated_at
  BEFORE UPDATE ON public.mobile_push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.notification_events
ADD COLUMN IF NOT EXISTS delivered_mobile_at TIMESTAMPTZ;
