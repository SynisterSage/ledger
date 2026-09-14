-- Shift a reviewed set of Ledger/ICS events together. The API validates the
-- workspace and source eligibility before calling this function.
CREATE OR REPLACE FUNCTION public.bulk_shift_calendar_events(
  p_workspace_id UUID,
  p_event_ids UUID[],
  p_shift_ms BIGINT
)
RETURNS TABLE (id UUID)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.events
  SET
    start_at = start_at + (p_shift_ms::double precision * INTERVAL '1 millisecond'),
    end_at = end_at + (p_shift_ms::double precision * INTERVAL '1 millisecond'),
    updated_at = NOW()
  WHERE workspace_id = p_workspace_id
    AND id = ANY(p_event_ids)
  RETURNING events.id;
$$;

REVOKE ALL ON FUNCTION public.bulk_shift_calendar_events(UUID, UUID[], BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_shift_calendar_events(UUID, UUID[], BIGINT) TO service_role;
