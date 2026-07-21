-- MCP Phase 2: explicit scope upgrades and bounded mutation idempotency.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON public.tasks(created_by);

CREATE TABLE IF NOT EXISTS public.mcp_scope_upgrade_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_code_hash TEXT NOT NULL,
  poll_secret_hash TEXT NOT NULL,
  requested_scopes TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'expired')),
  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_scope_upgrade_expiry
  ON public.mcp_scope_upgrade_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_scope_upgrade_connection
  ON public.mcp_scope_upgrade_sessions(connection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mcp_idempotency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_type TEXT,
  result_id UUID,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(connection_id, workspace_id, tool_name, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_mcp_idempotency_expiry
  ON public.mcp_idempotency_records(expires_at);

ALTER TABLE public.mcp_scope_upgrade_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_idempotency_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own MCP scope upgrades" ON public.mcp_scope_upgrade_sessions;
CREATE POLICY "Users can manage own MCP scope upgrades"
  ON public.mcp_scope_upgrade_sessions FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read own MCP idempotency records" ON public.mcp_idempotency_records;
CREATE POLICY "Users can read own MCP idempotency records"
  ON public.mcp_idempotency_records FOR SELECT
  USING (user_id = auth.uid());
