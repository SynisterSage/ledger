import type { AskLedgerResourceType } from './askLedgerContext';

export type AskLedgerPresentationProfile = 'default' | 'weekly_plan' | 'meeting_summary' | 'project_status' | 'research_analysis';

export type AskLedgerActionType = 'create_task' | 'create_note' | 'create_reminder' | 'update_task_status';

export const ASK_LEDGER_SKILL_IDS = [
  'meeting_follow_up',
  'project_health_check',
  'plan_my_week',
  'turn_notes_into_tasks',
  'prepare_for_meeting',
] as const;

export type AskLedgerSkillId = typeof ASK_LEDGER_SKILL_IDS[number];
export type AskLedgerSkillRef = string;

export type AskLedgerCustomSkill = {
  id: string;
  name: string;
  instructions: string;
  description?: string;
  icon?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AskLedgerSkillMetadata = Omit<Pick<AskLedgerSkillDefinition, 'id' | 'name' | 'description' | 'icon' | 'supportedContextTypes' | 'requiresContext' | 'allowedActions' | 'presentationProfile'>, 'id'> & { id: AskLedgerSkillRef; isCustom?: boolean; instructions?: string };

export const ASK_LEDGER_SKILL_METADATA: AskLedgerSkillMetadata[] = [
  { id: 'meeting_follow_up', name: 'Meeting follow-up', description: 'Turn a meeting into decisions, follow-ups, and action items.', icon: 'ListChecks', supportedContextTypes: ['transcript', 'event'], allowedActions: ['create_task', 'create_reminder'], requiresContext: true, presentationProfile: 'meeting_summary' },
  { id: 'project_health_check', name: 'Project health check', description: 'Review progress, blockers, risks, and next steps.', icon: 'FolderKanban', supportedContextTypes: ['project'], allowedActions: [], requiresContext: true, presentationProfile: 'project_status' },
  { id: 'plan_my_week', name: 'Plan my week', description: 'Build a grounded plan from current work and commitments.', icon: 'CalendarDays', supportedContextTypes: ['project', 'task', 'milestone', 'note', 'event', 'reminder', 'transcript', 'intake', 'person', 'team', 'external'], allowedActions: [], requiresContext: false, presentationProfile: 'weekly_plan' },
  { id: 'turn_notes_into_tasks', name: 'Turn notes into tasks', description: 'Extract meaningful action items from a note.', icon: 'FileText', supportedContextTypes: ['note'], allowedActions: ['create_task'], requiresContext: true },
  { id: 'prepare_for_meeting', name: 'Prepare for meeting', description: 'Gather context, unresolved items, and discussion points.', icon: 'CalendarDays', supportedContextTypes: ['event'], allowedActions: [], requiresContext: true, presentationProfile: 'meeting_summary' },
];

export type AskLedgerSkillDefinition = {
  id: AskLedgerSkillId;
  name: string;
  description: string;
  icon: string;
  instructions: string;
  supportedContextTypes: AskLedgerResourceType[];
  allowedContextTypes: AskLedgerResourceType[];
  allowedActions: AskLedgerActionType[];
  requiresContext: boolean;
  requiresConfirmation: boolean;
  reasoningPolicy?: 'off' | 'optional' | 'preferred';
  outputSections?: string[];
  presentationProfile?: AskLedgerPresentationProfile;
  executionContract?: {
    resources: AskLedgerResourceType[];
    timeRange: 'this_week' | 'selected_context' | 'workspace';
    retrieval: 'structured' | 'hybrid' | 'semantic';
    reasoning: 'off' | 'bounded';
    maxOutput: number;
  };
};

export const isAskLedgerSkillId = (value: unknown): value is AskLedgerSkillId =>
  typeof value === 'string' && (ASK_LEDGER_SKILL_IDS as readonly string[]).includes(value);
