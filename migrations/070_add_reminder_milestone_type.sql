-- Migration: 070_add_reminder_milestone_type
-- Description: Allow Reminder as a project milestone type.

ALTER TABLE public.project_milestones
DROP CONSTRAINT IF EXISTS project_milestones_type_check;

ALTER TABLE public.project_milestones
ADD CONSTRAINT project_milestones_type_check CHECK (
  type IN ('Deadline', 'Decision', 'Review', 'Event', 'Reminder', 'Handoff', 'Custom')
);
