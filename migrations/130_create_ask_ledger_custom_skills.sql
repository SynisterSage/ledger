CREATE TABLE IF NOT EXISTS public.ask_ledger_custom_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ask_ledger_custom_skills_owner
  ON public.ask_ledger_custom_skills(workspace_id, user_id, updated_at DESC);

ALTER TABLE public.ask_ledger_custom_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own Ask Ledger custom skills" ON public.ask_ledger_custom_skills;
CREATE POLICY "Users can read own Ask Ledger custom skills"
  ON public.ask_ledger_custom_skills FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own Ask Ledger custom skills" ON public.ask_ledger_custom_skills;
CREATE POLICY "Users can create own Ask Ledger custom skills"
  ON public.ask_ledger_custom_skills FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own Ask Ledger custom skills" ON public.ask_ledger_custom_skills;
CREATE POLICY "Users can update own Ask Ledger custom skills"
  ON public.ask_ledger_custom_skills FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own Ask Ledger custom skills" ON public.ask_ledger_custom_skills;
CREATE POLICY "Users can delete own Ask Ledger custom skills"
  ON public.ask_ledger_custom_skills FOR DELETE
  USING (user_id = auth.uid());
