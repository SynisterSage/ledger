-- Migration: 017_add_event_color
-- Description: Allow per-event color customization for calendar readability.

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS color VARCHAR(7) NOT NULL DEFAULT '#93C5FD';

CREATE INDEX IF NOT EXISTS idx_events_color ON public.events(color);
