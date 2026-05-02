-- Migration: 029_create_workspace_audit_logs
-- Description: Add workspace audit logging table for membership and invitation lifecycle events.

CREATE TABLE IF NOT EXISTS public.workspace_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id UUID,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_workspace_audit_logs_workspace_created_at
  ON public.workspace_audit_logs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_audit_logs_actor_created_at
  ON public.workspace_audit_logs(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_audit_logs_action
  ON public.workspace_audit_logs(action);

ALTER TABLE public.workspace_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read workspace audit logs" ON public.workspace_audit_logs;
CREATE POLICY "Users can read workspace audit logs"
  ON public.workspace_audit_logs
  FOR SELECT
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );
