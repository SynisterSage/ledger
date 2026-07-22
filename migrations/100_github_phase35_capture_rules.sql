-- Migration: 100_github_phase35_capture_rules
-- Description: Workspace-scoped opt-in GitHub capture rules and durable capture records.

CREATE TABLE IF NOT EXISTS public.github_capture_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  repository_scope TEXT NOT NULL DEFAULT 'all_approved',
  repository_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  label_filters TEXT[] NOT NULL DEFAULT '{}'::text[],
  destination_type TEXT NOT NULL DEFAULT 'workspace_intake',
  destination_team_id UUID REFERENCES public.workspace_teams(id) ON DELETE SET NULL,
  create_notification BOOLEAN NOT NULL DEFAULT false,
  create_intake_item BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT github_capture_rules_scope_check CHECK (repository_scope IN ('all_approved', 'selected')),
  CONSTRAINT github_capture_rules_destination_check CHECK (destination_type IN ('workspace_intake', 'team_intake')),
  CONSTRAINT github_capture_rules_name_check CHECK (length(trim(name)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_capture_rules_dedupe
  ON public.github_capture_rules (workspace_id, event_type, name);
CREATE INDEX IF NOT EXISTS idx_github_capture_rules_workspace_enabled
  ON public.github_capture_rules (workspace_id, enabled, event_type);

CREATE TABLE IF NOT EXISTS public.github_capture_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.github_capture_rules(id) ON DELETE CASCADE,
  github_repository_id TEXT NOT NULL,
  github_object_type TEXT NOT NULL,
  github_object_id TEXT NOT NULL,
  github_event_action TEXT NOT NULL,
  external_reference_id UUID REFERENCES public.external_references(id) ON DELETE SET NULL,
  intake_item_id UUID REFERENCES public.inbox_items(id) ON DELETE SET NULL,
  notification_id UUID,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT github_capture_records_fingerprint_unique UNIQUE (workspace_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_github_capture_records_workspace_object
  ON public.github_capture_records (workspace_id, github_repository_id, github_object_type, github_object_id);
CREATE INDEX IF NOT EXISTS idx_github_capture_records_rule
  ON public.github_capture_records (rule_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.github_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  repository_available BOOLEAN NOT NULL DEFAULT true,
  issue_events BOOLEAN NOT NULL DEFAULT true,
  pull_request_events BOOLEAN NOT NULL DEFAULT true,
  review_requests BOOLEAN NOT NULL DEFAULT true,
  checks_failing BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT github_notification_preferences_unique UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_github_notification_preferences_workspace
  ON public.github_notification_preferences (workspace_id, user_id);

ALTER TABLE public.github_capture_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_capture_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read GitHub capture rules" ON public.github_capture_rules;
CREATE POLICY "Workspace members can read GitHub capture rules"
  ON public.github_capture_rules FOR SELECT
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS "Workspace admins can manage GitHub capture rules" ON public.github_capture_rules;
CREATE POLICY "Workspace admins can manage GitHub capture rules"
  ON public.github_capture_rules FOR ALL
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = github_capture_rules.workspace_id
      AND wm.user_id = auth.uid() AND wm.role = 'admin'
  ))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()) OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = github_capture_rules.workspace_id
      AND wm.user_id = auth.uid() AND wm.role = 'admin'
  ));

DROP POLICY IF EXISTS "Workspace members can read GitHub capture records" ON public.github_capture_records;
CREATE POLICY "Workspace members can read GitHub capture records"
  ON public.github_capture_records FOR SELECT
  USING (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Users can manage GitHub notification preferences" ON public.github_notification_preferences;
CREATE POLICY "Users can manage GitHub notification preferences"
  ON public.github_notification_preferences FOR ALL
  USING (user_id = auth.uid() AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid())))
  WITH CHECK (user_id = auth.uid() AND (public.is_workspace_owner(workspace_id, auth.uid()) OR public.is_workspace_member(workspace_id, auth.uid())));

DROP TRIGGER IF EXISTS update_github_capture_rules_updated_at ON public.github_capture_rules;
CREATE TRIGGER update_github_capture_rules_updated_at
  BEFORE UPDATE ON public.github_capture_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_github_capture_records_updated_at ON public.github_capture_records;
CREATE TRIGGER update_github_capture_records_updated_at
  BEFORE UPDATE ON public.github_capture_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_github_notification_preferences_updated_at ON public.github_notification_preferences;
CREATE TRIGGER update_github_notification_preferences_updated_at
  BEFORE UPDATE ON public.github_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
