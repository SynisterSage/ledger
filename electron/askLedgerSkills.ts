import type { AskLedgerInitialContext, AskLedgerResourceType } from '../src/types/askLedgerContext.ts';
import type { AskLedgerActionType, AskLedgerSkillDefinition } from '../src/types/askLedgerSkills.ts';
import { isAskLedgerSkillId } from '../src/types/askLedgerSkills.ts';
import { validateAskLedgerSkillContext } from '../src/shared/askLedger/skills.ts';

const allWorkspaceContext: AskLedgerResourceType[] = ['project', 'task', 'milestone', 'note', 'event', 'reminder', 'transcript', 'intake', 'person', 'team', 'external'];

const registry: AskLedgerSkillDefinition[] = [
  {
    id: 'meeting_follow_up',
    name: 'Meeting follow-up',
    description: 'Turn a meeting or transcript into decisions, follow-ups, and actionable work.',
    icon: 'ListChecks',
    instructions: 'Prioritize the selected meeting or transcript. Identify key decisions, unresolved questions, and explicit or strongly supported action items. Associate action items with existing projects or tasks only when the supplied context supports it. Do not invent owners, dates, or commitments.',
    supportedContextTypes: ['transcript', 'event'],
    allowedContextTypes: ['transcript', 'event', 'project', 'task', 'milestone', 'note', 'reminder'],
    allowedActions: ['create_task', 'create_reminder'],
    requiresContext: true,
    requiresConfirmation: true,
    outputSections: ['Decisions', 'Unresolved questions', 'Action items', 'Follow-ups'],
    presentationProfile: 'meeting_summary',
    reasoningPolicy: 'off',
    executionContract: { resources: ['event', 'note', 'task', 'reminder', 'milestone'], timeRange: 'selected_context', retrieval: 'structured', reasoning: 'bounded', maxOutput: 448 },
  },
  {
    id: 'project_health_check',
    name: 'Project health check',
    description: 'Assess a project’s current state, risks, blockers, and next steps.',
    icon: 'FolderKanban',
    instructions: 'Assess the selected project using its status, related tasks, blockers, overdue or stale work, and recent notes or meetings when supplied. Match the requested response depth while remaining evidence-based. A low progress value is not itself a problem. Do not propose mutations.',
    supportedContextTypes: ['project'],
    allowedContextTypes: ['project', 'task', 'milestone', 'note', 'transcript', 'event', 'reminder'],
    allowedActions: [],
    requiresContext: true,
    requiresConfirmation: false,
    outputSections: ['Status', 'Blockers', 'Risks', 'Next steps'],
    presentationProfile: 'project_status',
    reasoningPolicy: 'optional',
    executionContract: { resources: ['project', 'task', 'milestone', 'note', 'event', 'reminder'], timeRange: 'selected_context', retrieval: 'structured', reasoning: 'bounded', maxOutput: 448 },
  },
  {
    id: 'plan_my_week',
    name: 'Plan my week',
    description: 'Build a grounded plan from current work, deadlines, and calendar context.',
    icon: 'CalendarDays',
    instructions: 'Review the structured weekly work, overdue open tasks, completed work in the week, milestones, reminders, and calendar commitments supplied by Ledger. Separate immediate/open work from overdue work, completed work, and upcoming commitments. Return a prioritized plan at the requested response depth based only on the supplied evidence. Do not claim that all workspace tasks were reviewed when the evidence is truncated, do not invent priorities, deadlines, blockers, or available time, and say when a category has no matching records.',
    supportedContextTypes: allWorkspaceContext,
    allowedContextTypes: allWorkspaceContext,
    allowedActions: [],
    requiresContext: false,
    requiresConfirmation: false,
    outputSections: ['Focus this week', 'Deadlines and commitments', 'Risks or blockers', 'Next steps'],
    presentationProfile: 'weekly_plan',
    reasoningPolicy: 'optional',
    executionContract: { resources: ['task', 'milestone', 'event', 'reminder'], timeRange: 'this_week', retrieval: 'structured', reasoning: 'bounded', maxOutput: 768 },
  },
  {
    id: 'turn_notes_into_tasks',
    name: 'Turn notes into tasks',
    description: 'Extract the meaningful actionable work from a note.',
    icon: 'FileText',
    instructions: 'Prioritize the selected note. Extract only explicit or strongly implied actionable work; do not turn every sentence into a task. Preserve the note’s intent and associate tasks with the selected project only when that relationship is supported.',
    supportedContextTypes: ['note'],
    allowedContextTypes: ['note', 'project', 'task', 'milestone'],
    allowedActions: ['create_task'],
    requiresContext: true,
    requiresConfirmation: true,
    outputSections: ['Action items', 'Context'],
    reasoningPolicy: 'off',
    executionContract: { resources: ['note', 'task', 'project', 'milestone'], timeRange: 'selected_context', retrieval: 'structured', reasoning: 'bounded', maxOutput: 384 },
  },
  {
    id: 'prepare_for_meeting',
    name: 'Prepare for meeting',
    description: 'Collect the relevant context, unresolved items, and discussion points for a meeting.',
    icon: 'CalendarDays',
    instructions: 'Prioritize the selected event or meeting. Gather related projects, tasks, notes, previous meetings, and relevant context. Summarize the current state, unresolved items, and useful discussion points. Do not invent an agenda or attendees.',
    supportedContextTypes: ['event'],
    allowedContextTypes: ['event', 'project', 'task', 'milestone', 'note', 'transcript', 'reminder'],
    allowedActions: [],
    requiresContext: true,
    requiresConfirmation: false,
    outputSections: ['Current context', 'Unresolved items', 'Discussion points'],
    presentationProfile: 'meeting_summary',
    reasoningPolicy: 'off',
    executionContract: { resources: ['event', 'project', 'task', 'milestone', 'note', 'reminder'], timeRange: 'selected_context', retrieval: 'structured', reasoning: 'bounded', maxOutput: 448 },
  },
];

const byId = new Map(registry.map((skill) => [skill.id, skill]));

export const getAskLedgerSkill = (skillId: unknown) => isAskLedgerSkillId(skillId) ? byId.get(skillId) : undefined;
export const listAskLedgerSkills = () => registry.map(({ instructions: _instructions, ...metadata }) => metadata);

export const validateSkillContext = (skill: AskLedgerSkillDefinition, context?: AskLedgerInitialContext | null) => {
  if (skill.requiresContext && !context) return 'This skill needs a Ledger resource as context.';
  return validateAskLedgerSkillContext(skill, context);
};

export const buildSkillPromptContext = (skill: AskLedgerSkillDefinition, explicitContext?: AskLedgerInitialContext | null) => [
  `Selected skill: ${skill.name}`,
  `Skill purpose: ${skill.description}`,
  explicitContext ? `Explicit Ledger context: ${explicitContext.resourceType} ${explicitContext.title} (${explicitContext.resourceId})` : 'Explicit Ledger context: workspace-wide',
].join('\n');

const cleanActionTitle = (value: string) => value.replace(/^[-*•\d.)\s]+/, '').replace(/[.!?]+$/, '').trim().slice(0, 240);

export type SkillActionProposal = { id: string; type: AskLedgerActionType; payload: Record<string, unknown>; sourceMessageId: string };

export const buildSkillActionProposals = (skill: AskLedgerSkillDefinition, answer: string, context: AskLedgerInitialContext | null | undefined, sourceMessageId: string): SkillActionProposal[] => {
  if (!skill.allowedActions.length) return [];
  const section = answer.match(/(?:^|\n)#{0,3}\s*(?:Action items|Next steps|Follow-ups)\s*:?\s*\n([\s\S]*?)(?=\n\s*#{0,3}\s*[A-Z][^\n:]{1,60}:?\s*(?:\n|$)|$)/i)?.[1] ?? '';
  const titles = section.split('\n')
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))
    .map(cleanActionTitle)
    .filter((title) => title.length >= 5)
    .slice(0, 8);
  if (!titles.length) return [];
  return titles.map((title, index) => ({
    id: `${sourceMessageId}-skill-action-${index}`,
    type: 'create_task' as const,
    payload: {
      title,
      ...(context?.resourceType === 'project' ? { project_id: context.resourceId } : {}),
    },
    sourceMessageId,
  })).filter((proposal) => skill.allowedActions.includes(proposal.type));
};

export const buildSkillResult = (skill: AskLedgerSkillDefinition, answer: string, context?: AskLedgerInitialContext | null) => {
  const sections = answer.trim().split(/\n(?=#{0,3}\s*[A-Z][^\n]*:?\s*$)/m).map((block) => {
    const match = block.match(/^#{0,3}\s*([^\n:]+):?\s*\n?([\s\S]*)$/);
    return match ? { title: match[1].trim(), content: match[2].trim() } : { title: 'Summary', content: block.trim() };
  }).filter((section) => section.content);
  return {
    skillId: skill.id,
    sections,
    actionProposals: buildSkillActionProposals(skill, answer, context, ''),
  };
};

export const skillRegistryForDevelopment = () => registry;
