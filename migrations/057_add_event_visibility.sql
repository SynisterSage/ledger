-- Migration: 057_add_event_visibility
-- Description: Persist event visibility so calendar defaults can be applied in the event editor.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private';

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_visibility_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_visibility_check
  CHECK (visibility IN ('private', 'workspace'));
