-- Migration: 055_add_inbox_items_upsert_constraint
-- Description: Add unique constraint for workspace/source/source_id to enable ON CONFLICT upsert for Slack captures.

-- Drop the partial index that doesn't work with ON CONFLICT
DROP INDEX IF EXISTS idx_inbox_items_source_id;

-- Add unique constraint for ON CONFLICT upsert
-- This allows the backend to upsert Slack messages by workspace/source/source_id
DO $$ 
BEGIN
  BEGIN
    ALTER TABLE public.inbox_items
    ADD CONSTRAINT inbox_items_workspace_source_source_id_unique
    UNIQUE (workspace_id, source, source_id);
  EXCEPTION WHEN duplicate_object THEN
    -- Constraint already exists, safe to ignore
    NULL;
  END;
END $$;

-- Create index for efficient querying by workspace and source
CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace_source
  ON public.inbox_items(workspace_id, source, created_at DESC);
