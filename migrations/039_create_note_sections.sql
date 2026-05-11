-- Create note_sections table for organizing notes by workspace
CREATE TABLE public.note_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'gray' CHECK (color IN ('blue', 'orange', 'purple', 'green', 'pink', 'gray')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX idx_note_sections_workspace_id ON public.note_sections(workspace_id);
CREATE INDEX idx_note_sections_workspace_sort ON public.note_sections(workspace_id, sort_order);
CREATE INDEX idx_note_sections_created_by ON public.note_sections(created_by);

-- Create trigger for updated_at
CREATE TRIGGER note_sections_updated_at
  BEFORE UPDATE ON public.note_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.note_sections ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view sections in their workspace
CREATE POLICY "Users can view sections in their workspace"
  ON public.note_sections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = note_sections.workspace_id
        AND user_id = auth.uid()
    )
  );

-- RLS Policy: Users can create sections in their workspace
CREATE POLICY "Users can create sections in their workspace"
  ON public.note_sections FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = note_sections.workspace_id
        AND user_id = auth.uid()
    )
  );

-- RLS Policy: Users can update sections they created or in their workspace
CREATE POLICY "Users can update sections in their workspace"
  ON public.note_sections FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = note_sections.workspace_id
        AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = note_sections.workspace_id
        AND user_id = auth.uid()
    )
  );

-- RLS Policy: Users can delete sections in their workspace
CREATE POLICY "Users can delete sections in their workspace"
  ON public.note_sections FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = note_sections.workspace_id
        AND user_id = auth.uid()
    )
  );
