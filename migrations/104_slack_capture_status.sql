-- Migration: 104_slack_capture_status
-- Description: Track Slack capture processing and enforce one capture per Slack message.

ALTER TABLE public.external_sources
  ADD COLUMN IF NOT EXISTS slack_team_id TEXT,
  ADD COLUMN IF NOT EXISTS slack_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS slack_message_ts TEXT,
  ADD COLUMN IF NOT EXISTS slack_user_id TEXT,
  ADD COLUMN IF NOT EXISTS capture_action_id TEXT,
  ADD COLUMN IF NOT EXISTS capture_status TEXT NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS intake_item_id UUID REFERENCES public.inbox_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS captured_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.external_sources
SET slack_team_id = split_part(external_id, ':', 1),
    slack_channel_id = split_part(external_id, ':', 2),
    slack_message_ts = substring(external_id from '^[^:]+:[^:]+:(.*)$')
WHERE provider = 'slack'
  AND external_id IS NOT NULL
  AND slack_team_id IS NULL;

-- Link legacy Slack source rows to the Intake item that the old handler may
-- already have created, so a post-deploy retry is an idempotent success.
UPDATE public.external_sources source
SET intake_item_id = item.id,
    capture_status = 'completed'
FROM public.inbox_items item
WHERE source.provider = 'slack'
  AND item.workspace_id = source.workspace_id
  AND item.source = 'slack'
  AND item.source_id = source.external_id
  AND source.intake_item_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'external_sources_capture_status_check'
  ) THEN
    ALTER TABLE public.external_sources
      ADD CONSTRAINT external_sources_capture_status_check
      CHECK (capture_status IN ('received', 'processing', 'completed', 'failed'));
  END IF;
END $$;

-- Older retries could leave duplicate external-source rows. Keep the newest
-- row for each Slack message before adding the production uniqueness guard.
DELETE FROM public.external_sources older
WHERE older.provider = 'slack'
  AND older.external_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.external_sources newer
    WHERE newer.provider = older.provider
      AND newer.workspace_id = older.workspace_id
      AND newer.external_id = older.external_id
      AND (newer.created_at, newer.id) > (older.created_at, older.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_sources_slack_message_unique
  ON public.external_sources(workspace_id, provider, external_id)
  WHERE provider = 'slack' AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_sources_slack_capture_status
  ON public.external_sources(workspace_id, provider, capture_status, created_at DESC)
  WHERE provider = 'slack';
