CREATE TABLE IF NOT EXISTS project_note_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (workspace_id, project_id, note_id)
);

CREATE INDEX IF NOT EXISTS idx_project_note_links_workspace_project
  ON project_note_links(workspace_id, project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_note_links_note
  ON project_note_links(note_id);
