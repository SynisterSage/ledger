-- Migration: 139_calendar_event_provider_links
-- Description: Preserve durable identity between Ledger events and provider events.

CREATE TABLE IF NOT EXISTS public.calendar_event_provider_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  provider_account_key TEXT,
  provider_calendar_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  provider_series_id TEXT,
  direction TEXT NOT NULL DEFAULT 'exported' CHECK (direction IN ('imported', 'exported', 'bidirectional')),
  last_provider_modified_at TIMESTAMPTZ,
  last_ledger_modified_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending', 'conflict', 'error')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider, provider_calendar_id, provider_event_id),
  UNIQUE (event_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_provider_links_workspace
  ON public.calendar_event_provider_links(workspace_id, provider);
CREATE INDEX IF NOT EXISTS idx_calendar_event_provider_links_event
  ON public.calendar_event_provider_links(event_id);

ALTER TABLE public.calendar_event_provider_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read calendar event provider links" ON public.calendar_event_provider_links;
CREATE POLICY "Workspace members can read calendar event provider links"
  ON public.calendar_event_provider_links FOR SELECT USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members can manage calendar event provider links" ON public.calendar_event_provider_links;
CREATE POLICY "Workspace members can manage calendar event provider links"
  ON public.calendar_event_provider_links FOR ALL USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  ) WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );
