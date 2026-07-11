-- Migration: 080_normalize_inbox_items_schema
-- Description: Extend inbox_items with Intake lifecycle metadata and safe history fields.

ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_provider TEXT,
  ADD COLUMN IF NOT EXISTS suggested_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_assignee_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_calendar_id UUID REFERENCES public.calendars(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_note_section_id UUID REFERENCES public.note_sections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_date DATE,
  ADD COLUMN IF NOT EXISTS suggested_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS converted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.inbox_items i
SET updated_by = COALESCE(i.updated_by, i.user_id, w.owner_id)
FROM public.workspaces w
WHERE i.workspace_id = w.id
  AND i.updated_by IS NULL;

UPDATE public.inbox_items i
SET source_provider = COALESCE(i.source_provider, CASE WHEN i.source IN ('slack', 'browser') THEN i.source ELSE NULL END)
WHERE i.source_provider IS NULL;

UPDATE public.inbox_items i
SET converted_at = COALESCE(i.converted_at, i.updated_at),
    converted_by = COALESCE(i.converted_by, i.user_id, w.owner_id)
FROM public.workspaces w
WHERE i.workspace_id = w.id
  AND i.status = 'converted';

UPDATE public.inbox_items i
SET archived_at = COALESCE(i.archived_at, i.updated_at),
    archived_by = COALESCE(i.archived_by, i.user_id, w.owner_id)
FROM public.workspaces w
WHERE i.workspace_id = w.id
  AND i.status = 'archived';

UPDATE public.inbox_items
SET suggested_project_id = COALESCE(
      suggested_project_id,
      CASE
        WHEN raw_payload ? 'suggested_project_id'
         AND COALESCE(raw_payload->>'suggested_project_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN (raw_payload->>'suggested_project_id')::uuid
        ELSE NULL
      END
    ),
    suggested_assignee_id = COALESCE(
      suggested_assignee_id,
      CASE
        WHEN raw_payload ? 'suggested_assignee_id'
         AND COALESCE(raw_payload->>'suggested_assignee_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN (raw_payload->>'suggested_assignee_id')::uuid
        ELSE NULL
      END
    ),
    suggested_calendar_id = COALESCE(
      suggested_calendar_id,
      CASE
        WHEN raw_payload ? 'suggested_calendar_id'
         AND COALESCE(raw_payload->>'suggested_calendar_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN (raw_payload->>'suggested_calendar_id')::uuid
        ELSE NULL
      END
    ),
    suggested_note_section_id = COALESCE(
      suggested_note_section_id,
      CASE
        WHEN raw_payload ? 'suggested_note_section_id'
         AND COALESCE(raw_payload->>'suggested_note_section_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN (raw_payload->>'suggested_note_section_id')::uuid
        ELSE NULL
      END
    ),
    suggested_date = COALESCE(
      suggested_date,
      CASE
        WHEN raw_payload ? 'suggested_date'
         AND COALESCE(raw_payload->>'suggested_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN (raw_payload->>'suggested_date')::date
        WHEN raw_payload ? 'suggested_due_date'
         AND COALESCE(raw_payload->>'suggested_due_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN (raw_payload->>'suggested_due_date')::date
        ELSE NULL
      END
    ),
    suggested_due_at = COALESCE(
      suggested_due_at,
      CASE
        WHEN raw_payload ? 'suggested_due_at'
         AND NULLIF(raw_payload->>'suggested_due_at', '') IS NOT NULL
        THEN (raw_payload->>'suggested_due_at')::timestamptz
        ELSE NULL
      END
    )
WHERE suggested_project_id IS NULL
   OR suggested_assignee_id IS NULL
   OR suggested_calendar_id IS NULL
   OR suggested_note_section_id IS NULL
   OR suggested_date IS NULL
   OR suggested_due_at IS NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.inbox_items
      ADD CONSTRAINT inbox_items_source_url_http_check
      CHECK (
        source_url IS NULL
        OR source_url ~* '^https?://'
      );
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TABLE public.inbox_items
      ADD CONSTRAINT inbox_items_snoozed_requires_timestamp_check
      CHECK (status <> 'snoozed' OR snoozed_until IS NOT NULL);
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TABLE public.inbox_items
      ADD CONSTRAINT inbox_items_converted_requires_history_check
      CHECK (
        status <> 'converted'
        OR (
          converted_type IS NOT NULL
          AND converted_id IS NOT NULL
          AND converted_at IS NOT NULL
          AND converted_by IS NOT NULL
        )
      );
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TABLE public.inbox_items
      ADD CONSTRAINT inbox_items_archived_requires_history_check
      CHECK (
        status <> 'archived'
        OR (
          archived_at IS NOT NULL
          AND archived_by IS NOT NULL
        )
      );
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace_created_at
  ON public.inbox_items(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace_source_provider
  ON public.inbox_items(workspace_id, source, source_provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_items_converted_id
  ON public.inbox_items(converted_id)
  WHERE converted_id IS NOT NULL;
