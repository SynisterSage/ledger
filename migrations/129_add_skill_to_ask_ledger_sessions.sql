ALTER TABLE public.ask_ledger_sessions
  ADD COLUMN IF NOT EXISTS skill_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ask_ledger_sessions_skill_id
  ON public.ask_ledger_sessions(skill_id)
  WHERE skill_id IS NOT NULL;
