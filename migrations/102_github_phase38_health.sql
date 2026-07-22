-- Migration: 102_github_phase38_health
-- Description: Bounded workspace-scoped health metadata for the GitHub App connection.
-- No provider credentials, webhook payloads, or tokens are stored here.

ALTER TABLE public.github_installations
  ADD COLUMN IF NOT EXISTS last_webhook_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_error_message TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_error_at TIMESTAMPTZ;

ALTER TABLE public.github_installations
  DROP CONSTRAINT IF EXISTS github_installations_sync_error_message_length;

ALTER TABLE public.github_installations
  ADD CONSTRAINT github_installations_sync_error_message_length
  CHECK (last_sync_error_message IS NULL OR length(last_sync_error_message) <= 240);

CREATE INDEX IF NOT EXISTS idx_github_installations_health
  ON public.github_installations(workspace_id, status, last_synced_at, last_webhook_processed_at);
