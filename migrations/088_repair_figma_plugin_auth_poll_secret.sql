-- Repair installations where the plugin authorization table existed before
-- poll-secret hashing was added to the Figma plugin auth flow.
ALTER TABLE public.figma_plugin_authorization_sessions
  ADD COLUMN IF NOT EXISTS poll_secret_hash TEXT;

-- Ask PostgREST to invalidate its cached table definition after the migration.
NOTIFY pgrst, 'reload schema';
