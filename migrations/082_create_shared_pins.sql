-- Migration: 082_create_shared_pins
-- Description: Create a shared personal pin system for workspace-scoped shortcuts.

CREATE TABLE IF NOT EXISTS public.pin_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT pin_folders_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_pin_folders_workspace_user
  ON public.pin_folders(workspace_id, user_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pin_folders_workspace_user_name_unique
  ON public.pin_folders(workspace_id, user_id, lower(name));

ALTER TABLE public.pin_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own pin folders" ON public.pin_folders;
CREATE POLICY "Users can read own pin folders"
  ON public.pin_folders
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can create own pin folders" ON public.pin_folders;
CREATE POLICY "Users can create own pin folders"
  ON public.pin_folders
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can update own pin folders" ON public.pin_folders;
CREATE POLICY "Users can update own pin folders"
  ON public.pin_folders
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete own pin folders" ON public.pin_folders;
CREATE POLICY "Users can delete own pin folders"
  ON public.pin_folders
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  );

DROP TRIGGER IF EXISTS update_pin_folders_updated_at ON public.pin_folders;
CREATE TRIGGER update_pin_folders_updated_at
  BEFORE UPDATE ON public.pin_folders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.user_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id UUID NOT NULL,
  folder_id UUID REFERENCES public.pin_folders(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT user_pins_object_type_check CHECK (
    object_type IN (
      'person',
      'project',
      'note',
      'team',
      'task',
      'event',
      'reminder',
      'saved_view',
      'follow_up_view',
      'team_page'
    )
  ),
  CONSTRAINT user_pins_workspace_user_object_unique UNIQUE (workspace_id, user_id, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS idx_user_pins_workspace_user_sort
  ON public.user_pins(workspace_id, user_id, folder_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS idx_user_pins_workspace_object
  ON public.user_pins(workspace_id, object_type, object_id);

ALTER TABLE public.user_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own pins" ON public.user_pins;
CREATE POLICY "Users can read own pins"
  ON public.user_pins
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can create own pins" ON public.user_pins;
CREATE POLICY "Users can create own pins"
  ON public.user_pins
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can update own pins" ON public.user_pins;
CREATE POLICY "Users can update own pins"
  ON public.user_pins
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete own pins" ON public.user_pins;
CREATE POLICY "Users can delete own pins"
  ON public.user_pins
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  );

DROP TRIGGER IF EXISTS update_user_pins_updated_at ON public.user_pins;
CREATE TRIGGER update_user_pins_updated_at
  BEFORE UPDATE ON public.user_pins
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.user_pins (
  workspace_id,
  user_id,
  object_type,
  object_id,
  folder_id,
  sort_order,
  created_at,
  updated_at
)
SELECT
  pp.workspace_id,
  pp.user_id,
  'person'::text,
  pp.person_user_id,
  NULL::uuid,
  pp.sort_order,
  pp.created_at,
  pp.updated_at
FROM public.person_preferences pp
WHERE pp.is_pinned = true
ON CONFLICT (workspace_id, user_id, object_type, object_id) DO NOTHING;
