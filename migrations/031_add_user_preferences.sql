-- Migration: 031_add_user_preferences
-- Description: Persist user-level UI and behavior preferences on public.users.

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
