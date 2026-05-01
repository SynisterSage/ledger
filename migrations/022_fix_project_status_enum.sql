-- Migration: 022_fix_project_status_enum
-- Description: Fix project_status enum to use correct status values

-- Drop the old enum type and recreate with correct values
-- First, we need to change the column type temporarily
ALTER TABLE public.projects ALTER COLUMN status TYPE VARCHAR(50);

-- Drop the old enum
DROP TYPE IF EXISTS project_status CASCADE;

-- Create new enum with correct values
CREATE TYPE project_status AS ENUM ('NotStarted', 'InProgress', 'Completed', 'Paused');

-- Convert the VARCHAR back to the new enum
ALTER TABLE public.projects ALTER COLUMN status TYPE project_status USING status::project_status;

-- Set default to 'NotStarted'
ALTER TABLE public.projects ALTER COLUMN status SET DEFAULT 'NotStarted';
