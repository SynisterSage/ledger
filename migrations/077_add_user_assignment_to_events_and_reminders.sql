-- Migration: 077_add_user_assignment_to_events_and_reminders
-- Description: Add individual assignment support for events and reminders.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_events_assigned_to_user_id
  ON public.events(assigned_to_user_id);

CREATE INDEX IF NOT EXISTS idx_reminders_assigned_to_user_id
  ON public.reminders(assigned_to_user_id);
