-- Migration: 035_create_note_templates
-- Description: Create note_templates table for template system

CREATE TABLE IF NOT EXISTS public.note_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  content_html TEXT NOT NULL,
  category TEXT DEFAULT 'personal',
  is_default BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT false,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_note_templates_workspace_id ON public.note_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_note_templates_workspace_is_default ON public.note_templates(workspace_id, is_default);
CREATE INDEX IF NOT EXISTS idx_note_templates_category ON public.note_templates(workspace_id, category);
CREATE INDEX IF NOT EXISTS idx_note_templates_is_system ON public.note_templates(is_system);
CREATE INDEX IF NOT EXISTS idx_note_templates_usage_count ON public.note_templates(workspace_id, usage_count DESC);

-- RLS policies
ALTER TABLE public.note_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view templates in their workspace"
  ON public.note_templates
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_members.workspace_id = note_templates.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
    OR is_system = true
  );

CREATE POLICY "Users can create templates in their workspace"
  ON public.note_templates
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_members.workspace_id = note_templates.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own templates"
  ON public.note_templates
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can delete their own templates"
  ON public.note_templates
  FOR DELETE
  USING (created_by = auth.uid() AND is_system = false);

-- Trigger to update updated_at (inline implementation)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_note_templates_updated_at
  BEFORE UPDATE ON public.note_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
