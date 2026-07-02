-- Migration: 076_add_team_assignment_to_events_and_reminders
-- Description: Persist team assignment for events and reminders.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES public.workspace_teams(id) ON DELETE SET NULL;

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES public.workspace_teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_assigned_to_team_id
  ON public.events(assigned_to_team_id);

CREATE INDEX IF NOT EXISTS idx_reminders_assigned_to_team_id
  ON public.reminders(assigned_to_team_id);
