CREATE TABLE IF NOT EXISTS public.figma_plugin_authorization_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  plugin_session_hash TEXT NOT NULL,
  poll_secret_hash TEXT,
  verification_code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  credential_encrypted TEXT,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['workspace:read', 'figma-context:read']::TEXT[],
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  approved_at TIMESTAMP WITH TIME ZONE,
  credential_returned_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT figma_plugin_auth_status_check CHECK (status IN ('pending', 'approved', 'cancelled', 'expired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_figma_plugin_auth_plugin_session ON public.figma_plugin_authorization_sessions(plugin_session_hash);
CREATE INDEX IF NOT EXISTS idx_figma_plugin_auth_expiry ON public.figma_plugin_authorization_sessions(status, expires_at);

CREATE TABLE IF NOT EXISTS public.figma_plugin_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['workspace:read', 'figma-context:read']::TEXT[],
  issued_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_figma_plugin_credentials_user ON public.figma_plugin_credentials(user_id, revoked_at, expires_at);

ALTER TABLE public.figma_plugin_authorization_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.figma_plugin_credentials ENABLE ROW LEVEL SECURITY;
