-- Migration: 099_github_phase3_live_awareness
-- Description: Workspace-scoped GitHub attention signals for linked work.
-- Webhook delivery idempotency reuses integration_webhook_events from 087 with
-- provider = 'github' and provider_event_id = X-GitHub-Delivery.

CREATE TABLE IF NOT EXISTS public.github_attention_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  external_reference_id UUID NOT NULL,
  target_type TEXT,
  target_id UUID,
  attention_type TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT github_attention_signals_reference_workspace_fk
    FOREIGN KEY (external_reference_id, workspace_id)
    REFERENCES public.external_references(id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT github_attention_signals_status_check
    CHECK (status IN ('active', 'resolved')),
  CONSTRAINT github_attention_signals_fingerprint_unique UNIQUE (workspace_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_github_attention_signals_workspace_status
  ON public.github_attention_signals(workspace_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_github_attention_signals_target
  ON public.github_attention_signals(workspace_id, target_type, target_id, status);
CREATE INDEX IF NOT EXISTS idx_github_attention_signals_reference
  ON public.github_attention_signals(external_reference_id, status);

ALTER TABLE public.github_attention_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace members can read GitHub attention signals" ON public.github_attention_signals;
CREATE POLICY "Workspace members can read GitHub attention signals"
  ON public.github_attention_signals FOR SELECT
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace members can manage GitHub attention signals" ON public.github_attention_signals;
CREATE POLICY "Workspace members can manage GitHub attention signals"
  ON public.github_attention_signals FOR ALL
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = github_attention_signals.workspace_id
      AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')
  ))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = github_attention_signals.workspace_id
      AND wm.user_id = auth.uid() AND wm.role IN ('admin', 'member')
  ));

DROP TRIGGER IF EXISTS update_github_attention_signals_updated_at ON public.github_attention_signals;
CREATE TRIGGER update_github_attention_signals_updated_at
  BEFORE UPDATE ON public.github_attention_signals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
