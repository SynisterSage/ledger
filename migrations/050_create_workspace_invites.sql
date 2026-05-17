-- Migration: 050_create_workspace_invites
-- Description: Manual workspace invite links for local development.

CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  token TEXT UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (TIMEZONE('utc'::text, NOW()) + INTERVAL '7 days'),
  accepted_at TIMESTAMP WITH TIME ZONE,
  accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id
  ON public.workspace_invites(workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_token
  ON public.workspace_invites(token);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_expires_at
  ON public.workspace_invites(expires_at);

ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can read workspace invites" ON public.workspace_invites;
CREATE POLICY "Managers can read workspace invites"
  ON public.workspace_invites
  FOR SELECT
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_invites.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Managers can create workspace invites" ON public.workspace_invites;
CREATE POLICY "Managers can create workspace invites"
  ON public.workspace_invites
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.is_workspace_owner(workspace_id, auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = workspace_invites.workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role = 'admin'
      )
    )
  );

DROP POLICY IF EXISTS "Managers can update workspace invites" ON public.workspace_invites;
CREATE POLICY "Managers can update workspace invites"
  ON public.workspace_invites
  FOR UPDATE
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_invites.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = 'admin'
    )
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_invites.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = 'admin'
    )
  );
