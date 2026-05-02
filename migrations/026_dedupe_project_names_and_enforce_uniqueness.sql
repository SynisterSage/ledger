-- Migration: 026_dedupe_project_names_and_enforce_uniqueness
-- Description: Deduplicate projects by normalized name within a workspace and prevent future duplicates

WITH ranked_projects AS (
  SELECT
    id,
    workspace_id,
    lower(btrim(name)) AS normalized_name,
    created_at,
    first_value(id) OVER (
      PARTITION BY workspace_id, lower(btrim(name))
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id,
    row_number() OVER (
      PARTITION BY workspace_id, lower(btrim(name))
      ORDER BY created_at ASC, id ASC
    ) AS row_num
  FROM public.projects
),
duplicate_projects AS (
  SELECT id AS duplicate_id, canonical_id
  FROM ranked_projects
  WHERE row_num > 1
),
repoint_tasks AS (
  UPDATE public.tasks t
  SET project_id = d.canonical_id
  FROM duplicate_projects d
  WHERE t.project_id = d.duplicate_id
  RETURNING t.id
),
repoint_events AS (
  UPDATE public.events e
  SET linked_project_id = d.canonical_id
  FROM duplicate_projects d
  WHERE e.linked_project_id = d.duplicate_id
  RETURNING e.id
),
repoint_time_entries AS (
  UPDATE public.time_entries te
  SET project_id = d.canonical_id
  FROM duplicate_projects d
  WHERE te.project_id = d.duplicate_id
  RETURNING te.id
)
DELETE FROM public.projects p
USING duplicate_projects d
WHERE p.id = d.duplicate_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_workspace_name_unique
  ON public.projects (workspace_id, lower(btrim(name)));
