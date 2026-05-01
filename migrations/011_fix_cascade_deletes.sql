-- Migration: 011_fix_cascade_deletes
-- Description: Update foreign key constraints to use proper CASCADE delete behavior

-- Fix projects.category_id to CASCADE delete instead of SET NULL
-- When a category is deleted, all associated projects are deleted
ALTER TABLE public.projects
DROP CONSTRAINT projects_category_id_fkey,
ADD CONSTRAINT projects_category_id_fkey 
  FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;

-- Fix tasks.project_id to SET NULL instead of CASCADE
-- When a project is deleted, tasks become unassigned but are not deleted
ALTER TABLE public.tasks
DROP CONSTRAINT tasks_project_id_fkey,
ADD CONSTRAINT tasks_project_id_fkey 
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

-- Fix time_entries constraints to properly cascade/set null
-- When a task is deleted, time entries are preserved (reference removed)
ALTER TABLE public.time_entries
DROP CONSTRAINT time_entries_task_id_fkey,
ADD CONSTRAINT time_entries_task_id_fkey 
  FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;

-- When a project is deleted, time entries are preserved (reference removed)
ALTER TABLE public.time_entries
DROP CONSTRAINT time_entries_project_id_fkey,
ADD CONSTRAINT time_entries_project_id_fkey 
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

-- Ensure workspace_members properly cascade delete on user removal
ALTER TABLE public.workspace_members
DROP CONSTRAINT workspace_members_user_id_fkey,
ADD CONSTRAINT workspace_members_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
