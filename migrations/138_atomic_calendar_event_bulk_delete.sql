-- Migration: 138_atomic_calendar_event_bulk_delete
-- Description: Delete reviewed calendar events and preserve linked meeting metadata atomically.

CREATE OR REPLACE FUNCTION public.bulk_delete_calendar_events(
  p_workspace_id UUID,
  p_event_ids UUID[]
)
RETURNS TABLE(id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(array_length(p_event_ids, 1), 0) = 0
     OR (
       SELECT COUNT(*)
       FROM public.events
       WHERE workspace_id = p_workspace_id
         AND id = ANY(p_event_ids)
     ) <> array_length(p_event_ids, 1) THEN
    RAISE EXCEPTION 'Calendar event set changed before deletion';
  END IF;

  UPDATE public.note_smart_links
  SET linked_event_id = NULL,
      updated_at = NOW()
  WHERE workspace_id = p_workspace_id
    AND linked_event_id = ANY(p_event_ids);

  UPDATE public.meeting_note_metadata
  SET calendar_event_deleted = TRUE,
      updated_at = NOW()
  WHERE workspace_id = p_workspace_id
    AND calendar_event_id = ANY(p_event_ids);

  RETURN QUERY
  DELETE FROM public.events
  WHERE workspace_id = p_workspace_id
    AND id = ANY(p_event_ids)
  RETURNING public.events.id;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_delete_calendar_events(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_delete_calendar_events(UUID, UUID[]) TO service_role;
