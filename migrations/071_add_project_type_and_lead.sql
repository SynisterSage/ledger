-- Migration: 071_add_project_type_and_lead
-- Description: Add project type and optional working lead to projects

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'other',
ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.projects
SET project_type = COALESCE(NULLIF(project_type, ''), 'other')
WHERE project_type IS NULL OR project_type = '';

ALTER TABLE public.projects
ALTER COLUMN project_type SET DEFAULT 'other';

ALTER TABLE public.projects
ALTER COLUMN project_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_project_type ON public.projects(project_type);
CREATE INDEX IF NOT EXISTS idx_projects_lead_id ON public.projects(lead_id);
