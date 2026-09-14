import type { AskLedgerActionType } from '../../types/askLedgerSkills.ts';

export type AskLedgerToolKind = 'read' | 'compute' | 'write';
export type AskLedgerToolSurface =
  | 'ask_ledger'
  | 'footer_agent'
  | 'projects_ask'
  | 'project_lens'
  | 'overview_lens'
  | 'notes_ask'
  | 'files_ask';

/** Safe, user-visible run metadata. Never include raw tool arguments here. */
export type AskLedgerToolActivity = {
  toolName: string;
  kind: AskLedgerToolKind;
  status: 'completed' | 'rejected' | 'failed';
  sourceCount: number;
};

export type AskLedgerJsonSchema = {
  type: 'object';
  properties: Record<
    string,
    { type: string; description?: string; enum?: string[]; nullable?: boolean }
  >;
  required: string[];
  additionalProperties: false;
};

export type AskLedgerToolDefinition = {
  name: string;
  kind: AskLedgerToolKind;
  description: string;
  inputSchema: AskLedgerJsonSchema;
  surfaces: AskLedgerToolSurface[];
  requiredScopes: string[];
  requiresConfirmation: boolean;
  idempotent: boolean;
  implementation: 'desktop_existing' | 'mcp_existing' | 'deterministic_planned';
};

const resourceId = (description: string) => ({ type: 'string', description });
const schema = (
  properties: AskLedgerJsonSchema['properties'],
  required: string[] = []
): AskLedgerJsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const allReadSurfaces: AskLedgerToolSurface[] = [
  'ask_ledger',
  'footer_agent',
  'project_lens',
  'overview_lens',
  'notes_ask',
  'files_ask',
];
const workspaceSurfaces: AskLedgerToolSurface[] = ['ask_ledger', 'overview_lens'];
const projectSurfaces: AskLedgerToolSurface[] = ['ask_ledger', 'projects_ask', 'project_lens'];
const noteSurfaces: AskLedgerToolSurface[] = ['ask_ledger', 'notes_ask', 'files_ask'];

export const ASK_LEDGER_TOOL_DEFINITIONS: AskLedgerToolDefinition[] = [
  {
    name: 'get_today',
    kind: 'read',
    description: 'Read bounded Today context for the active workspace.',
    inputSchema: schema({
      date: { type: 'string', description: 'ISO date, when a specific day is requested.' },
    }),
    surfaces: workspaceSurfaces,
    requiredScopes: ['daily:read'],
    requiresConfirmation: false,
    idempotent: true,
    implementation: 'mcp_existing',
  },
  {
    name: 'search_workspace',
    kind: 'read',
    description: 'Search approved workspace records and return bounded, source-linked results.',
    inputSchema: schema(
      {
        query: { type: 'string', description: 'The focused search query.' },
        limit: { type: 'number', description: 'Maximum number of results.' },
      },
      ['query']
    ),
    surfaces: allReadSurfaces,
    requiredScopes: ['workspace:read'],
    requiresConfirmation: false,
    idempotent: true,
    implementation: 'desktop_existing',
  },
  {
    name: 'get_project_context',
    kind: 'read',
    description:
      'Read one project with its directly linked tasks, milestones, notes, events, reminders, and activity.',
    inputSchema: schema({ projectId: resourceId('The project ID.') }, ['projectId']),
    surfaces: projectSurfaces,
    requiredScopes: ['projects:read'],
    requiresConfirmation: false,
    idempotent: true,
    implementation: 'desktop_existing',
  },
  {
    name: 'get_note_context',
    kind: 'read',
    description: 'Read one note and its approved linked context.',
    inputSchema: schema(
      {
        noteId: resourceId('The note ID.'),
        includeContent: { type: 'boolean', description: 'Whether bounded note content is needed.' },
      },
      ['noteId']
    ),
    surfaces: noteSurfaces,
    requiredScopes: ['notes:read'],
    requiresConfirmation: false,
    idempotent: true,
    implementation: 'mcp_existing',
  },
  {
    name: 'list_tasks',
    kind: 'read',
    description: 'List bounded tasks for the active workspace or selected project.',
    inputSchema: schema({
      projectId: resourceId('Optional project filter.'),
      status: { type: 'string', description: 'Optional task status filter.' },
      limit: { type: 'number', description: 'Maximum number of tasks.' },
    }),
    surfaces: allReadSurfaces,
    requiredScopes: ['tasks:read'],
    requiresConfirmation: false,
    idempotent: true,
    implementation: 'mcp_existing',
  },
  {
    name: 'list_upcoming_events',
    kind: 'read',
    description: 'List bounded events and reminders in a requested date window.',
    inputSchema: schema({
      from: { type: 'string', description: 'ISO start date.' },
      to: { type: 'string', description: 'ISO end date.' },
      limit: { type: 'number', description: 'Maximum number of results.' },
    }),
    surfaces: allReadSurfaces,
    requiredScopes: ['calendar:read'],
    requiresConfirmation: false,
    idempotent: true,
    implementation: 'mcp_existing',
  },
  {
    name: 'compute_daily_plan',
    kind: 'compute',
    description: 'Rank available focus candidates against Today commitments and open work.',
    inputSchema: schema(
      {
        date: { type: 'string', description: 'ISO date for the plan.' },
        maxFocusItems: { type: 'number', description: 'Maximum focus items, normally 1 to 3.' },
      },
      ['date']
    ),
    surfaces: ['ask_ledger', 'overview_lens'],
    requiredScopes: ['daily:read', 'tasks:read', 'calendar:read'],
    requiresConfirmation: false,
    idempotent: true,
    implementation: 'deterministic_planned',
  },
  {
    name: 'find_project_blockers',
    kind: 'compute',
    description:
      'Identify evidence-backed blockers, stale work, and missing next actions for a project.',
    inputSchema: schema({ projectId: resourceId('The project ID.') }, ['projectId']),
    surfaces: projectSurfaces,
    requiredScopes: ['projects:read', 'tasks:read'],
    requiresConfirmation: false,
    idempotent: true,
    implementation: 'deterministic_planned',
  },
  {
    name: 'create_task',
    kind: 'write',
    description: 'Create one shared Ledger task in the active workspace.',
    inputSchema: schema(
      {
        title: { type: 'string', description: 'Task title.' },
        projectId: resourceId('Optional project ID.'),
        dueDate: { type: 'string', description: 'Optional ISO due date.' },
        priority: { type: 'string', description: 'Optional task priority.' },
        idempotencyKey: { type: 'string', description: 'Stable key for safe retries.' },
      },
      ['title', 'idempotencyKey']
    ),
    surfaces: ['ask_ledger', 'projects_ask', 'project_lens', 'overview_lens', 'notes_ask', 'files_ask'],
    requiredScopes: ['tasks:write'],
    requiresConfirmation: true,
    idempotent: true,
    implementation: 'mcp_existing',
  },
  {
    name: 'update_task',
    kind: 'write',
    description: 'Update bounded planning fields on an existing Ledger task.',
    inputSchema: schema(
      {
        taskId: resourceId('The task ID.'),
        status: { type: 'string', description: 'Optional new task status.' },
        dueDate: { type: 'string', description: 'Optional ISO due date.' },
        expectedUpdatedAt: { type: 'string', description: 'Expected revision timestamp.' },
        idempotencyKey: { type: 'string', description: 'Stable key for safe retries.' },
      },
      ['taskId', 'idempotencyKey']
    ),
    surfaces: ['ask_ledger', 'projects_ask', 'project_lens', 'overview_lens', 'notes_ask', 'files_ask'],
    requiredScopes: ['tasks:write'],
    requiresConfirmation: true,
    idempotent: true,
    implementation: 'mcp_existing',
  },
  {
    name: 'create_note',
    kind: 'write',
    description: 'Create a plain-text shared Ledger note.',
    inputSchema: schema(
      {
        title: { type: 'string', description: 'Note title.' },
        content: { type: 'string', description: 'Bounded note content.' },
        projectId: resourceId('Optional project ID.'),
        idempotencyKey: { type: 'string', description: 'Stable key for safe retries.' },
      },
      ['title', 'idempotencyKey']
    ),
    surfaces: ['ask_ledger', 'notes_ask', 'files_ask'],
    requiredScopes: ['notes:write'],
    requiresConfirmation: true,
    idempotent: true,
    implementation: 'mcp_existing',
  },
  {
    name: 'create_reminder',
    kind: 'write',
    description: 'Create a shared Ledger reminder.',
    inputSchema: schema(
      {
        title: { type: 'string', description: 'Reminder title.' },
        remindAt: { type: 'string', description: 'ISO reminder timestamp.' },
        projectId: resourceId('Optional project ID.'),
        idempotencyKey: { type: 'string', description: 'Stable key for safe retries.' },
      },
      ['title', 'remindAt', 'idempotencyKey']
    ),
    surfaces: ['ask_ledger', 'project_lens', 'overview_lens', 'notes_ask', 'files_ask'],
    requiredScopes: ['daily:write'],
    requiresConfirmation: true,
    idempotent: true,
    implementation: 'desktop_existing',
  },
];

const toolsByName = new Map(ASK_LEDGER_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

export const getAskLedgerTool = (name: string) => toolsByName.get(name);

export const listAskLedgerTools = (
  options: { surface?: AskLedgerToolSurface; includeWrites?: boolean } = {}
) =>
  ASK_LEDGER_TOOL_DEFINITIONS.filter(
    (tool) =>
      (!options.surface || tool.surfaces.includes(options.surface)) &&
      (options.includeWrites === true || tool.kind !== 'write')
  );

export const toolNameForAskLedgerAction = (type: AskLedgerActionType) =>
  ({
    create_task: 'create_task',
    create_note: 'create_note',
    create_reminder: 'create_reminder',
    update_task_status: 'update_task',
  }[type]);
