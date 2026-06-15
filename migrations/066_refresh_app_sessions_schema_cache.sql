-- Refresh the PostgREST schema cache after introducing app_sessions.
-- This is safe to run even if the table already exists.

NOTIFY pgrst, 'reload schema';
