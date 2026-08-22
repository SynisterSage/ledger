import type { AskLedgerRoutingContext } from './askLedgerResponseMode.ts';

export type AskLedgerProductArea =
  | 'ledger'
  | 'projects'
  | 'notes'
  | 'calendar'
  | 'meetings'
  | 'tasks'
  | 'teams'
  | 'intake'
  | 'search'
  | 'ask_ledger'
  | 'integrations';

export type AskLedgerProductKnowledgeNode = {
  id: string;
  area: AskLedgerProductArea;
  feature?: string;
  title: string;
  summary: string;
  details: string;
  aliases: string[];
  related?: string[];
};

const node = (entry: AskLedgerProductKnowledgeNode): AskLedgerProductKnowledgeNode => entry;

/**
 * Canonical, user-facing Ledger facts. Keep nodes small and verify additions
 * against the rendered product before expanding this registry.
 */
export const ASK_LEDGER_PRODUCT_KNOWLEDGE: readonly AskLedgerProductKnowledgeNode[] = [
  node({ id: 'ledger.overview', area: 'ledger', title: 'Ledger overview', summary: 'Ledger is a calm desktop accountability workspace for capturing thoughts, planning the day, organizing work, and closing the loop.', details: 'Ledger brings capture, planning, execution, and review into a sidebar-first workspace. It connects notes, projects, tasks, calendar context, reminders, intake, search, and follow-through without turning the product into a generic dashboard.', aliases: ['ledger', 'what is ledger', 'what does ledger do'], related: ['projects.overview', 'notes.overview', 'calendar.overview', 'ask_ledger.overview'] }),

  node({ id: 'projects.overview', area: 'projects', title: 'Projects', summary: 'Projects are lightweight outcome containers for goals, status, progress, next actions, dates, and connected context.', details: 'The Projects workspace can show projects in a timeline or list, then open a project command center with overview details, next actions, milestones, linked notes and calendar items, and activity.', aliases: ['project', 'projects', 'project page', 'what does projects do'], related: ['projects.timeline', 'projects.milestones', 'projects.tasks', 'projects.related_context', 'projects.activity'] }),
  node({ id: 'projects.timeline', area: 'projects', feature: 'timeline', title: 'Project timeline', summary: 'The project timeline places dated projects and milestones across a selectable month, quarter, or all-time range.', details: 'Projects can be viewed in a timeline or list. Timeline interactions support project dates and milestone placement, while the project view keeps the work attached to its outcome.', aliases: ['timeline', 'project timeline', 'timeline view'], related: ['projects.milestones'] }),
  node({ id: 'projects.milestones', area: 'projects', feature: 'milestones', title: 'Project milestones', summary: 'Milestones mark meaningful dated points in a project.', details: 'Milestones can have a title, date, type, note, completion state, and assignment. Tasks can be associated with a milestone, and milestones appear in project and calendar context.', aliases: ['milestone', 'milestones', 'project milestones'], related: ['projects.timeline', 'projects.tasks'] }),
  node({ id: 'projects.tasks', area: 'projects', feature: 'tasks', title: 'Project next actions', summary: 'Project tasks are the next actions that move an outcome forward.', details: 'Tasks can be created from a project, associated with milestones, assigned, dated, completed, and reviewed alongside the project rather than kept as an isolated checklist.', aliases: ['project tasks', 'next actions', 'actions', 'tasks in projects'], related: ['tasks.overview', 'projects.milestones'] }),
  node({ id: 'projects.related_context', area: 'projects', feature: 'related_context', title: 'Project related context', summary: 'Projects can keep related notes, events, reminders, and external context beside the work.', details: 'The project surface gathers connected notes and calendar context so the goal, work, and supporting material stay together.', aliases: ['related context', 'linked notes', 'project notes', 'project context'], related: ['notes.linked_resources', 'calendar.overview'] }),
  node({ id: 'projects.activity', area: 'projects', feature: 'activity', title: 'Project activity', summary: 'Project activity shows meaningful updates and progress around the project.', details: 'Activity is grouped into recent time ranges and includes useful project, milestone, task, calendar, and related-work changes rather than a raw audit log.', aliases: ['project activity', 'project updates'], related: ['projects.overview'] }),

  node({ id: 'notes.overview', area: 'notes', title: 'Notes', summary: 'Notes is Ledger’s writing and thinking workspace for capturing structured text, meeting notes, and connected context.', details: 'Notes supports a file-tree-style organization with sections, parent and child notes, templates, writing, outline, Mind Map, meeting-note transcription, smart dates and people references, slash commands, embeds, and linked resources.', aliases: ['note', 'notes', 'notes page', 'what does notes do', 'how do notes work', 'features in notes'], related: ['notes.write', 'notes.mind_map', 'notes.transcribe', 'notes.slash_commands', 'notes.smart_dates', 'notes.people_references', 'notes.embeds', 'notes.linked_resources'] }),
  node({ id: 'notes.write', area: 'notes', feature: 'write', title: 'Write', summary: 'Write is the normal rich-text editing view for a note.', details: 'The editor supports headings, lists, checklists, quotes, toggles, callouts, dividers, tables, code blocks, images, file attachments, links, and embeds through the compact editor and slash menu.', aliases: ['write', 'writing', 'editor', 'rich text'], related: ['notes.slash_commands', 'notes.embeds'] }),
  node({ id: 'notes.mind_map', area: 'notes', feature: 'mind_map', title: 'Mind Map', summary: 'Mind Map is an alternate view of a note for organizing ideas spatially.', details: 'Mind Map is a view inside Notes, not a separate note type. Its node structure is saved with the note and can be edited or viewed full-screen.', aliases: ['mind map', 'mindmap', 'map view', 'map'], related: ['notes.overview'] }),
  node({ id: 'notes.transcribe', area: 'notes', feature: 'transcribe', title: 'Transcribe', summary: 'Meeting notes can include locally captured audio and a transcript.', details: 'The desktop meeting-note flow records audio, processes it with the local Whisper transcription path, shows transcript segments and speakers, and lets users connect transcript context back to notes and follow-ups.', aliases: ['transcribe', 'transcription', 'meeting transcription', 'record meetings'], related: ['meetings.overview', 'notes.linked_resources'] }),
  node({ id: 'notes.slash_commands', area: 'notes', feature: 'slash_commands', title: 'Slash commands', summary: 'Typing / in the editor opens commands for inserting common note blocks.', details: 'Available commands include text, headings, bulleted and numbered lists, checklists, quotes, toggles, callouts, dividers, tables, code blocks, images, file attachments, and links or embeds. Commands support aliases such as todo, checkbox, hr, attachment, and embed.', aliases: ['slash', 'slash command', 'slash commands', 'editor commands', 'what about slash commands'], related: ['notes.write', 'notes.embeds'] }),
  node({ id: 'notes.smart_dates', area: 'notes', feature: 'smart_dates', title: 'Smart date capture', summary: 'Notes can recognize date language and turn it into linked date context.', details: 'Detected dates can be reviewed in the note and used to create an event or reminder with the resolved date, optional time, calendar, and title.', aliases: ['smart date', 'smart dates', 'date capture', 'natural dates'], related: ['calendar.events'] }),
  node({ id: 'notes.people_references', area: 'notes', feature: 'people_references', title: 'People references', summary: 'Notes can recognize people references and connect them to workspace people when available.', details: 'Smart people references provide linked person context and can feed follow-up actions such as assigning work when the person is resolved.', aliases: ['people references', 'person references', 'mentions', 'smart people'], related: ['teams.overview', 'tasks.overview'] }),
  node({ id: 'notes.embeds', area: 'notes', feature: 'embeds', title: 'Embeds', summary: 'Notes can attach supported external links and display connected previews or references.', details: 'The editor recognizes supported Figma, GitHub, and Google Drive links for external references. Notes can also contain images and file attachments.', aliases: ['embed', 'embeds', 'external links', 'link or embed'], related: ['notes.linked_resources', 'integrations.github'] }),
  node({ id: 'notes.linked_resources', area: 'notes', feature: 'linked_resources', title: 'Linked resources', summary: 'Notes can connect to projects, events, tasks, reminders, and external resources.', details: 'Linked context keeps a note useful as part of the wider Ledger workspace. Meeting transcript segments and external references can also be attached to the note or opened from it.', aliases: ['linked resources', 'link resources', 'note links', 'connected notes'], related: ['projects.related_context', 'calendar.events'] }),

  node({ id: 'calendar.overview', area: 'calendar', title: 'Calendar', summary: 'Calendar combines time commitments with dated work so users can see events, reminders, tasks, deadlines, milestones, and follow-ups together.', details: 'The Calendar page supports Day, Week, Month, and Agenda views, calendar controls, quick creation, selected-item context, and links back to projects and notes.', aliases: ['calendar', 'calendar page', 'what does calendar do', 'calendar features', 'features on calendar'], related: ['calendar.views', 'calendar.events', 'calendar.tasks', 'calendar.sync'] }),
  node({ id: 'calendar.views', area: 'calendar', feature: 'views', title: 'Calendar views', summary: 'Calendar offers Day, Week, Month, and Agenda views.', details: 'Day and Week show timed schedules, Month provides a month grid, and Agenda presents a date-oriented list. The selected view and date are preserved in the calendar route.', aliases: ['day view', 'week view', 'month view', 'agenda', 'calendar views'], related: ['calendar.overview'] }),
  node({ id: 'calendar.events', area: 'calendar', feature: 'events', title: 'Calendar events', summary: 'Events represent scheduled time and can carry Ledger context.', details: 'Events support title, date, times, all-day state, calendar, repeat options, notes, and links to projects or notes. Selected events can lead to follow-up actions.', aliases: ['events', 'calendar events', 'new event', 'event notes'], related: ['notes.smart_dates', 'projects.related_context'] }),
  node({ id: 'calendar.tasks', area: 'calendar', feature: 'tasks', title: 'Dated work in Calendar', summary: 'Calendar can show tasks, reminders, deadlines, and milestones alongside events.', details: 'Dated work is displayed as work context; it is not automatically converted into time-blocking events. Items remain linked to their underlying Ledger records.', aliases: ['calendar tasks', 'tasks on calendar', 'deadlines on calendar', 'milestones on calendar'], related: ['tasks.overview', 'projects.milestones'] }),
  node({ id: 'calendar.sync', area: 'calendar', feature: 'sync', title: 'Calendar sync', summary: 'Ledger supports calendar connections and ICS-based calendar flows.', details: 'Current calendar-related surfaces include Apple Calendar and Reminders connections, calendar subscriptions, and ICS import. Availability depends on the connected provider and workspace setup.', aliases: ['calendar sync', 'calendar integrations', 'ics', 'apple calendar', 'calendar subscription'], related: ['integrations.overview'] }),

  node({ id: 'meetings.overview', area: 'meetings', title: 'Meetings', summary: 'Meetings are handled through meeting notes inside Notes, with calendar context and optional transcription.', details: 'A meeting note can hold written notes, recording and transcript state, transcript segments, speaker labels, links, decisions, action items, and follow-up context. Ledger does not create a separate standalone Meetings database.', aliases: ['meetings', 'meeting notes', 'meeting page', 'meeting transcription'], related: ['notes.transcribe', 'calendar.events'] }),
  node({ id: 'tasks.overview', area: 'tasks', title: 'Tasks', summary: 'Tasks are concrete next actions that can be captured, assigned, dated, linked, completed, and reviewed.', details: 'Tasks connect to projects and milestones and can appear with calendar context, reminders, notes, people, and follow-up work.', aliases: ['task', 'tasks', 'todo', 'next actions'], related: ['projects.tasks', 'calendar.tasks'] }),
  node({ id: 'teams.overview', area: 'teams', title: 'Teams', summary: 'Teams organize people and shared work inside a workspace.', details: 'The Teams area provides team overview, members, notes, assigned work, owned projects, milestones, upcoming items, and needs-attention context according to workspace access.', aliases: ['team', 'teams', 'team page', 'people and teams'], related: ['notes.people_references', 'tasks.overview'] }),
  node({ id: 'intake.overview', area: 'intake', title: 'Intake', summary: 'Intake is the landing place for captured or imported items that still need a Ledger decision.', details: 'Items can arrive from quick capture and supported integrations. From Intake, a user can review an item and move it toward a task, note, reminder, project context, or archive path.', aliases: ['intake', 'inbox', 'captured items', 'capture inbox'], related: ['ledger.overview', 'integrations.github', 'integrations.slack'] }),
  node({ id: 'search.overview', area: 'search', title: 'Search', summary: 'Search helps navigate Ledger and find workspace records from the shared search surface.', details: 'The Search surface includes navigation and action commands as well as workspace results such as projects, tasks, notes, events, reminders, teams, and people when available in the active workspace.', aliases: ['search', 'global search', 'find in ledger', 'search page'], related: ['intake.overview'] }),
  node({ id: 'ask_ledger.overview', area: 'ask_ledger', title: 'Ask Ledger', summary: 'Ask Ledger is Ledger’s conversational assistant for product help, workspace questions, grounded synthesis, and supported actions.', details: 'It separates general conversation, Ledger product help, and workspace-grounded questions. Workspace answers use supplied Ledger records; proposed mutations still require review and confirmation.', aliases: ['ask ledger', 'agent', 'ledger assistant', 'ai assistant'], related: ['ledger.overview'] }),

  node({ id: 'integrations.overview', area: 'integrations', title: 'Integrations', summary: 'Integrations bring outside signals into Ledger so they can become connected context and follow-through.', details: 'Current product surfaces include GitHub, Slack, Google Drive, Figma, Apple Calendar, Apple Reminders, the Browser Extension, and MCP connections. Exact capabilities and availability vary by provider and connection state.', aliases: ['integrations', 'connected apps', 'connections'], related: ['integrations.github', 'integrations.slack'] }),
  node({ id: 'integrations.google_drive', area: 'integrations', feature: 'google_drive', title: 'Google Drive integration', summary: 'Google Drive connects files, folders, and activity to Ledger projects and work.', details: 'Ledger can authorize Google Drive, browse folders and files, link Drive sources to projects, send selected files to Intake, and manage connected-folder monitoring and repeatable folder templates where configured.', aliases: ['google drive', 'drive', 'google drive integration'], related: ['intake.overview', 'projects.related_context'] }),
  node({ id: 'integrations.figma', area: 'integrations', feature: 'figma', title: 'Figma integration', summary: 'Figma connects designs and saved previews to Ledger work.', details: 'Ledger can attach Figma designs to tasks, projects, notes, and Intake items, preview saved designs, open the original in Figma, and manually refresh previews. Optional change checks, notifications, automatic preview refresh, and Intake capture are configurable.', aliases: ['figma', 'figma integration', 'figma designs'], related: ['notes.embeds', 'projects.related_context'] }),
  node({ id: 'integrations.apple_calendar', area: 'integrations', feature: 'apple_calendar', title: 'Apple Calendar integration', summary: 'The macOS Ledger app can show selected Apple Calendar calendars alongside Ledger work.', details: 'Users grant access, choose calendars, control visibility, refresh events, and can create, update, delete, or move supported events from the desktop integration. Apple Calendar data is not changed when Ledger disconnects.', aliases: ['apple calendar', 'apple calendars', 'eventkit calendar'], related: ['calendar.sync', 'calendar.events'] }),
  node({ id: 'integrations.apple_reminders', area: 'integrations', feature: 'apple_reminders', title: 'Apple Reminders integration', summary: 'The macOS Ledger app can show dated reminders from selected Apple Reminders lists alongside Ledger work.', details: 'Users grant access, choose lists, control visibility, and see reminders with due dates. Disconnecting Ledger does not delete or modify Apple Reminders data.', aliases: ['apple reminders', 'apple reminder', 'reminder lists'], related: ['calendar.sync', 'calendar.tasks'] }),
  node({ id: 'integrations.browser_extension', area: 'integrations', feature: 'browser_extension', title: 'Browser Extension', summary: 'The Browser Extension captures links, selected text, and quick notes into Ledger.', details: 'A workspace extension token is generated and managed from Settings. The token can be copied, regenerated, or revoked; captures are intended to enter Ledger for later organization and follow-through.', aliases: ['browser extension', 'chrome extension', 'browser capture', 'capture from chrome'], related: ['intake.overview'] }),
  node({ id: 'integrations.mcp', area: 'integrations', feature: 'mcp', title: 'MCP connections', summary: 'MCP connections let explicitly approved AI tools access a Ledger workspace.', details: 'Connections are workspace-scoped and expose explicitly approved read or write permissions. Settings shows the connected client, workspace, scopes, usage, and controls to rename, switch workspace, manage permissions, or revoke access.', aliases: ['mcp', 'mcp connections', 'ai tool connections', 'model context protocol'], related: ['ask_ledger.overview'] }),
  node({ id: 'integrations.github', area: 'integrations', feature: 'github', title: 'GitHub integration', summary: 'GitHub connects approved repositories and development activity to Ledger.', details: 'The GitHub App lets a workspace choose repository access, capture issues and pull requests into Intake, create restrained notifications for review requests or failing checks, and keep repository-linked context attached to Ledger work.', aliases: ['github', 'github integration', 'github app', 'github issues', 'pull requests'], related: ['intake.overview', 'notes.embeds'] }),
  node({ id: 'integrations.slack', area: 'integrations', feature: 'slack', title: 'Slack integration', summary: 'Slack brings selected Slack messages and conversations into Ledger context and Intake.', details: 'Slack can capture messages to Intake, monitor selected conversations, preserve thread and reply context, and link Slack context through Ledger. The integration is inbound to Ledger; it is not a Slack client or bulk-history mirror.', aliases: ['slack', 'slack integration', 'slack messages', 'slack capture'], related: ['intake.overview'] }),
];

const normalize = (value: string) => value.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const areaAliases: Array<[AskLedgerProductArea, string[]]> = [
  ['ask_ledger', ['ask ledger', 'ledger assistant', 'assistant', 'agent']],
  ['integrations', ['integration', 'integrations', 'connected apps', 'connections', 'github', 'slack', 'figma', 'google drive', 'apple calendar', 'apple reminders', 'browser extension', 'mcp']],
  ['projects', ['project', 'projects', 'milestone', 'milestones', 'timeline', 'next action']],
  ['notes', ['note', 'notes', 'mind map', 'slash', 'smart date', 'smart person', 'transcribe', 'embed']],
  ['calendar', ['calendar', 'event', 'events', 'day view', 'week view', 'month view', 'agenda', 'ics']],
  ['meetings', ['meeting', 'meetings', 'meeting note', 'transcription']],
  ['tasks', ['task', 'tasks', 'todo', 'to do', 'next actions']],
  ['teams', ['team', 'teams', 'people', 'members']],
  ['intake', ['intake', 'inbox', 'captured items']],
  ['search', ['search', 'find in ledger']],
  ['ledger', ['ledger', 'features', 'what features', 'what can ledger do', 'what does ledger do', 'how does ledger work']],
];

const featureAliases: Array<{ area: AskLedgerProductArea; feature: string; aliases: string[] }> = [
  { area: 'notes', feature: 'slash_commands', aliases: ['slash', 'slash command', 'slash commands', 'editor command'] },
  { area: 'notes', feature: 'smart_dates', aliases: ['smart date', 'smart dates', 'date capture', 'natural date'] },
  { area: 'notes', feature: 'people_references', aliases: ['people reference', 'people references', 'person reference', 'mentions', 'mention people', 'mention ppl', 'ppl', 'smart people'] },
  { area: 'notes', feature: 'mind_map', aliases: ['mind map', 'mindmap', 'map view'] },
  { area: 'notes', feature: 'transcribe', aliases: ['transcribe', 'transcription', 'record meeting'] },
  { area: 'notes', feature: 'embeds', aliases: ['embed', 'embeds', 'external link'] },
  { area: 'notes', feature: 'linked_resources', aliases: ['linked resource', 'linked resources', 'note links'] },
  { area: 'notes', feature: 'write', aliases: ['write', 'writing', 'editor'] },
  { area: 'projects', feature: 'timeline', aliases: ['timeline', 'timeline view'] },
  { area: 'projects', feature: 'milestones', aliases: ['milestone', 'milestones'] },
  { area: 'projects', feature: 'tasks', aliases: ['project task', 'project tasks', 'next action', 'next actions'] },
  { area: 'projects', feature: 'related_context', aliases: ['related context', 'linked notes', 'project context'] },
  { area: 'projects', feature: 'activity', aliases: ['project activity', 'project updates'] },
  { area: 'calendar', feature: 'views', aliases: ['day view', 'week view', 'month view', 'agenda', 'calendar views'] },
  { area: 'calendar', feature: 'events', aliases: ['event', 'events', 'new event', 'event notes'] },
  { area: 'calendar', feature: 'tasks', aliases: ['calendar task', 'tasks on calendar', 'deadline', 'deadlines'] },
  { area: 'calendar', feature: 'sync', aliases: ['calendar sync', 'calendar integration', 'sync', 'ics', 'apple calendar', 'calendar subscription'] },
  { area: 'integrations', feature: 'github', aliases: ['github', 'github integration', 'github app', 'github issues', 'issues', 'pull request', 'pull requests'] },
  { area: 'integrations', feature: 'slack', aliases: ['slack', 'slack integration', 'slack message', 'slack capture'] },
  { area: 'integrations', feature: 'google_drive', aliases: ['google drive', 'drive', 'google drive integration'] },
  { area: 'integrations', feature: 'figma', aliases: ['figma', 'figma integration', 'figma designs'] },
  { area: 'integrations', feature: 'apple_calendar', aliases: ['apple calendar', 'apple calendars', 'eventkit calendar'] },
  { area: 'integrations', feature: 'apple_reminders', aliases: ['apple reminders', 'apple reminder', 'reminder lists'] },
  { area: 'integrations', feature: 'browser_extension', aliases: ['browser extension', 'chrome extension', 'browser capture'] },
  { area: 'integrations', feature: 'mcp', aliases: ['mcp', 'mcp connections', 'ai tool connections', 'model context protocol'] },
];

const nodeById = new Map(ASK_LEDGER_PRODUCT_KNOWLEDGE.map((entry) => [entry.id, entry]));
const findAlias = (value: string, aliases: string[]) => aliases.find((alias) => value.includes(normalize(alias)));

export type AskLedgerProductKnowledgeSelection = {
  area?: AskLedgerProductArea;
  feature?: string;
  nodes: AskLedgerProductKnowledgeNode[];
  missingTopic?: string;
  context: string;
  tokenCount: number;
  resolutionConfidence: number;
  resolutionReason: string;
};

const isBroadQuestion = (question: string) => /\b(?:what does|what can|what features|how does|how do|walk me through|tell me about|overview|what is)\b/i.test(question);
const isComprehensiveQuestion = (question: string) => /\b(?:everything|all|full|complete|walk me through everything|major features)\b/i.test(question);
const isFollowUpQuestion = (question: string) => /^(?:what about|how about|and|can it|does it|what else|tell me more|how does that|does that|can that)\b/i.test(question);

export const selectAskLedgerProductKnowledge = (question: string, context: AskLedgerRoutingContext = {}): AskLedgerProductKnowledgeSelection => {
  const normalized = normalize(question);
  const previous = normalize(context.previousQuestion ?? (context.recentExchanges ?? []).slice(-1)[0]?.question ?? '');
  const currentAreaMatch = areaAliases.find(([, aliases]) => findAlias(normalized, aliases));
  const previousArea = context.previousProductArea as AskLedgerProductArea | undefined;
  const previousAreaMatch = areaAliases.find(([, aliases]) => findAlias(previous, aliases));
  const shorthandNotesDate = /\b(?:date stuff|date thing|recognize dates?)\b/i.test(normalized);
  const area = currentAreaMatch?.[0] ?? (shorthandNotesDate ? 'notes' : undefined) ?? previousArea ?? previousAreaMatch?.[0];
  const currentFeatureMatch = featureAliases.find((entry) => entry.area === area && findAlias(normalized, entry.aliases));
  const previousFeatureMatch = featureAliases.find((entry) => entry.area === area && findAlias(previous, entry.aliases));
  const explicitPreviousFeature = context.previousProductFeature
    ? featureAliases.find((entry) => entry.area === area && entry.feature === context.previousProductFeature)
    : undefined;
  const intentFeature = area === 'notes' && /\b(?:date stuff|date thing|dates?|recognize dates?)\b/i.test(normalized)
    ? featureAliases.find((entry) => entry.area === 'notes' && entry.feature === 'smart_dates')
    : area === 'integrations' && (context.previousProductFeature === 'github' || /\bissues?\b/i.test(normalized))
    ? featureAliases.find((entry) => entry.area === 'integrations' && entry.feature === 'github')
    : undefined;
  const featureMatch = currentFeatureMatch ?? intentFeature ?? explicitPreviousFeature ?? (isFollowUpQuestion(normalized) ? previousFeatureMatch : undefined);
  const feature = featureMatch?.feature;
  const featureFromPrevious = !currentFeatureMatch && Boolean(featureMatch);
  const explicitUnknownFeature = Boolean(area && /\b(?:feature|function|capability|command|integration|view|mode)\b/i.test(normalized) && !feature);
  let nodes: AskLedgerProductKnowledgeNode[] = [];
  if (featureMatch) {
    nodes = [nodeById.get(`${area}.${feature}`)].filter((entry): entry is AskLedgerProductKnowledgeNode => Boolean(entry));
  } else if (area && !explicitUnknownFeature && isComprehensiveQuestion(question)) {
    nodes = ASK_LEDGER_PRODUCT_KNOWLEDGE.filter((entry) => entry.area === area).slice(0, 9) as AskLedgerProductKnowledgeNode[];
  } else if (area && !explicitUnknownFeature) {
    const overview = nodeById.get(`${area}.overview`);
    if (overview && (isBroadQuestion(question) || !feature)) {
      const relatedOverviewNodes = area === 'ledger'
        ? (overview.related ?? []).map((id) => nodeById.get(id)).filter((entry): entry is AskLedgerProductKnowledgeNode => Boolean(entry)).slice(0, 6)
        : [];
      nodes = [overview, ...relatedOverviewNodes];
    }
  }
  const missingTopic = !nodes.length ? question.trim().slice(0, 160) : undefined;
  const resolutionReason = featureMatch
    ? `${currentFeatureMatch ? 'alias_match' : 'intent_match'}${featureFromPrevious ? ' + previous_product_context' : ''}`
    : currentAreaMatch
    ? 'area_alias + broad_intent'
    : area
    ? 'previous_product_context'
    : 'no_product_area_match';
  const resolutionConfidence = !nodes.length
    ? 0.22
    : currentFeatureMatch
    ? 0.96
    : featureFromPrevious
    ? 0.91
    : currentAreaMatch
    ? isComprehensiveQuestion(question) ? 0.93 : 0.88
    : 0.78;
  if (missingTopic) console.info('[local-ai] Ledger product knowledge missing', { question: missingTopic, area, feature });
  const contextLines = nodes.length
    ? nodes.map((entry) => [`Area: ${entry.area === 'ask_ledger' ? 'Ask Ledger' : entry.area[0].toUpperCase() + entry.area.slice(1)}`, `Feature: ${entry.feature ? entry.title : 'Overview'}`, '', entry.summary, entry.details].join('\n')).join('\n\n---\n\n')
    : `No authoritative Ledger product knowledge was found for this question yet: ${missingTopic ?? question.trim().slice(0, 160)}.`;
  const contextText = `LEDGER PRODUCT KNOWLEDGE\n\n${contextLines}`;
  return { area, feature, nodes, missingTopic, context: contextText, tokenCount: contextText.split(/\s+/).filter(Boolean).length, resolutionConfidence, resolutionReason };
};

export const productKnowledgeNodeIds = (selection: AskLedgerProductKnowledgeSelection) => selection.nodes.map((entry) => entry.id);

/** Deterministic overview for the broad product question fast path. */
export const formatAskLedgerProductOverview = (selection: AskLedgerProductKnowledgeSelection) => {
  const overview = selection.nodes.find((entry) => entry.id === 'ledger.overview');
  if (!overview) return selection.nodes.map((entry) => `## ${entry.title}\n\n**${entry.summary}**\n\n${entry.details}`).join('\n\n');
  return [
    '# What Ledger does',
    '',
    `**${overview.summary}**`,
    '',
    overview.details,
    '',
    '## The Ledger loop',
    '',
    '**Capture**',
    '- Get thoughts, notes, tasks, reminders, and imported items into one workspace.',
    '- Use Notes, Intake, browser capture, and integrations to preserve context before it gets lost.',
    '',
    '**Plan**',
    '- Turn captured material into projects, milestones, next actions, and dated commitments.',
    '- Keep the goal visible while tasks, notes, events, and supporting context stay connected to it.',
    '',
    '**Execute**',
    '- Work from the sidebar and project command centers without opening another heavyweight system.',
    '- Use Calendar, tasks, reminders, meeting notes, and follow-ups to decide what needs attention next.',
    '',
    '**Review**',
    '- See what moved, what is overdue or blocked, and what should happen next.',
    '- Keep progress and recent activity attached to the work instead of treating review as a separate report.',
    '',
    '## What makes Ledger different',
    '',
    '- **Sidebar-first:** Ledger stays beside the apps where work is happening, so capture and follow-through are close at hand.',
    '- **Connected context:** Projects, notes, tasks, milestones, calendar items, reminders, meetings, and integrations are designed to reinforce one another.',
    '- **Accountability over administration:** Ledger focuses on the next meaningful action and the loop back to review, not building an elaborate database.',
    '',
    '## Ask Ledger',
    '',
    'Ask Ledger is the conversational layer on top of that system. It can explain Ledger, answer questions from your workspace, synthesize connected records, and propose supported actions for your review and confirmation.',
  ].join('\n');
};

/** Render any resolved product-help selection with consistent depth and Markdown. */
export const formatAskLedgerProductHelp = (selection: AskLedgerProductKnowledgeSelection) => {
  if (!selection.nodes.length) return `# Ledger product help\n\nDetailed product knowledge is not available yet for **${selection.missingTopic ?? 'that question'}**.`;
  if (selection.nodes.some((entry) => entry.id === 'ledger.overview')) return formatAskLedgerProductOverview(selection);

  const areaLabel = selection.area === 'ask_ledger' ? 'Ask Ledger' : (selection.area ?? 'Ledger').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const primary = selection.nodes[0];
  const nodes = !primary.feature && selection.area
    ? ASK_LEDGER_PRODUCT_KNOWLEDGE.filter((entry) => entry.area === selection.area)
    : selection.nodes;
  const relatedNodes = primary.feature || nodes.length === 1
    ? (primary.related ?? [])
      .map((id) => ASK_LEDGER_PRODUCT_KNOWLEDGE.find((candidate) => candidate.id === id))
      .filter((entry): entry is AskLedgerProductKnowledgeNode => Boolean(entry))
    : [];
  const sections = nodes.map((entry) => {
    return [
      `## ${entry.title}`,
      '',
      `**${entry.summary}**`,
      '',
      entry.details,
    ].filter(Boolean).join('\n')
  });
  const connectionEntries = (primary.related ?? [])
    .map((id) => ASK_LEDGER_PRODUCT_KNOWLEDGE.find((candidate) => candidate.id === id))
    .filter((entry): entry is AskLedgerProductKnowledgeNode => Boolean(entry))
    .slice(0, 6);
  const relatedSection = connectionEntries.length
    ? [`## How ${primary.title} connects`, '', ...connectionEntries.map((entry) => `- **${entry.title}:** ${entry.summary} ${entry.details}`)].join('\n')
    : '';
  const featureRelatedSection = primary.feature && relatedNodes.length
    ? ['## Related capabilities', '', ...relatedNodes.map((entry) => `- **${entry.title}:** ${entry.summary} ${entry.details}`)].join('\n')
    : '';
  return [`# ${areaLabel} in Ledger`, '', `Here is how **${areaLabel}** supports the Ledger workflow:`, '', ...sections, relatedSection, featureRelatedSection].filter(Boolean).join('\n\n');
};
