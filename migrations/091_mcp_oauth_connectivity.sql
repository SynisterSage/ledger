-- MCP Phase 2.5: OAuth discovery, dynamic clients, authorization codes, and tokens.

CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT,
  client_name TEXT NOT NULL,
  redirect_uris JSONB NOT NULL DEFAULT '[]'::JSONB,
  grant_types TEXT[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token']::TEXT[],
  response_types TEXT[] NOT NULL DEFAULT ARRAY['code']::TEXT[],
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_clients_active
  ON public.mcp_oauth_clients(disabled_at, created_at DESC);

ALTER TABLE public.mcp_connections
  ADD COLUMN IF NOT EXISTS oauth_client_id UUID REFERENCES public.mcp_oauth_clients(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.mcp_oauth_authorization_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.mcp_oauth_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  response_type TEXT NOT NULL,
  requested_scopes TEXT[] NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  resource TEXT NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_requests_expiry
  ON public.mcp_oauth_authorization_requests(status, expires_at);

CREATE TABLE IF NOT EXISTS public.mcp_oauth_authorization_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.mcp_oauth_clients(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES public.mcp_oauth_authorization_requests(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  redirect_uri TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL,
  resource TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_codes_expiry
  ON public.mcp_oauth_authorization_codes(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS public.mcp_oauth_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  connection_id UUID NOT NULL REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.mcp_oauth_clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL,
  resource TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_access_tokens_active
  ON public.mcp_oauth_access_tokens(expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS public.mcp_oauth_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  connection_id UUID NOT NULL REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.mcp_oauth_clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL,
  resource TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_refresh_family
  ON public.mcp_oauth_refresh_tokens(family_id, created_at DESC);

ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_authorization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;

-- These records are backend-managed. No client-side policy grants access to secrets.
