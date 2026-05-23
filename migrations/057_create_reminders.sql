-- Migration: 057_create_reminders
-- Description: Upgrade reminders to the new workspace-aware personal reminder model.

CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  remind_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  linked_type TEXT,
  linked_id UUID,
  calendar_id UUID REFERENCES public.calendars(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  notes TEXT,
  color VARCHAR(7) NOT NULL DEFAULT '#F59E0B',
  is_done BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reminders_status_check CHECK (
    status IN ('active', 'completed', 'dismissed', 'overdue')
  ),
  CONSTRAINT reminders_linked_type_check CHECK (
    linked_type IS NULL OR linked_type IN ('task', 'event', 'note', 'project', 'inbox', 'none')
  ),
  CONSTRAINT reminders_linked_consistency_check CHECK (
    (linked_type IS NULL AND linked_id IS NULL)
    OR (linked_type = 'none' AND linked_id IS NULL)
    OR (linked_type IN ('task', 'event', 'note', 'project', 'inbox') AND linked_id IS NOT NULL)
  )
);

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS linked_type TEXT,
  ADD COLUMN IF NOT EXISTS linked_id UUID,
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS note_id UUID,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;

UPDATE public.reminders
SET
  user_id = COALESCE(user_id, created_by),
  body = COALESCE(body, notes),
  status = COALESCE(NULLIF(status, ''), CASE WHEN is_done THEN 'completed' ELSE 'active' END),
  linked_type = COALESCE(
    linked_type,
    CASE
      WHEN project_id IS NOT NULL THEN 'project'
      WHEN note_id IS NOT NULL THEN 'note'
      ELSE NULL
    END
  ),
  linked_id = COALESCE(
    linked_id,
    CASE
      WHEN project_id IS NOT NULL THEN project_id
      WHEN note_id IS NOT NULL THEN note_id
      ELSE NULL
    END
  ),
  completed_at = COALESCE(completed_at, CASE WHEN is_done THEN updated_at ELSE NULL END)
WHERE user_id IS NULL
   OR body IS NULL
   OR status IS NULL
   OR linked_type IS NULL
   OR linked_id IS NULL
   OR completed_at IS NULL;

ALTER TABLE public.reminders
  ALTER COLUMN title TYPE TEXT USING title::TEXT,
  ALTER COLUMN calendar_id DROP NOT NULL,
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.reminders
  DROP CONSTRAINT IF EXISTS reminders_status_check;
ALTER TABLE public.reminders
  DROP CONSTRAINT IF EXISTS reminders_linked_type_check;
ALTER TABLE public.reminders
  DROP CONSTRAINT IF EXISTS reminders_linked_consistency_check;

ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_status_check CHECK (
    status IN ('active', 'completed', 'dismissed', 'overdue')
  );

ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_linked_type_check CHECK (
    linked_type IS NULL OR linked_type IN ('task', 'event', 'note', 'project', 'inbox', 'none')
  );

ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_linked_consistency_check CHECK (
    (linked_type IS NULL AND linked_id IS NULL)
    OR (linked_type = 'none' AND linked_id IS NULL)
    OR (linked_type IN ('task', 'event', 'note', 'project', 'inbox') AND linked_id IS NOT NULL)
  );

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read workspace reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can create workspace reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can update workspace reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can delete workspace reminders" ON public.reminders;

CREATE POLICY "Users can read own reminders"
  ON public.reminders
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create own reminders"
  ON public.reminders
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
  );

CREATE POLICY "Users can update own reminders"
  ON public.reminders
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
  );

CREATE POLICY "Users can delete own reminders"
  ON public.reminders
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'member')
    )
  );

CREATE INDEX IF NOT EXISTS idx_reminders_user_status_remind_at
  ON public.reminders(user_id, status, remind_at);

CREATE INDEX IF NOT EXISTS idx_reminders_workspace_status_remind_at
  ON public.reminders(workspace_id, status, remind_at);

CREATE INDEX IF NOT EXISTS idx_reminders_linked
  ON public.reminders(linked_type, linked_id);

CREATE INDEX IF NOT EXISTS idx_reminders_due_active
  ON public.reminders(remind_at)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS update_reminders_updated_at ON public.reminders;
CREATE TRIGGER update_reminders_updated_at
  BEFORE UPDATE ON public.reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
