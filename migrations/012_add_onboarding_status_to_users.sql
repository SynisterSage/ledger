-- Migration: 012_add_onboarding_status_to_users
-- Description: Persist onboarding completion state so first-time experience is shown only once.

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_users_onboarding_completed
  ON public.users(onboarding_completed);
