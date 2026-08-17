-- Persist lightweight, user-owned Ask Ledger conversations.

CREATE TABLE IF NOT EXISTS public.ask_ledger_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Ask Ledger',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ask_ledger_sessions
  ADD COLUMN IF NOT EXISTS initial_context JSONB;

CREATE INDEX IF NOT EXISTS idx_ask_ledger_sessions_user_workspace_updated
  ON public.ask_ledger_sessions(user_id, workspace_id, updated_at DESC);

ALTER TABLE public.ask_ledger_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own Ask Ledger sessions" ON public.ask_ledger_sessions;
CREATE POLICY "Users can read own Ask Ledger sessions"
  ON public.ask_ledger_sessions
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = ask_ledger_sessions.workspace_id
      AND (
        w.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_members wm
          WHERE wm.workspace_id = w.id AND wm.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can create own Ask Ledger sessions" ON public.ask_ledger_sessions;
CREATE POLICY "Users can create own Ask Ledger sessions"
  ON public.ask_ledger_sessions
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = ask_ledger_sessions.workspace_id
      AND (
        w.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_members wm
          WHERE wm.workspace_id = w.id AND wm.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can update own Ask Ledger sessions" ON public.ask_ledger_sessions;
CREATE POLICY "Users can update own Ask Ledger sessions"
  ON public.ask_ledger_sessions
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = ask_ledger_sessions.workspace_id
      AND (
        w.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_members wm
          WHERE wm.workspace_id = w.id AND wm.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete own Ask Ledger sessions" ON public.ask_ledger_sessions;
CREATE POLICY "Users can delete own Ask Ledger sessions"
  ON public.ask_ledger_sessions
  FOR DELETE
  USING (user_id = auth.uid());
