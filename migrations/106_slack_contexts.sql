-- Migration: 106_slack_contexts
-- Description: Store reusable workspace-scoped Slack context and polymorphic links.

CREATE TABLE IF NOT EXISTS public.slack_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_account_id UUID REFERENCES public.integration_accounts(id) ON DELETE SET NULL,
  slack_team_id TEXT NOT NULL,
  slack_channel_id TEXT NOT NULL,
  slack_channel_name TEXT,
  root_message_ts TEXT NOT NULL,
  captured_message_ts TEXT NOT NULL,
  message_text TEXT,
  message_author_slack_id TEXT,
  message_author_name TEXT,
  message_author_avatar_url TEXT,
  permalink TEXT,
  message_created_at TIMESTAMP WITH TIME ZONE,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  sync_status TEXT NOT NULL DEFAULT 'static',
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_contexts_sync_status_check CHECK (sync_status IN ('static', 'sync_ready', 'syncing', 'sync_error', 'disconnected')),
  CONSTRAINT slack_contexts_identity_unique UNIQUE (workspace_id, slack_team_id, slack_channel_id, root_message_ts)
);

CREATE INDEX IF NOT EXISTS idx_slack_contexts_workspace_captured
  ON public.slack_contexts(workspace_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_slack_contexts_workspace_search
  ON public.slack_contexts(workspace_id, slack_channel_name, message_author_name);

CREATE TABLE IF NOT EXISTS public.slack_context_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slack_context_id UUID NOT NULL REFERENCES public.slack_contexts(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  relationship_type TEXT NOT NULL DEFAULT 'context',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT slack_context_links_target_check CHECK (target_type IN ('intake_item', 'task', 'note', 'event', 'reminder', 'project', 'project_resource')),
  CONSTRAINT slack_context_links_unique UNIQUE (workspace_id, slack_context_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_context_links_context
  ON public.slack_context_links(workspace_id, slack_context_id);
CREATE INDEX IF NOT EXISTS idx_slack_context_links_target
  ON public.slack_context_links(workspace_id, target_type, target_id);

ALTER TABLE public.slack_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_context_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read Slack contexts" ON public.slack_contexts;
CREATE POLICY "Workspace members can read Slack contexts"
  ON public.slack_contexts FOR SELECT
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members can manage Slack contexts" ON public.slack_contexts;
CREATE POLICY "Workspace members can manage Slack contexts"
  ON public.slack_contexts FOR ALL
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = slack_contexts.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')
  ))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = slack_contexts.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')
  ));

DROP POLICY IF EXISTS "Workspace members can read Slack context links" ON public.slack_context_links;
CREATE POLICY "Workspace members can read Slack context links"
  ON public.slack_context_links FOR SELECT
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members can manage Slack context links" ON public.slack_context_links;
CREATE POLICY "Workspace members can manage Slack context links"
  ON public.slack_context_links FOR ALL
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = slack_context_links.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')
  ))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = slack_context_links.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')
  ));

ALTER TABLE public.external_sources
  ADD COLUMN IF NOT EXISTS slack_context_id UUID REFERENCES public.slack_contexts(id) ON DELETE SET NULL;

-- Backfill is idempotent: the context identity and link uniqueness constraints
-- make reruns safe while preserving existing captures and Intake records.
INSERT INTO public.slack_contexts (
  workspace_id, integration_account_id, slack_team_id, slack_channel_id,
  slack_channel_name, root_message_ts, captured_message_ts, message_text,
  message_author_slack_id, message_author_name, permalink, message_created_at,
  captured_at, created_at, updated_at
)
SELECT DISTINCT ON (
  source.workspace_id,
  COALESCE(source.slack_team_id, split_part(source.external_id, ':', 1)),
  COALESCE(source.slack_channel_id, split_part(source.external_id, ':', 2)),
  COALESCE(NULLIF(source.raw_payload->'message'->>'thread_ts', ''), source.slack_message_ts, split_part(source.external_id, ':', 3))
)
  source.workspace_id,
  source.integration_account_id,
  COALESCE(source.slack_team_id, split_part(source.external_id, ':', 1)),
  COALESCE(source.slack_channel_id, split_part(source.external_id, ':', 2)),
  source.channel_name,
  COALESCE(NULLIF(source.raw_payload->'message'->>'thread_ts', ''), source.slack_message_ts, split_part(source.external_id, ':', 3)),
  COALESCE(source.slack_message_ts, split_part(source.external_id, ':', 3)),
  source.captured_text,
  source.slack_user_id,
  source.author_name,
  source.external_url,
  source.captured_at,
  source.created_at,
  source.created_at,
  source.updated_at
FROM public.external_sources source
WHERE source.provider = 'slack'
  AND source.external_id IS NOT NULL
  AND COALESCE(source.slack_team_id, split_part(source.external_id, ':', 1)) <> ''
  AND COALESCE(source.slack_channel_id, split_part(source.external_id, ':', 2)) <> ''
ORDER BY source.workspace_id, COALESCE(source.slack_team_id, split_part(source.external_id, ':', 1)), COALESCE(source.slack_channel_id, split_part(source.external_id, ':', 2)), COALESCE(NULLIF(source.raw_payload->'message'->>'thread_ts', ''), source.slack_message_ts, split_part(source.external_id, ':', 3)), source.created_at DESC
ON CONFLICT (workspace_id, slack_team_id, slack_channel_id, root_message_ts) DO NOTHING;

INSERT INTO public.slack_context_links (workspace_id, slack_context_id, target_type, target_id, relationship_type, created_by)
SELECT source.workspace_id, context.id, 'intake_item', inbox.id, 'source', inbox.user_id
FROM public.external_sources source
JOIN public.inbox_items inbox ON inbox.workspace_id = source.workspace_id AND inbox.source = 'slack' AND inbox.source_id = source.external_id
JOIN public.slack_contexts context ON context.workspace_id = source.workspace_id
  AND context.slack_team_id = COALESCE(source.slack_team_id, split_part(source.external_id, ':', 1))
  AND context.slack_channel_id = COALESCE(source.slack_channel_id, split_part(source.external_id, ':', 2))
  AND context.root_message_ts = COALESCE(NULLIF(source.raw_payload->'message'->>'thread_ts', ''), source.slack_message_ts, split_part(source.external_id, ':', 3))
ON CONFLICT DO NOTHING;

INSERT INTO public.slack_context_links (workspace_id, slack_context_id, target_type, target_id, relationship_type, created_by)
SELECT context.workspace_id, context.id, inbox.converted_type, inbox.converted_id, 'conversion', inbox.converted_by
FROM public.inbox_items inbox
JOIN public.external_sources source ON source.workspace_id = inbox.workspace_id AND source.provider = 'slack' AND source.external_id = inbox.source_id
JOIN public.slack_contexts context ON context.workspace_id = source.workspace_id
  AND context.slack_team_id = COALESCE(source.slack_team_id, split_part(source.external_id, ':', 1))
  AND context.slack_channel_id = COALESCE(source.slack_channel_id, split_part(source.external_id, ':', 2))
  AND context.root_message_ts = COALESCE(NULLIF(source.raw_payload->'message'->>'thread_ts', ''), source.slack_message_ts, split_part(source.external_id, ':', 3))
WHERE inbox.converted_id IS NOT NULL
  AND inbox.converted_type IN ('task', 'note', 'event', 'reminder', 'project')
ON CONFLICT DO NOTHING;

UPDATE public.external_sources source
SET slack_context_id = context.id
FROM public.slack_contexts context
WHERE source.provider = 'slack'
  AND context.workspace_id = source.workspace_id
  AND context.slack_team_id = COALESCE(source.slack_team_id, split_part(source.external_id, ':', 1))
  AND context.slack_channel_id = COALESCE(source.slack_channel_id, split_part(source.external_id, ':', 2))
  AND context.root_message_ts = COALESCE(NULLIF(source.raw_payload->'message'->>'thread_ts', ''), source.slack_message_ts, split_part(source.external_id, ':', 3))
  AND source.slack_context_id IS NULL;
