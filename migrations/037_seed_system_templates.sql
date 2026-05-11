-- Seed system templates for all workspaces
-- These templates are read-only and cannot be deleted
-- System templates have NULL created_by since they're not created by users

INSERT INTO note_templates (
  workspace_id,
  name,
  description,
  content_html,
  category,
  is_default,
  is_system,
  usage_count,
  created_by
)
SELECT
  w.id,
  'Meeting Notes',
  'Capture meeting details, attendees, and action items',
  '<h2>Meeting Notes</h2><p><strong>Date:</strong> [Date]</p><p><strong>Attendees:</strong></p><ul><li>[Name]</li></ul><p><strong>Agenda:</strong></p><ul><li>[Topic]</li></ul><p><strong>Discussion:</strong></p><p>[Notes]</p><p><strong>Action Items:</strong></p><ul><li>[Action] - Owner: [Name]</li></ul>',
  'meeting',
  true,
  true,
  0,
  NULL::uuid
FROM workspaces w

UNION ALL

SELECT
  w.id,
  'Project Brief',
  'Define project scope, goals, and timeline',
  '<h2>Project Brief</h2><p><strong>Project Name:</strong> [Name]</p><p><strong>Owner:</strong> [Name]</p><p><strong>Due Date:</strong> [Date]</p><p><strong>Objective:</strong></p><p>[Goal or purpose]</p><p><strong>Success Criteria:</strong></p><ul><li>[Criteria]</li></ul><p><strong>Timeline:</strong></p><p>[Major milestones]</p><p><strong>Blockers:</strong></p><p>[Known risks or obstacles]</p>',
  'project',
  true,
  true,
  0,
  NULL::uuid
FROM workspaces w

UNION ALL

SELECT
  w.id,
  'Daily Reflection',
  'Reflect on your day and plan tomorrow',
  '<h2>Daily Reflection</h2><p><strong>Date:</strong> [Date]</p><p><strong>Wins:</strong></p><p>[What went well today?]</p><p><strong>Lessons Learned:</strong></p><p>[What did I learn?]</p><p><strong>Blockers:</strong></p><p>[What slowed me down?]</p><p><strong>Tomorrow''s Focus:</strong></p><ul><li>[Top 1-3 priorities]</li></ul><p><strong>Mood:</strong> [Energized / Neutral / Drained]</p>',
  'personal',
  true,
  true,
  0,
  NULL::uuid
FROM workspaces w

UNION ALL

SELECT
  w.id,
  'Book Notes',
  'Capture key takeaways and reflections from books',
  '<h2>Book Notes</h2><p><strong>Title:</strong> [Book Title]</p><p><strong>Author:</strong> [Author Name]</p><p><strong>Date Read:</strong> [Date]</p><p><strong>Summary:</strong></p><p>[Main premise in 2-3 sentences]</p><p><strong>Key Takeaways:</strong></p><ul><li>[Important concept or lesson]</li></ul><p><strong>Memorable Quotes:</strong></p><blockquote><p>"[Quote]" - Page [#]</p></blockquote><p><strong>Reflection:</strong></p><p>[How will I apply this?]</p><p><strong>Rating:</strong> ★★★★☆</p>',
  'reading',
  false,
  true,
  0,
  NULL::uuid
FROM workspaces w;
