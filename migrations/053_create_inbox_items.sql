-- Migration: 053_create_inbox_items
-- Description: Store workspace-scoped inbox captures and conversion state.

CREATE TABLE IF NOT EXISTS public.inbox_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  title TEXT NOT NULL,
  body TEXT,
  raw_payload JSONB,
  suggested_type TEXT,
  status TEXT NOT NULL DEFAULT 'unprocessed',
  converted_type TEXT,
  converted_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT inbox_items_source_check CHECK (source <> ''),
  CONSTRAINT inbox_items_status_check CHECK (status IN ('unprocessed', 'converted', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace_status
  ON public.inbox_items(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_items_user_status
  ON public.inbox_items(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_items_source_id
  ON public.inbox_items(workspace_id, source, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE public.inbox_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read workspace inbox items" ON public.inbox_items;
CREATE POLICY "Users can read workspace inbox items"
  ON public.inbox_items
  FOR SELECT
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can manage workspace inbox items" ON public.inbox_items;
CREATE POLICY "Users can manage workspace inbox items"
  ON public.inbox_items
  FOR ALL
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );
