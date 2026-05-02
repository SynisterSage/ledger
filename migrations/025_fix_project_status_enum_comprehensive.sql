-- Migration: 025_fix_project_status_enum_comprehensive
-- Description: Ensure project_status enum exists with correct values

-- Step 1: Change column to TEXT to safely handle enum issues
ALTER TABLE public.projects ALTER COLUMN status TYPE TEXT;

-- Step 2: Drop the enum type if it exists
DROP TYPE IF EXISTS project_status CASCADE;

-- Step 3: Create new enum type with all required values in correct order
CREATE TYPE project_status AS ENUM ('NotStarted', 'InProgress', 'Paused', 'Completed');

-- Step 4: Normalize existing status values to match enum case
UPDATE public.projects SET status = 
  CASE 
    WHEN LOWER(status) = 'notstarter' OR LOWER(status) = 'not_started' OR LOWER(status) = 'active' THEN 'NotStarted'
    WHEN LOWER(status) = 'inprogress' OR LOWER(status) = 'in_progress' THEN 'InProgress'
    WHEN LOWER(status) = 'paused' OR LOWER(status) = 'archived' THEN 'Paused'
    WHEN LOWER(status) = 'completed' OR LOWER(status) = 'done' THEN 'Completed'
    ELSE 'NotStarted'
  END
WHERE status IS NOT NULL;

-- Step 5: Set any NULL values to default
UPDATE public.projects SET status = 'NotStarted' WHERE status IS NULL OR status = '';

-- Step 6: Convert status column back to enum type
ALTER TABLE public.projects ALTER COLUMN status TYPE project_status USING status::project_status;

-- Step 7: Set default value
ALTER TABLE public.projects ALTER COLUMN status SET DEFAULT 'NotStarted';

-- Step 8: Create index on status for performance
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);
