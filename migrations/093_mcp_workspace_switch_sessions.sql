-- MCP workspace switching: browser-approved, one-time connection rebinding.
CREATE TABLE IF NOT EXISTS public.mcp_workspace_switch_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  current_workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_code_hash TEXT NOT NULL,
  poll_secret_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'expired')),
  approved_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_workspace_switch_expiry
  ON public.mcp_workspace_switch_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_workspace_switch_connection
  ON public.mcp_workspace_switch_sessions(connection_id, created_at DESC);

ALTER TABLE public.mcp_workspace_switch_sessions ENABLE ROW LEVEL SECURITY;
