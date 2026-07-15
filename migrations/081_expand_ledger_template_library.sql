-- Expand Ledger's built-in Notes library.
-- System templates are workspace-scoped today, so this migration provisions the
-- same keyed library into existing and future workspaces. Custom rows are never
-- matched because every update is constrained by is_system = true.

ALTER TABLE public.note_templates
  ADD COLUMN IF NOT EXISTS system_key TEXT;

-- Compatibility bridge for the four original presets. Future migrations use the
-- durable key, not the display name.
UPDATE public.note_templates
SET system_key = CASE name
  WHEN 'Meeting Notes' THEN 'meeting_notes'
  WHEN 'Project Brief' THEN 'project_brief'
  WHEN 'Daily Reflection' THEN 'daily_reflection'
  WHEN 'Book Notes' THEN 'book_notes'
  WHEN 'Weekly Internship Workspace' THEN 'weekly_internship_workspace'
  WHEN 'Team Meeting Notes' THEN 'team_meeting_notes'
  WHEN 'Breakout Room Notes' THEN 'breakout_room_notes'
  WHEN 'Formal Meeting Minutes' THEN 'formal_meeting_minutes'
  WHEN 'Team Lead Weekly Overview' THEN 'team_lead_weekly_overview'
END
WHERE is_system = true
  AND system_key IS NULL
  AND name IN (
    'Meeting Notes', 'Project Brief', 'Daily Reflection', 'Book Notes',
    'Weekly Internship Workspace', 'Team Meeting Notes', 'Breakout Room Notes',
    'Formal Meeting Minutes', 'Team Lead Weekly Overview'
  );

-- Keep one system row per legacy name before adding the keyed uniqueness guard.
DELETE FROM public.note_templates duplicate_row
USING public.note_templates keeper
WHERE duplicate_row.is_system = true
  AND keeper.is_system = true
  AND duplicate_row.workspace_id = keeper.workspace_id
  AND duplicate_row.name = keeper.name
  AND duplicate_row.id <> keeper.id
  AND (duplicate_row.created_at, duplicate_row.id) > (keeper.created_at, keeper.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_templates_workspace_system_key
  ON public.note_templates(workspace_id, system_key)
  WHERE is_system = true AND system_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ledger_template_presets()
RETURNS TABLE (
  system_key TEXT,
  name TEXT,
  category TEXT,
  description TEXT,
  title_pattern TEXT,
  content_html TEXT
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('meeting_notes', 'Meeting Notes', 'meeting', 'For recurring meetings that need clear discussion, decisions, ownership, and follow-through.', '{{date}} Meeting Notes', '<h1>Meeting Notes</h1><p><strong>Meeting:</strong><br><strong>Date and time:</strong><br><strong>Meeting lead:</strong><br><strong>Attendees:</strong><br><strong>Absent:</strong></p><h2>Purpose</h2><p>What should this meeting accomplish?</p><h2>Agenda</h2><ul><li>Topic and desired outcome</li><li>Topic and desired outcome</li></ul><h2>Main discussion</h2><h3>Topic 1</h3><p>Capture the important context, alternatives, and open questions.</p><h3>Topic 2</h3><p>Capture the important context, alternatives, and open questions.</p><h2>Decisions made</h2><ul><li><strong>Decision:</strong> Record what was decided and why.</li><li><strong>Decision:</strong> Record what was decided and why.</li></ul><h2>Short-term tasks</h2><p>Work expected today, this week, or before the next meeting.</p><ul><li>[ ] Task<br><strong>Owner:</strong><br><strong>Deadline:</strong></li></ul><h2>Long-term tasks</h2><p>Ongoing work connected to a larger project, future deadline, or broader goal.</p><ul><li>[ ] Task<br><strong>Owner:</strong><br><strong>Target:</strong></li></ul><h2>Questions and blockers</h2><ul><li>Question or blocker:</li></ul><h2>Follow-ups</h2><p>Messages to send, resources to share, or people to check in with.</p><h2>Items to revisit</h2><ul><li>Topic:</li></ul><h2>Next meeting</h2><p><strong>Date:</strong><br><strong>Preparation needed:</strong><br><strong>Topics to revisit:</strong></p><h2>Summary to share</h2><p>Write the concise update the team should receive after the meeting.</p>'),
    ('formal_meeting_minutes', 'Formal Meeting Minutes', 'meeting', 'For professional minutes that can be reviewed and distributed after a formal meeting.', '{{date}} Meeting Minutes', '<h1>Meeting Minutes</h1><p><strong>Meeting name:</strong><br><strong>Date:</strong><br><strong>Start and end time:</strong><br><strong>Location or call:</strong><br><strong>Facilitator:</strong><br><strong>Minutes prepared by:</strong></p><h2>Attendees</h2><ul><li>Name and role</li></ul><h2>Absent</h2><ul><li>Name and role</li></ul><h2>Agenda</h2><ol><li>Agenda item</li><li>Agenda item</li></ol><h2>Discussion by agenda item</h2><h3>Agenda item</h3><p><strong>Summary:</strong> Record the relevant discussion without unnecessary detail.</p><p><strong>Decision:</strong> State the outcome or note that no decision was made.</p><h2>Decisions</h2><ul><li>Decision, reasoning, and people involved.</li></ul><h2>Motions or approvals</h2><ul><li>Motion, proposer, seconder, and result.</li></ul><h2>Action items</h2><ul><li>[ ] Action<br><strong>Owner:</strong><br><strong>Deadline:</strong></li></ul><h2>Items carried forward</h2><ul><li>Item and reason it remains open.</li></ul><h2>Next meeting</h2><p><strong>Date:</strong><br><strong>Time:</strong><br><strong>Location:</strong></p><h2>Distribution</h2><p>People or channels receiving these minutes:</p><h2>Final summary</h2><p>Summarize the meeting outcome in two or three sentences.</p>'),
    ('one_on_one_notes', 'One-on-One Notes', 'meeting', 'For managers and team leads to prepare a focused conversation and preserve useful follow-through.', '{{date}} One-on-One — {{person}}', '<h1>One-on-One Notes</h1><p><strong>Person:</strong><br><strong>Date:</strong><br><strong>Meeting lead:</strong></p><h2>Check-in</h2><p>How is the person doing, and what context should shape this conversation?</p><h2>Current priorities</h2><ul><li>Priority, status, and next step.</li></ul><h2>Wins</h2><ul><li>Progress worth recognizing.</li></ul><h2>Challenges and workload</h2><p>What is difficult, unclear, or competing for attention?</p><h2>Short-term tasks</h2><ul><li>[ ] Task<br><strong>Owner:</strong><br><strong>Due:</strong></li></ul><h2>Long-term development</h2><p>Skills, responsibilities, or opportunities to build over time.</p><h2>Feedback given</h2><h2>Feedback received</h2><h2>Support needed</h2><h2>Decisions</h2><ul><li>Decision and rationale.</li></ul><h2>Follow-ups</h2><ul><li>[ ] Follow-up<br><strong>Owner:</strong><br><strong>Due:</strong></li></ul><h2>Career or skill development</h2><h2>Topics for next one-on-one</h2><ul><li>Topic:</li></ul>'),
    ('project_kickoff', 'Project Kickoff Meeting', 'meeting', 'For aligning a project team on purpose, scope, roles, risks, and the first checkpoint.', '{{date}} {{project}} Kickoff', '<h1>Project Kickoff</h1><p><strong>Project:</strong><br><strong>Date:</strong><br><strong>Facilitator:</strong></p><h2>Purpose</h2><p>Why are we doing this work now?</p><h2>Participants</h2><ul><li>Name and role:</li></ul><h2>Background</h2><h2>Desired outcome</h2><h2>Scope</h2><h2>Out of scope</h2><h2>Roles</h2><ul><li>Area: Owner and responsibility</li></ul><h2>Deliverables</h2><ul><li>Deliverable and acceptance signal.</li></ul><h2>Timeline</h2><ul><li>Milestone and target date.</li></ul><h2>Risks and dependencies</h2><ul><li>Risk or dependency, owner, and response.</li></ul><h2>Communication plan</h2><p>Where will updates live, who needs them, and how often?</p><h2>Short-term next actions</h2><ul><li>[ ] Action<br><strong>Owner:</strong><br><strong>Due:</strong></li></ul><h2>Long-term work</h2><ul><li>Workstream and target:</li></ul><h2>Decisions</h2><h2>Open questions</h2><h2>Next checkpoint</h2><p><strong>Date:</strong><br><strong>Preparation:</strong></p>'),
    ('retrospective', 'Retrospective', 'meeting', 'For reviewing a period or project honestly and turning lessons into owned improvements.', '{{date}} Retrospective', '<h1>Retrospective</h1><p><strong>Period or project:</strong><br><strong>Date:</strong><br><strong>Participants:</strong></p><h2>What went well</h2><ul><li>Practice or outcome to preserve.</li></ul><h2>What did not go well</h2><ul><li>Friction or outcome to understand.</li></ul><h2>What surprised us</h2><h2>What slowed us down</h2><h2>Communication issues</h2><h2>Process issues</h2><h2>Decisions</h2><h2>Stop</h2><ul><li>Practice to stop:</li></ul><h2>Start</h2><ul><li>Practice to start:</li></ul><h2>Continue</h2><ul><li>Practice to continue:</li></ul><h2>Short-term improvements</h2><ul><li>[ ] Improvement<br><strong>Owner:</strong><br><strong>Review date:</strong></li></ul><h2>Long-term improvements</h2><ul><li>Improvement and expected impact:</li></ul><h2>Review date</h2>'),

    ('weekly_internship_workspace', 'Weekly Internship Workspace', 'internship', 'For an intern to plan a week, capture learning, communicate progress, and carry useful work forward.', 'Week of {{week_start}}', '<h1>Week of</h1><h2>Main goals</h2><ol><li>Goal and why it matters.</li><li>Goal and why it matters.</li></ol><h2>Daily overview</h2><h3>Monday</h3><p>Plan, progress, and questions:</p><h3>Tuesday</h3><p>Plan, progress, and questions:</p><h3>Wednesday</h3><p>Plan, progress, and questions:</p><h3>Thursday</h3><p>Plan, progress, and questions:</p><h3>Friday</h3><p>Plan, progress, and questions:</p><h2>Short-term tasks</h2><p>Tasks to complete today, this week, or before the next meeting.</p><ul><li>[ ] Task<br><strong>Due:</strong></li></ul><h2>Long-term tasks</h2><p>Ongoing work that continues beyond this week or supports a larger project.</p><ul><li>Workstream, next milestone, and context:</li></ul><h2>Meetings this week</h2><h2>Main-room meeting notes</h2><h2>Breakout-room notes</h2><h2>Communication and follow-ups</h2><ul><li>[ ] Person or channel, message, and next step:</li></ul><h2>Work completed</h2><h2>Feedback received</h2><h2>Skills practiced</h2><h2>Tools or processes learned</h2><h2>Questions for supervisor</h2><h2>Challenges or blockers</h2><h2>Portfolio-worthy work</h2><h2>Hours summary</h2><h2>What I will carry into next week</h2><h2>Next week priorities</h2>'),
    ('daily_internship_log', 'Daily Internship Log', 'internship', 'For capturing daily work, learning, communication, and a clear first task for tomorrow.', '{{date}} Internship Log', '<h1>Internship Log</h1><p><strong>Date:</strong><br><strong>Hours worked:</strong></p><h2>Main priorities</h2><ol><li>Priority:</li><li>Priority:</li></ol><h2>Tasks completed</h2><ul><li>Task and outcome:</li></ul><h2>Tasks in progress</h2><h2>Short-term next steps</h2><ul><li>[ ] Task and due date:</li></ul><h2>Long-term work</h2><h2>Meetings attended</h2><h2>Communication sent</h2><h2>Feedback received</h2><h2>Skills practiced</h2><h2>Questions</h2><h2>Blockers</h2><h2>Work to document for portfolio</h2><h2>Tomorrow''s first task</h2>'),
    ('supervisor_meeting_notes', 'Supervisor Meeting Notes', 'internship', 'For preparing a productive supervisor conversation and leaving with clear expectations.', '{{date}} Supervisor Meeting', '<h1>Supervisor Meeting</h1><p><strong>Supervisor:</strong><br><strong>Date:</strong><br><strong>Meeting purpose:</strong></p><h2>Updates since last meeting</h2><h2>Work completed</h2><h2>Current priorities</h2><h2>Short-term assignments</h2><ul><li>[ ] Assignment<br><strong>Due:</strong></li></ul><h2>Long-term assignments</h2><ul><li>Assignment and milestone:</li></ul><h2>Feedback</h2><h2>Clarifications needed</h2><h2>Questions to ask</h2><h2>Decisions</h2><h2>Deadlines</h2><h2>Follow-ups</h2><h2>What to prepare for next meeting</h2>'),
    ('breakout_room_notes', 'Breakout Room Notes', 'internship', 'For focused small-group conversations that need a useful report back to the main meeting.', '{{date}} Breakout Notes — {{topic}}', '<h1>Breakout Room Notes</h1><p><strong>Topic:</strong><br><strong>People present:</strong><br><strong>Facilitator:</strong></p><h2>Goal</h2><h2>Main discussion</h2><h2>Ideas considered</h2><h2>Decisions</h2><h2>Assigned tasks</h2><ul><li>[ ] Task<br><strong>Owner:</strong><br><strong>Due:</strong></li></ul><h2>Questions to bring back</h2><h2>Main-room update</h2><p>Write the concise summary to report when the group returns.</p><h2>Follow-ups</h2><h2>Next checkpoint</h2>'),
    ('internship_evaluation_prep', 'Internship Evaluation Prep', 'internship', 'For preparing a grounded review of responsibilities, growth, feedback, and next steps.', NULL, '<h1>Internship Evaluation Prep</h1><h2>Original internship goals</h2><h2>How the placement compares with expectations</h2><h2>Responsibilities completed</h2><h2>Real-world experiences</h2><h2>Communication skills developed</h2><h2>Technical skills developed</h2><h2>Time-management lessons</h2><h2>Feedback received</h2><h2>Challenges</h2><h2>Accomplishments</h2><h2>Portfolio work</h2><h2>Areas for improvement</h2><h2>How coursework prepared me</h2><h2>Career relevance</h2><h2>Questions for the evaluation meeting</h2>'),
    ('internship_portfolio_case_study', 'Internship Portfolio Case Study', 'internship', 'For turning meaningful internship work into a clear, evidence-based case study.', NULL, '<h1>Internship Portfolio Case Study</h1><h2>Project title</h2><p><strong>Organization:</strong><br><strong>Role:</strong><br><strong>Timeline:</strong></p><h2>Project background</h2><h2>Problem</h2><h2>Objective</h2><h2>Audience</h2><h2>Constraints</h2><h2>Responsibilities</h2><h2>Research</h2><h2>Process</h2><h2>Design decisions</h2><h2>Collaboration</h2><h2>Feedback and revisions</h2><h2>Final outcome</h2><h2>Results</h2><h2>Skills demonstrated</h2><h2>What I learned</h2><h2>What I would improve</h2><h2>Portfolio assets needed</h2>'),

    ('team_lead_weekly_overview', 'Team Lead Weekly Overview', 'team', 'Plan team priorities, separate immediate work from longer-term responsibilities, track blockers, and prepare communication.', 'Week of {{week_start}} Team Overview', '<h1>Team Lead Weekly Overview</h1><h2>Team priorities</h2><h2>Main outcome for the week</h2><h2>Short-term work</h2><p>Work expected this week.</p><ul><li>[ ] Task<br><strong>Owner:</strong><br><strong>Due:</strong></li></ul><h2>Long-term work</h2><p>Ongoing work connected to projects or future deadlines.</p><ul><li>Workstream<br><strong>Owner:</strong><br><strong>Target:</strong></li></ul><h2>Assignments by person</h2><h3>Team member</h3><p>Current work:<br>Support needed:<br>Next step:</p><h2>Work completed</h2><h2>Work in progress</h2><h2>Blockers and dependencies</h2><h2>People needing support</h2><h2>Follow-ups</h2><h2>Upcoming deadlines</h2><h2>Meetings</h2><h2>Communication to send</h2><h2>Decisions needed</h2><h2>Risks</h2><h2>Wins</h2><h2>Next week preparation</h2>'),
    ('team_meeting_agenda', 'Team Meeting Agenda', 'team', 'Prepare a focused team meeting with clear decisions, time allocation, and a desired outcome.', '{{date}} Team Meeting Agenda', '<h1>Team Meeting Agenda</h1><p><strong>Meeting purpose:</strong><br><strong>Date and time:</strong><br><strong>Facilitator:</strong><br><strong>Attendees:</strong></p><h2>Desired meeting outcome</h2><h2>Updates</h2><h2>Priority topics</h2><ul><li>Topic, owner, and desired decision:</li></ul><h2>Decisions needed</h2><h2>Short-term task review</h2><h2>Long-term project review</h2><h2>Blockers</h2><h2>Team member questions</h2><h2>Upcoming deadlines</h2><h2>Announcements</h2><h2>Breakout topics</h2><h2>Time allocation</h2>'),
    ('team_weekly_update', 'Team Weekly Update', 'team', 'Share a concise weekly view of wins, work, blockers, decisions, and support needed.', 'Week of {{week_start}} Team Update', '<h1>Team Weekly Update</h1><h2>Summary</h2><h2>Wins</h2><h2>Completed</h2><h2>In progress</h2><h2>Short-term priorities</h2><h2>Long-term priorities</h2><h2>Blockers</h2><h2>Decisions needed</h2><h2>Upcoming deadlines</h2><h2>Team support needed</h2><h2>Communication</h2><h2>Next week</h2>'),
    ('delegation_brief', 'Delegation Brief', 'team', 'Give someone enough context, authority, and success criteria to own an assignment well.', NULL, '<h1>Delegation Brief</h1><h2>Assignment</h2><h2>Assigned to</h2><h2>Why this matters</h2><h2>Desired outcome</h2><h2>Scope</h2><h2>Out of scope</h2><h2>Resources</h2><h2>Dependencies</h2><h2>Deadline</h2><h2>Check-in date</h2><h2>Definition of done</h2><h2>Risks</h2><h2>Questions</h2><h2>Follow-up plan</h2>'),
    ('team_onboarding_notes', 'Team Onboarding Notes', 'team', 'Keep a practical record of a new team member''s context, access, relationships, and first milestones.', NULL, '<h1>Team Onboarding Notes</h1><p><strong>Person:</strong><br><strong>Role:</strong><br><strong>Start date:</strong></p><h2>Team overview</h2><h2>Key people</h2><h2>Current projects</h2><h2>Tools and access</h2><h2>Important documents</h2><h2>Communication norms</h2><h2>Recurring meetings</h2><h2>First-week tasks</h2><h2>First-month goals</h2><h2>Training</h2><h2>Questions</h2><h2>Follow-ups</h2><h2>Onboarding progress</h2>'),
    ('decision_log', 'Decision Log', 'team', 'Record decisions with enough context to explain the choice and revisit it responsibly.', NULL, '<h1>Decision Log</h1><p><strong>Date:</strong><br><strong>Decision:</strong><br><strong>Related project:</strong></p><h2>Context</h2><h2>Options considered</h2><h2>Final choice</h2><h2>Reasoning</h2><h2>People involved</h2><h2>Impact</h2><h2>Risks</h2><h2>Follow-up actions</h2><ul><li>[ ] Action<br><strong>Owner:</strong></li></ul><h2>Review date</h2>'),

    ('project_brief', 'Project Brief', 'project', 'Define a project''s purpose, boundaries, measures of success, and the work needed next.', '{{project}} Project Brief', '<h1>Project Brief</h1><p><strong>Project name:</strong><br><strong>Owner:</strong><br><strong>Team:</strong></p><h2>Background</h2><h2>Problem or opportunity</h2><h2>Objective</h2><h2>Desired outcome</h2><h2>Success criteria</h2><h2>Audience or users</h2><h2>Scope</h2><h2>Out of scope</h2><h2>Deliverables</h2><h2>Timeline and milestones</h2><h2>Short-term next actions</h2><ul><li>[ ] Action<br><strong>Owner:</strong><br><strong>Due:</strong></li></ul><h2>Long-term work</h2><ul><li>Workstream and target:</li></ul><h2>Stakeholders</h2><h2>Dependencies</h2><h2>Risks</h2><h2>Blockers</h2><h2>Communication plan</h2><h2>Open questions</h2><h2>Linked resources</h2>'),
    ('creative_brief', 'Creative Brief', 'project', 'Align creative work on the audience, message, requirements, direction, and approval path.', NULL, '<h1>Creative Brief</h1><p><strong>Project:</strong><br><strong>Client or stakeholder:</strong></p><h2>Background</h2><h2>Objective</h2><h2>Audience</h2><h2>Key message</h2><h2>Deliverables</h2><h2>Requirements</h2><h2>Tone</h2><h2>Visual direction</h2><h2>References</h2><h2>Constraints</h2><h2>Timeline</h2><h2>Approval process</h2><h2>Short-term actions</h2><h2>Long-term considerations</h2><h2>Open questions</h2>'),
    ('project_status_update', 'Project Status Update', 'project', 'Create a repeatable project update that makes progress, risk, and next action visible.', NULL, '<h1>Project Status Update</h1><p><strong>Project:</strong><br><strong>Date:</strong><br><strong>Overall status:</strong></p><h2>Summary</h2><h2>Completed since last update</h2><h2>In progress</h2><h2>Short-term next actions</h2><h2>Long-term work</h2><h2>Milestones</h2><h2>Risks</h2><h2>Blockers</h2><h2>Dependencies</h2><h2>Decisions needed</h2><h2>Owner updates</h2><h2>Timeline changes</h2><h2>Next update</h2>'),
    ('project_handoff', 'Project Handoff', 'project', 'Transfer project context, open work, decisions, and deadlines without losing momentum.', NULL, '<h1>Project Handoff</h1><p><strong>Project:</strong><br><strong>Handoff from:</strong><br><strong>Handoff to:</strong></p><h2>Current status</h2><h2>Objective</h2><h2>Completed work</h2><h2>Open work</h2><h2>Short-term priorities</h2><h2>Long-term priorities</h2><h2>Files and resources</h2><h2>Decisions made</h2><h2>Known issues</h2><h2>Dependencies</h2><h2>Stakeholders</h2><h2>Upcoming deadlines</h2><h2>Access needed</h2><h2>Questions</h2><h2>Definition of successful handoff</h2>'),
    ('project_postmortem', 'Project Postmortem', 'project', 'Review a project outcome, preserve lessons, and assign improvements instead of repeating the same problems.', NULL, '<h1>Project Postmortem</h1><p><strong>Project:</strong><br><strong>Outcome:</strong></p><h2>Original objective</h2><h2>Final result</h2><h2>What went well</h2><h2>What went poorly</h2><h2>Timeline review</h2><h2>Scope changes</h2><h2>Communication review</h2><h2>Risks encountered</h2><h2>Decisions</h2><h2>Lessons learned</h2><h2>Short-term fixes</h2><ul><li>[ ] Fix<br><strong>Owner:</strong><br><strong>Due:</strong></li></ul><h2>Long-term improvements</h2><ul><li>Improvement and expected impact:</li></ul><h2>Review date</h2>'),
    ('research_notes', 'Research Notes', 'project', 'Turn research into organized evidence, decisions, questions, and practical next steps.', NULL, '<h1>Research Notes</h1><h2>Research question</h2><h2>Context</h2><h2>Goal</h2><h2>Sources</h2><ul><li>Source, date, and relevance:</li></ul><h2>Key findings</h2><h2>Evidence</h2><h2>Contradictions</h2><h2>Questions</h2><h2>Ideas</h2><h2>Implications</h2><h2>Decisions influenced</h2><h2>Follow-up research</h2><h2>Tasks created</h2><h2>Linked project</h2>'),

    ('daily_reflection', 'Daily Reflection', 'personal', 'Close the day around Ledger''s accountability loop: what moved, what blocked, and what comes next.', '{{date}} Daily Reflection', '<h1>Daily Reflection</h1><h2>Finished</h2><ul><li>What did I complete?</li></ul><h2>Blocked</h2><ul><li>What is stuck, and what would unblock it?</li></ul><h2>What moved forward</h2><h2>Short-term tasks completed</h2><h2>Long-term progress</h2><h2>Communication and follow-ups</h2><h2>What I learned</h2><h2>What took more energy than expected</h2><h2>What needs attention</h2><h2>First task tomorrow</h2><h2>Notes</h2>'),
    ('weekly_review', 'Weekly Review', 'personal', 'Review completed work, carryovers, conversations, and the priorities that should shape next week.', 'Week of {{week_start}} Review', '<h1>Weekly Review</h1><h2>Main wins</h2><h2>Work completed</h2><h2>Short-term tasks completed</h2><h2>Long-term progress</h2><h2>What carried over</h2><h2>What was blocked</h2><h2>Follow-ups</h2><h2>Important conversations</h2><h2>Projects needing attention</h2><h2>Lessons</h2><h2>What to stop</h2><h2>What to continue</h2><h2>Priorities for next week</h2><h2>First task Monday</h2>'),
    ('monthly_reset', 'Monthly Reset', 'personal', 'Step back from daily noise to review the month, reset priorities, and choose a practical direction.', NULL, '<h1>Monthly Reset</h1><h2>Month reviewed</h2><h2>Highlights</h2><h2>Completed goals</h2><h2>Incomplete goals</h2><h2>Projects</h2><h2>Habits</h2><h2>Work</h2><h2>Relationships</h2><h2>Learning</h2><h2>Finances or administration</h2><h2>What felt heavy</h2><h2>What worked</h2><h2>What to change</h2><h2>Short-term priorities</h2><h2>Long-term direction</h2><h2>Important dates</h2><h2>Next month focus</h2>'),
    ('decision_journal', 'Decision Journal', 'personal', 'Make important choices clearer by separating context, assumptions, risks, reasoning, and review.', NULL, '<h1>Decision Journal</h1><p><strong>Decision:</strong><br><strong>Date:</strong></p><h2>Context</h2><h2>Why this matters</h2><h2>Options</h2><h2>Assumptions</h2><h2>Risks</h2><h2>Best-case outcome</h2><h2>Worst-case outcome</h2><h2>What I know</h2><h2>What I do not know</h2><h2>People involved</h2><h2>Final decision</h2><h2>Reasoning</h2><h2>Follow-up date</h2><h2>Outcome review</h2>'),
    ('brain_dump_action_plan', 'Brain Dump to Action Plan', 'personal', 'Move a crowded mind toward a small set of concrete actions, projects, and follow-ups.', NULL, '<h1>Brain Dump to Action Plan</h1><h2>Everything on my mind</h2><h2>What is urgent</h2><h2>What is important</h2><h2>What can wait</h2><h2>What can be delegated</h2><h2>Short-term tasks</h2><ul><li>[ ] Task and next action:</li></ul><h2>Long-term tasks</h2><ul><li>Workstream and next milestone:</li></ul><h2>Projects</h2><h2>Follow-ups</h2><h2>Events or deadlines</h2><h2>Questions</h2><h2>First three actions</h2><ol><li>[ ]</li><li>[ ]</li><li>[ ]</li></ol>'),
    ('learning_log', 'Learning Log', 'personal', 'Capture learning in a way that turns ideas into practice, questions, and the next learning step.', NULL, '<h1>Learning Log</h1><p><strong>Topic:</strong><br><strong>Date:</strong><br><strong>Why I am learning this:</strong></p><h2>Key concepts</h2><h2>Notes</h2><h2>Examples</h2><h2>Questions</h2><h2>What confused me</h2><h2>What clicked</h2><h2>Practical application</h2><h2>Practice task</h2><h2>Resources</h2><h2>Follow-up</h2><h2>Next learning step</h2>'),

    ('book_notes', 'Book Notes', 'reading', 'Read actively by capturing the argument, questions, connections, and how the ideas may be applied.', '{{topic}} Book Notes', '<h1>Book Notes</h1><p><strong>Title:</strong><br><strong>Author:</strong><br><strong>Started:</strong><br><strong>Finished:</strong></p><h2>Why I chose this book</h2><h2>Main argument</h2><h2>Chapter notes</h2><h2>Key ideas</h2><h2>Quotes</h2><h2>Questions</h2><h2>Agreements</h2><h2>Disagreements</h2><h2>Connections to other ideas</h2><h2>Practical takeaways</h2><h2>How I will apply this</h2><h2>People to discuss this with</h2><h2>Follow-up reading</h2><h2>Rating</h2>'),
    ('article_notes', 'Article Notes', 'reading', 'Save the useful argument, evidence, questions, and application from an article without losing its source.', NULL, '<h1>Article Notes</h1><p><strong>Title:</strong><br><strong>Author:</strong><br><strong>Source:</strong><br><strong>Date:</strong><br><strong>Link:</strong></p><h2>Why I saved this</h2><h2>Summary</h2><h2>Main argument</h2><h2>Evidence</h2><h2>Key takeaways</h2><h2>Useful quotes</h2><h2>Questions</h2><h2>What I agree with</h2><h2>What I challenge</h2><h2>Application</h2><h2>Related projects</h2><h2>Follow-up</h2>'),
    ('course_lecture_notes', 'Course or Lecture Notes', 'reading', 'Keep learning notes useful for review by separating concepts, examples, questions, and practice.', NULL, '<h1>Course or Lecture Notes</h1><p><strong>Course:</strong><br><strong>Session:</strong><br><strong>Date:</strong><br><strong>Instructor:</strong><br><strong>Topic:</strong></p><h2>Learning objectives</h2><h2>Main concepts</h2><h2>Definitions</h2><h2>Examples</h2><h2>Questions</h2><h2>Assignments</h2><h2>Short-term study tasks</h2><ul><li>[ ] Task and due date:</li></ul><h2>Long-term learning goals</h2><h2>Resources</h2><h2>Summary</h2><h2>Next review date</h2>'),
    ('podcast_notes', 'Podcast Notes', 'reading', 'Capture the useful ideas, people, resources, and actions from a podcast episode.', NULL, '<h1>Podcast Notes</h1><p><strong>Podcast:</strong><br><strong>Episode:</strong><br><strong>Guest:</strong><br><strong>Date:</strong><br><strong>Link:</strong></p><h2>Why I listened</h2><h2>Main topics</h2><h2>Key ideas</h2><h2>Useful quotes</h2><h2>Questions</h2><h2>People mentioned</h2><h2>Resources mentioned</h2><h2>Actionable takeaways</h2><h2>Follow-up</h2><h2>Rating</h2>')
  ) AS presets(system_key, name, category, description, title_pattern, content_html)
$$;

CREATE OR REPLACE FUNCTION public.provision_ledger_note_templates(target_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  preset RECORD;
BEGIN
  FOR preset IN SELECT * FROM public.ledger_template_presets() LOOP
    INSERT INTO public.note_templates (
      workspace_id, system_key, name, category, description, title_pattern,
      content_html, is_default, is_system, visibility, created_by, usage_count
    ) VALUES (
      target_workspace_id, preset.system_key, preset.name, preset.category,
      preset.description, preset.title_pattern, preset.content_html,
      false, true, 'workspace', NULL, 0
    )
    ON CONFLICT (workspace_id, system_key) WHERE is_system = true AND system_key IS NOT NULL
    DO UPDATE SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      description = EXCLUDED.description,
      title_pattern = EXCLUDED.title_pattern,
      content_html = EXCLUDED.content_html,
      updated_at = NOW()
    WHERE public.note_templates.is_system = true;
  END LOOP;
END;
$$;

-- Upgrade existing Ledger rows and add every missing preset without touching
-- ownership, usage, timestamps, visibility preferences, or custom copies.
DO $$
DECLARE workspace_row RECORD;
BEGIN
  FOR workspace_row IN SELECT id FROM public.workspaces LOOP
    PERFORM public.provision_ledger_note_templates(workspace_row.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_ledger_templates_on_workspace_create()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.provision_ledger_note_templates(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provision_ledger_templates_after_workspace_insert ON public.workspaces;
CREATE TRIGGER provision_ledger_templates_after_workspace_insert
  AFTER INSERT ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.provision_ledger_templates_on_workspace_create();

COMMENT ON COLUMN public.note_templates.system_key IS
  'Stable Ledger-owned preset identity. NULL for user-created templates.';
