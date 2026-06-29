-- Migration: 068_create_project_milestones
-- Description: Add workspace-aware milestones for project timeline markers.

CREATE TABLE IF NOT EXISTS public.project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  milestone_date DATE NOT NULL,
  type TEXT NOT NULL DEFAULT 'Custom',
  note TEXT,
  completed BOOLEAN NOT NULL DEFAULT false,
  linked_note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  linked_reminder_id UUID REFERENCES public.reminders(id) ON DELETE SET NULL,
  linked_event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_milestones_type_check CHECK (
    type IN ('Deadline', 'Review', 'Decision', 'Handoff', 'Event', 'Custom')
  )
);

CREATE INDEX IF NOT EXISTS idx_project_milestones_workspace_date
  ON public.project_milestones(workspace_id, milestone_date);

CREATE INDEX IF NOT EXISTS idx_project_milestones_project_date
  ON public.project_milestones(project_id, milestone_date);

ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read workspace project milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "Users can create workspace project milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "Users can update workspace project milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "Users can delete workspace project milestones" ON public.project_milestones;

CREATE POLICY "Users can read workspace project milestones"
  ON public.project_milestones
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create workspace project milestones"
  ON public.project_milestones
  FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
  );

CREATE POLICY "Users can update workspace project milestones"
  ON public.project_milestones
  FOR UPDATE
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
  );

CREATE POLICY "Users can delete workspace project milestones"
  ON public.project_milestones
  FOR DELETE
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
  );
