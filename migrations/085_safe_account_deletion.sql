-- Migration: 085_safe_account_deletion
-- Description: Preserve shared workspaces and shared records when a user deletes their account.

ALTER TABLE public.workspaces
  ALTER COLUMN owner_id DROP NOT NULL;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_owner_id_fkey;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- These fields identify an actor or owner; they must not cascade-delete shared records.
ALTER TABLE public.calendars
  ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.calendars
  DROP CONSTRAINT IF EXISTS calendars_owner_id_fkey;
ALTER TABLE public.calendars
  ADD CONSTRAINT calendars_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.events
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_created_by_fkey;
ALTER TABLE public.events
  ADD CONSTRAINT events_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.reminders
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.reminders
  DROP CONSTRAINT IF EXISTS reminders_created_by_fkey;
ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.notes
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_user_id_fkey;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.workspace_audit_logs
  ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE public.workspace_audit_logs
  DROP CONSTRAINT IF EXISTS workspace_audit_logs_actor_user_id_fkey;
ALTER TABLE public.workspace_audit_logs
  ADD CONSTRAINT workspace_audit_logs_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.workspace_invites
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.workspace_invites
  DROP CONSTRAINT IF EXISTS workspace_invites_created_by_fkey;
ALTER TABLE public.workspace_invites
  ADD CONSTRAINT workspace_invites_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.workspace_invitations
  ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE public.workspace_invitations
  DROP CONSTRAINT IF EXISTS workspace_invitations_invited_by_fkey;
ALTER TABLE public.workspace_invitations
  ADD CONSTRAINT workspace_invitations_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.note_templates
  DROP CONSTRAINT IF EXISTS note_templates_created_by_fkey;
ALTER TABLE public.note_templates
  ADD CONSTRAINT note_templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
