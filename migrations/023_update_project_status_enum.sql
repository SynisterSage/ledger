-- Migration: 023_update_project_status_enum
-- Description: Update project_status enum to use NotStarted/InProgress/Paused/Completed

-- Step 1: Change column to TEXT temporarily to allow any values
ALTER TABLE public.projects ALTER COLUMN status TYPE TEXT;

-- Step 2: Drop the old enum type
DROP TYPE IF EXISTS project_status CASCADE;

-- Step 3: Create new enum with correct values
CREATE TYPE project_status AS ENUM ('NotStarted', 'InProgress', 'Paused', 'Completed');

-- Step 4: Convert TEXT back to the new enum
ALTER TABLE public.projects ALTER COLUMN status TYPE project_status USING status::project_status;

-- Step 5: Set new default
ALTER TABLE public.projects ALTER COLUMN status SET DEFAULT 'NotStarted';
