-- Migration: 021_add_missing_project_columns
-- Description: Add missing completeness and created_by columns to projects table

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS completeness INTEGER DEFAULT 0 CHECK (completeness >= 0 AND completeness <= 100);

-- Create index on created_by for query optimization
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON public.projects(created_by);
