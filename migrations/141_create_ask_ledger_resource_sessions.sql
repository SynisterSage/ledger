-- Keep the active Ask Ledger conversation for a workspace resource addressable
-- without scanning the user's recent conversation history.

CREATE TABLE IF NOT EXISTS public.ask_ledger_resource_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  session_id UUID NOT NULL REFERENCES public.ask_ledger_sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_ask_ledger_resource_sessions_session
  ON public.ask_ledger_resource_sessions(session_id);

ALTER TABLE public.ask_ledger_resource_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own Ask Ledger resource sessions"
  ON public.ask_ledger_resource_sessions;
CREATE POLICY "Users can read own Ask Ledger resource sessions"
  ON public.ask_ledger_resource_sessions
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = ask_ledger_resource_sessions.workspace_id
      AND (
        w.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_members wm
          WHERE wm.workspace_id = w.id AND wm.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can manage own Ask Ledger resource sessions"
  ON public.ask_ledger_resource_sessions;
CREATE POLICY "Users can manage own Ask Ledger resource sessions"
  ON public.ask_ledger_resource_sessions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = ask_ledger_resource_sessions.workspace_id
      AND (
        w.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_members wm
          WHERE wm.workspace_id = w.id AND wm.user_id = auth.uid()
        )
      )
    )
  );
