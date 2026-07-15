-- Template metadata and per-user curation. System templates remain workspace-provisioned
-- for compatibility with the existing workspace-scoped model.
ALTER TABLE public.note_templates
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'workspace'
    CHECK (visibility IN ('mine', 'workspace')),
  ADD COLUMN IF NOT EXISTS icon TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS suggested_section_id UUID REFERENCES public.note_sections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title_pattern TEXT,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE;

UPDATE public.note_templates
SET visibility = CASE WHEN is_system THEN 'workspace' ELSE 'mine' END
WHERE visibility IS NULL OR visibility = 'workspace' AND NOT is_system;

CREATE INDEX IF NOT EXISTS idx_note_templates_workspace_visibility
  ON public.note_templates(workspace_id, visibility);
CREATE INDEX IF NOT EXISTS idx_note_templates_last_used
  ON public.note_templates(workspace_id, last_used_at DESC);

CREATE TABLE IF NOT EXISTS public.note_template_preferences (
  template_id UUID NOT NULL REFERENCES public.note_templates(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (template_id, user_id)
);

ALTER TABLE public.note_template_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own template preferences" ON public.note_template_preferences;
CREATE POLICY "Users can manage own template preferences"
  ON public.note_template_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_note_template_preferences_user_pinned
  ON public.note_template_preferences(user_id, pinned);

-- Add new and revised Ledger presets to existing workspaces without touching custom work.
INSERT INTO public.note_templates (workspace_id, name, description, content_html, category, is_default, is_system, visibility)
SELECT w.id, p.name, p.description, p.content_html, p.category, false, true, 'workspace'
FROM public.workspaces w
CROSS JOIN (VALUES
  ('Weekly Internship Workspace', 'A reusable weekly home base for internship work and follow-through.', '<h1>Week of</h1><h2>Goals for the week</h2><h2>Daily overview</h2><h3>Monday</h3><h3>Tuesday</h3><h3>Wednesday</h3><h3>Thursday</h3><h3>Friday</h3><h2>Short-term tasks</h2><ul><li>[ ] Task</li></ul><h2>Long-term tasks</h2><ul><li>[ ] Task</li></ul><h2>Meetings this week</h2><h2>Communication and follow-ups</h2><h2>Feedback received</h2><h2>Skills practiced</h2><h2>Work completed</h2><h2>Questions for supervisor</h2><h2>Next week</h2>', 'internship'),
  ('Team Meeting Notes', 'Capture discussion, decisions, ownership, and the update to send afterward.', '<h1>Team Meeting</h1><p><strong>Date:</strong><br><strong>Meeting lead:</strong><br><strong>Location or call:</strong></p><h2>Attendance</h2><p>Present:<br>Absent:</p><h2>Agenda</h2><h2>Main room notes</h2><h2>Breakout room notes</h2><h2>Announcements</h2><h2>Decisions made</h2><h2>Short-term tasks</h2><ul><li>[ ] Task<br>Owner:<br>Due:</li></ul><h2>Long-term tasks</h2><ul><li>[ ] Task<br>Owner:<br>Target:</li></ul><h2>Questions and blockers</h2><h2>Team overview message</h2><h2>Next meeting</h2><p>Date:<br>Topics to revisit:<br>Preparation needed:</p>', 'team'),
  ('Breakout Room Notes', 'Keep focused small-group discussion and the main-room update together.', '<h1>Breakout Room Notes</h1><p><strong>Topic:</strong><br><strong>People present:</strong><br><strong>Facilitator:</strong></p><h2>Goal</h2><h2>Discussion</h2><h2>Decisions</h2><h2>Assigned tasks</h2><ul><li>[ ] Task<br>Owner:<br>Due:</li></ul><h2>Questions to bring back</h2><h2>Main-room update</h2><h2>Follow-ups</h2>', 'team'),
  ('Formal Meeting Minutes', 'Concise, professional minutes ready to distribute after a meeting.', '<h1>Meeting Minutes</h1><p><strong>Meeting:</strong><br><strong>Date:</strong><br><strong>Time:</strong><br><strong>Location:</strong><br><strong>Facilitator:</strong><br><strong>Minutes prepared by:</strong></p><h2>Attendees</h2><h2>Absent</h2><h2>Agenda</h2><h2>Discussion by topic</h2><h3>Topic 1</h3><p>Summary:<br>Decision:</p><h3>Topic 2</h3><p>Summary:<br>Decision:</p><h2>Action items</h2><ul><li>[ ] Action<br>Owner:<br>Deadline:</li></ul><h2>Motions or formal decisions</h2><h2>Items carried forward</h2><h2>Next meeting</h2><p>Date:<br>Time:<br>Location:</p><h2>Distribution</h2>', 'meeting'),
  ('Team Lead Weekly Overview', 'A lightweight weekly view for priorities, support, blockers, and communication.', '<h1>Team Lead Weekly Overview</h1><h2>Team priorities</h2><h2>Short-term work</h2><ul><li>[ ] Task<br>Owner:<br>Due:</li></ul><h2>Long-term work</h2><ul><li>[ ] Task<br>Owner:<br>Target:</li></ul><h2>Assignments by person</h2><h3>Team member</h3><p>Current work:<br>Support needed:<br>Next step:</p><h2>Blockers</h2><h2>People needing support</h2><h2>Upcoming deadlines</h2><h2>Meeting agenda</h2><h2>Communication to send</h2><h2>Wins</h2><h2>Risks</h2><h2>Next week</h2>', 'team')
) AS p(name, description, content_html, category)
WHERE NOT EXISTS (
  SELECT 1 FROM public.note_templates t
  WHERE t.workspace_id = w.id AND t.name = p.name AND t.is_system = true
);
