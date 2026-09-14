-- Migration: 140_agent_action_idempotency
-- Description: Durable replay protection for confirmed Ledger Agent mutations.

CREATE TABLE IF NOT EXISTS public.agent_action_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('create_task', 'create_note', 'create_reminder', 'update_task_status')),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, actor_user_id, action_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_action_idempotency_workspace
  ON public.agent_action_idempotency(workspace_id, created_at DESC);

ALTER TABLE public.agent_action_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read agent action idempotency" ON public.agent_action_idempotency;
CREATE POLICY "Workspace members can read agent action idempotency"
  ON public.agent_action_idempotency FOR SELECT USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members can manage agent action idempotency" ON public.agent_action_idempotency;
CREATE POLICY "Workspace members can manage agent action idempotency"
  ON public.agent_action_idempotency FOR ALL USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  ) WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );
