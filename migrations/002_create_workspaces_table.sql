-- Migration: 002_create_workspaces_table
-- Description: Create workspaces table for personal and team organization

CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_personal BOOLEAN DEFAULT true NOT NULL,
  color VARCHAR(7) DEFAULT '#007AFF',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read workspaces they own
-- (Members can read will be added in 003_create_workspace_members_table)
CREATE POLICY "Users can read own workspaces"
  ON public.workspaces
  FOR SELECT
  USING (owner_id = auth.uid());

-- RLS Policy: Only workspace owner can update
CREATE POLICY "Only owner can update workspace"
  ON public.workspaces
  FOR UPDATE
  USING (owner_id = auth.uid());

-- RLS Policy: Only workspace owner can delete
CREATE POLICY "Only owner can delete workspace"
  ON public.workspaces
  FOR DELETE
  USING (owner_id = auth.uid());

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON public.workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_is_personal ON public.workspaces(is_personal);
