-- Migration: 078_add_snoozed_state_to_inbox_items
-- Description: Add snoozed intake state and snoozed_until scheduling to inbox items.

ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;

ALTER TABLE public.inbox_items
  DROP CONSTRAINT IF EXISTS inbox_items_status_check;

ALTER TABLE public.inbox_items
  ADD CONSTRAINT inbox_items_status_check
  CHECK (status IN ('unprocessed', 'converted', 'snoozed', 'archived'));

CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace_status_snoozed_until
  ON public.inbox_items(workspace_id, status, snoozed_until, created_at DESC);
