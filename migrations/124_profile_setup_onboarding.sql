-- Versioned profile setup completion for new-account onboarding.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_setup_completed_at TIMESTAMP WITH TIME ZONE;

-- Existing accounts have already completed the identity portion of onboarding;
-- only accounts created after this migration should see the optional step.
UPDATE public.users
SET profile_setup_completed_at = COALESCE(created_at, TIMEZONE('utc'::text, NOW()))
WHERE profile_setup_completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_profile_setup_completed_at
  ON public.users(profile_setup_completed_at);
