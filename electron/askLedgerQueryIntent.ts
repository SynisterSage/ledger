export type AskLedgerQueryIntent = {
  kind:
    | 'greeting'
    | 'team_members'
    | 'projects'
    | 'tasks'
    | 'milestones'
    | 'followups'
    | 'reminders'
    | 'events'
    | 'open_actions'
    | 'blockers'
    | 'deadlines'
    | 'time_window'
    | 'status'
    | 'project_review'
    | 'recent_updates'
    | 'meeting_prep'
    | 'integration'
    | 'general';
  window?: { start: string; end: string };
};

export type AskLedgerEntityResourceType =
  | 'project'
  | 'task'
  | 'milestone'
  | 'reminder'
  | 'event'
  | 'person'
  | 'team'
  | 'note'
  | 'transcript'
  | 'intake'
  | 'external';

const normalizeGreeting = (question: string) => question
  .toLowerCase()
  .replace(/[’']/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfWeek = (date: Date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  return result;
};

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const detectAskLedgerQueryIntent = (question: string, now = new Date()): AskLedgerQueryIntent => {
  const normalized = question.toLowerCase().replace(/[’']/g, '').trim();
  const greeting = normalizeGreeting(question);
  if (/^(hi|hello|hey|yo)(?: there| again)?(?: (?:mr|mister) ledger| ledger)?$/.test(greeting)
    || /^good (?:morning|afternoon|evening)(?: (?:mr|mister) ledger| ledger)?$/.test(greeting)
    || /^(?:hi|hello|hey|yo)(?: there)?(?: (?:mr|mister) ledger| ledger)? (?:how are you|whats up|how is it going)$/.test(greeting)
    || /^(how are you|whats up|whats up with (?:you|u)|whats on (?:your|ur) mind|how is it going|im good|im doing well|thanks|thank you|cool|nice|okay|ok)(?: (?:mr|mister) ledger| ledger)?$/.test(greeting)
    || /^(?:nothing much|not much)(?: (?:ur|your|whats up|whats up with (?:you|u)))?(?: (?:ur|your|whats up|whats up with (?:you|u)))?$/.test(greeting)
    || /^(?:how have you been|hows your day|how is your day|you good|you okay|are you there|can you hear me|good to see you|nice to see you)(?: (?:mr|mister) ledger| ledger)?$/.test(greeting)
    || /^(?:who are you|what are you|what can you do|what do you do|tell me about yourself|are you ai|are you real|are you a robot)(?: (?:mr|mister) ledger| ledger)?$/.test(greeting)
    || /^(?:can you help me|could you help me|i need help|i need some help|help me please|help please)(?: (?:mr|mister) ledger| ledger)?$/.test(greeting)
    || /^(?:bye|goodbye|good bye|see you|talk to you later|later|catch you later)(?: (?:mr|mister) ledger| ledger)?$/.test(greeting)
    || /^(?:thx|thanks a lot|thank you so much|appreciate it|much appreciated|got it|sounds good|great|awesome|perfect|alright|all right|haha|lol)(?: (?:mr|mister) ledger| ledger)?$/.test(greeting)) {
    return { kind: 'greeting' };
  }
  const asksAboutExistingKnowledge = /\b(what did .*\b(discuss|say|decide|mention)|where did .*\b(discuss|say|decide|mention)|what was decided|what have we discussed)\b/.test(normalized);
  if (/\b(my team|team members|members of (the )?team|who (is|are) (on|in) (the )?team|who.*team)\b/.test(normalized)) {
    return { kind: 'team_members' };
  }
  if (/\b(deadline|deadlines|deadliens|due date|due dates|when is .* due|when are .* due)\b/.test(normalized)) {
    return { kind: 'deadlines' };
  }
  if (/\b(recent(?:ly)?|lately|latest|newest|what changed|changed recently|important updates?)\b/.test(normalized)
    && /\b(changed|change|updated?|updates?|happened|important|workspace|activity)\b/.test(normalized)) {
    return { kind: 'recent_updates' };
  }
  if (/\b(github|git hub|slack|figma|circle|integration|integrations|intake|pull requests?|issues?)\b/.test(normalized)) {
    return { kind: 'integration' };
  }
  if (/\b(prepare|prep|get ready|brief)\b/.test(normalized) && /\b(meeting|meetings|call|calls)\b/.test(normalized)) {
    return { kind: 'meeting_prep' };
  }
  if (/\b(review|assess|check|audit)\b/.test(normalized) && /\bprojects?\b/.test(normalized)
    || (/\b(projects?|portfolio)\b/.test(normalized) && /\b(moving|blocked|stuck|needs? attention|at risk|health)\b/.test(normalized))) {
    return { kind: 'project_review' };
  }
  if (!asksAboutExistingKnowledge && (/\b(what|which|show|list|my|have|active|current)\b.*\b(projects?|portfolio)\b/.test(normalized) || /\b(projects?|portfolio)\b.*\b(do i have|show|list|status|active|current)\b/.test(normalized))) {
    return { kind: 'projects' };
  }
  if (/\b(reminders?|remind me)\b/.test(normalized)) {
    return { kind: 'reminders' };
  }
  if (/\b(milestones?|checkpoints?)\b/.test(normalized)) {
    return { kind: 'milestones' };
  }
  if (/\b(follow[- ]?ups?|came from (a )?meeting|meeting actions?)\b/.test(normalized)) {
    return { kind: 'followups' };
  }
  if (!asksAboutExistingKnowledge && (/\b(meetings?|events?)\b/.test(normalized) || /\b(calendar|schedule)\b.*\b(upcoming|today|this week|next week|event|meeting)\b/.test(normalized))) {
    return { kind: 'events' };
  }
  if (/\b(open tasks?|todos?|to dos?|to-do|actions?|things to do|what do i need to do)\b/.test(normalized)) {
    return { kind: 'open_actions' };
  }
  if (/\b(tasks?)\b/.test(normalized)) {
    return { kind: 'tasks' };
  }
  if (/\b(blocked|blocking|stuck|in the way|what is holding|whats holding)\b/.test(normalized)) {
    return { kind: 'blockers' };
  }
  const week = startOfWeek(now);
  if (/\b(this week|this weeks|this week s)\b/.test(normalized)) {
    return { kind: 'time_window', window: { start: isoDate(week), end: isoDate(addDays(week, 6)) } };
  }
  if (/\b(next week|next weeks|next week s)\b/.test(normalized)) {
    const next = addDays(week, 7);
    return { kind: 'time_window', window: { start: isoDate(next), end: isoDate(addDays(next, 6)) } };
  }
  if (/\b(today|todays|tomorrow|upcoming|planned|plan)\b/.test(normalized) || /\b(what|when|show|list)\b.*\b(schedule|calendar)\b/.test(normalized)) {
    return { kind: 'time_window' };
  }
  if (/\b(status|progress|blocked|blocking|stuck|current state)\b/.test(normalized)) {
    return { kind: 'status' };
  }
  return { kind: 'general' };
};

export const resourceTypesForAskLedgerIntent = (
  intent: AskLedgerQueryIntent
): AskLedgerEntityResourceType[] | null => {
  switch (intent.kind) {
    case 'team_members':
      return ['person', 'team'];
    case 'projects':
      return ['project'];
    case 'tasks':
      return ['task'];
    case 'milestones':
      return ['milestone'];
    case 'followups':
      return ['task', 'reminder', 'event', 'note', 'transcript'];
    case 'reminders':
      return ['reminder'];
    case 'events':
      return ['event'];
    case 'open_actions':
      return ['task', 'reminder'];
    case 'blockers':
      return ['project', 'task', 'note', 'transcript'];
    case 'deadlines':
      return ['task', 'milestone', 'project', 'event', 'reminder'];
    case 'time_window':
      return ['task', 'event', 'reminder'];
    case 'status':
      return ['project', 'task'];
    case 'project_review':
      return ['project', 'task', 'milestone', 'note', 'event', 'reminder'];
    case 'recent_updates':
      return ['project', 'task', 'milestone', 'note', 'event', 'reminder', 'transcript', 'intake'];
    case 'meeting_prep':
      return ['project', 'task', 'milestone', 'note', 'event', 'reminder', 'transcript', 'intake'];
    case 'integration':
      return ['project', 'task', 'note', 'event', 'reminder', 'intake', 'external'];
    default:
      return null;
  }
};
