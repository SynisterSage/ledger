-- MCP Phase 1: read-only, workspace-bound external connections.
CREATE TABLE IF NOT EXISTS public.mcp_authorization_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_code_hash TEXT NOT NULL,
  poll_secret_hash TEXT NOT NULL,
  client_name TEXT NOT NULL,
  requested_scopes TEXT[] NOT NULL DEFAULT ARRAY['workspace:read']::TEXT[],
  requested_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'expired')),
  approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_authorization_sessions_expiry
  ON public.mcp_authorization_sessions(status, expires_at);

CREATE TABLE IF NOT EXISTS public.mcp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  credential_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_connections_user_status
  ON public.mcp_connections(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mcp_connection_scopes (
  connection_id UUID NOT NULL REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, scope)
);

CREATE TABLE IF NOT EXISTS public.mcp_connection_workspaces (
  connection_id UUID NOT NULL REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_connection_workspaces_workspace
  ON public.mcp_connection_workspaces(workspace_id, connection_id);

CREATE TABLE IF NOT EXISTS public.mcp_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES public.mcp_connections(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  tool_name TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_connection_created
  ON public.mcp_audit_logs(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_workspace_created
  ON public.mcp_audit_logs(workspace_id, created_at DESC);

ALTER TABLE public.mcp_authorization_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_connection_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_connection_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own MCP authorization sessions" ON public.mcp_authorization_sessions;
CREATE POLICY "Users can manage own MCP authorization sessions"
  ON public.mcp_authorization_sessions FOR ALL
  USING (approved_by = auth.uid()) WITH CHECK (approved_by = auth.uid());

DROP POLICY IF EXISTS "Users can manage own MCP connections" ON public.mcp_connections;
CREATE POLICY "Users can manage own MCP connections"
  ON public.mcp_connections FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read own MCP connection scopes" ON public.mcp_connection_scopes;
CREATE POLICY "Users can read own MCP connection scopes"
  ON public.mcp_connection_scopes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.mcp_connections c WHERE c.id = connection_id AND c.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can read own MCP connection workspaces" ON public.mcp_connection_workspaces;
CREATE POLICY "Users can read own MCP connection workspaces"
  ON public.mcp_connection_workspaces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.mcp_connections c WHERE c.id = connection_id AND c.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can read own MCP audit logs" ON public.mcp_audit_logs;
CREATE POLICY "Users can read own MCP audit logs"
  ON public.mcp_audit_logs FOR SELECT
  USING (user_id = auth.uid());
