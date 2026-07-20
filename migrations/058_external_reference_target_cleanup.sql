CREATE OR REPLACE FUNCTION public.cleanup_external_reference_target_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.external_reference_links
  WHERE workspace_id = OLD.workspace_id
    AND target_id = OLD.id
    AND target_type = TG_ARGV[0];
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cleanup_task_external_reference_links ON public.tasks;
CREATE TRIGGER cleanup_task_external_reference_links AFTER DELETE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.cleanup_external_reference_target_links('task');
DROP TRIGGER IF EXISTS cleanup_project_external_reference_links ON public.projects;
CREATE TRIGGER cleanup_project_external_reference_links AFTER DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.cleanup_external_reference_target_links('project');
DROP TRIGGER IF EXISTS cleanup_note_external_reference_links ON public.notes;
CREATE TRIGGER cleanup_note_external_reference_links AFTER DELETE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.cleanup_external_reference_target_links('note');
DROP TRIGGER IF EXISTS cleanup_intake_external_reference_links ON public.inbox_items;
CREATE TRIGGER cleanup_intake_external_reference_links AFTER DELETE ON public.inbox_items FOR EACH ROW EXECUTE FUNCTION public.cleanup_external_reference_target_links('intake');
