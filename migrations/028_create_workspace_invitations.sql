-- Migration: 028_create_workspace_invitations
-- Description: Add workspace invitation workflow for membership management.

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invited_email VARCHAR(255) NOT NULL,
  role workspace_role NOT NULL DEFAULT 'member',
  invited_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (TIMEZONE('utc'::text, NOW()) + INTERVAL '7 days'),
  accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_workspace_email_pending
  ON public.workspace_invitations(workspace_id, invited_email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_status
  ON public.workspace_invitations(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_expires_at
  ON public.workspace_invitations(expires_at);

ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read workspace invitations" ON public.workspace_invitations;
CREATE POLICY "Users can read workspace invitations"
  ON public.workspace_invitations
  FOR SELECT
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Managers can manage workspace invitations" ON public.workspace_invitations;
CREATE POLICY "Managers can manage workspace invitations"
  ON public.workspace_invitations
  FOR ALL
  USING (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_invitations.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = 'admin'
    )
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_invitations.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = 'admin'
    )
  );
