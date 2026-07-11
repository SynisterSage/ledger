-- Migration: 081_create_person_preferences
-- Description: Store private per-viewer Circle preferences such as pinning people inside a workspace.

CREATE TABLE IF NOT EXISTS public.person_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  person_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(workspace_id, user_id, person_user_id)
);

CREATE INDEX IF NOT EXISTS idx_person_preferences_workspace_user
  ON public.person_preferences(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_person_preferences_person_user
  ON public.person_preferences(person_user_id);

CREATE INDEX IF NOT EXISTS idx_person_preferences_pinned
  ON public.person_preferences(workspace_id, user_id, is_pinned, sort_order);

ALTER TABLE public.person_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own person preferences" ON public.person_preferences;
CREATE POLICY "Users can read own person preferences"
  ON public.person_preferences
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can manage own person preferences" ON public.person_preferences;
CREATE POLICY "Users can manage own person preferences"
  ON public.person_preferences
  FOR ALL
  USING (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_workspace_member(workspace_id, auth.uid())
  );
