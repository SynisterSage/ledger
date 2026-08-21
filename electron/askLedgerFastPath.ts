import type { AskLedgerContextItem, AskLedgerSource } from '../src/types/askLedgerContext.ts';

export type AskLedgerFastPathKind = 'due_today' | 'meetings' | 'overdue_count' | 'project_due' | 'task_owner' | 'recent_notes' | 'active_reminders';
export type AskLedgerFastPathResolution = 'resolved' | 'not_found' | 'ambiguous' | 'insufficient_data' | 'unsupported';
export type AskLedgerFastPathResult = { kind: AskLedgerFastPathKind; resolution: AskLedgerFastPathResolution; answer: string; items: AskLedgerContextItem[] };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const completed = (item: AskLedgerContextItem) => ['completed', 'complete', 'done', 'finished', 'cancelled', 'canceled'].includes(String(item.status ?? '').toLowerCase()) || Boolean(item.metadata?.completed);
const dateOnly = (value?: string) => {
  if (!value) return '';
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
};
const today = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const addDays = (now: Date, days: number) => { const date = new Date(now); date.setDate(date.getDate() + days); return today(date); };
const dateValue = (item: AskLedgerContextItem) => item.dueAt ?? item.timestamp ?? (typeof item.metadata?.due_date === 'string' ? item.metadata.due_date : undefined) ?? (typeof item.metadata?.end_date === 'string' ? item.metadata.end_date : undefined);
const displayDate = (value?: string) => {
  if (!value) return 'No date recorded';
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const unique = (items: AskLedgerContextItem[]) => [...new Map(items.map((item) => [`${item.resourceType}:${item.resourceId}`, item])).values()];
const sortDate = (left: AskLedgerContextItem, right: AskLedgerContextItem) => (Date.parse(dateValue(left) ?? '') || Number.MAX_SAFE_INTEGER) - (Date.parse(dateValue(right) ?? '') || Number.MAX_SAFE_INTEGER);
const owner = (item: AskLedgerContextItem) => item.metadata?.assigned_to_user_name ?? item.metadata?.assignedToUserName ?? item.metadata?.ownerName ?? item.metadata?.assigned_to_user_id ?? item.metadata?.assigned_to ?? item.metadata?.assigned_to_team_name ?? item.metadata?.assigned_to_team_id;
const titleQuery = (question: string) => (question.match(/(?:project|task)\s+(.+?)(?:[?.!,]|$)/i)?.[1] ?? '').replace(/\s+(?:due|overdue|owned|owner|is|when)\b.*$/i, '').trim();

export const resolveAskLedgerFastPath = (question: string, documents: AskLedgerContextItem[], now = new Date()): AskLedgerFastPathResult | undefined => {
  if (!documents.length) return undefined;
  const normalized = normalize(question);
  if (/\b(?:summari[sz]e|look through|recap|compare|tell me|explain)\b/.test(normalized) || /^(?:why|how(?!\s+many)|plan|review|what happened)\b/.test(normalized)) return undefined;
  const currentDay = today(now);
  if (/\b(?:how many|count)\b.*\boverdue\s+tasks?\b|\bnumber of overdue tasks\b/.test(normalized)) {
    const items = unique(documents.filter((item) => item.resourceType === 'task' && !completed(item) && dateOnly(dateValue(item)) < currentDay));
    return { kind: 'overdue_count', resolution: items.length ? 'resolved' : 'not_found', answer: items.length ? `${items.length} overdue task${items.length === 1 ? '' : 's'}.` : 'No overdue tasks.', items };
  }
  if (/\b(?:what(?:'s| is) due|due|tasks?|reminders?|milestones?)\b.*\btoday\b|\btoday'?s (?:tasks?|work|agenda)\b/.test(normalized)) {
    const items = unique(documents.filter((item) => ['task', 'milestone', 'reminder'].includes(item.resourceType) && !completed(item) && dateOnly(dateValue(item)) === currentDay)).sort(sortDate);
    return { kind: 'due_today', resolution: items.length ? 'resolved' : 'not_found', answer: items.length ? `Due today:\n${items.map((item) => `- ${item.title}${item.projectName ? ` · ${item.projectName}` : ''}`).join('\n')}` : 'Nothing is due today.', items };
  }
  if (/\b(?:what|which|next) meetings?\b|\bmeetings? do i have\b/.test(normalized)) {
    const targetDay = /\btomorrow\b/.test(normalized) ? addDays(now, 1) : undefined;
    const items = unique(documents.filter((item) => item.resourceType === 'event' && !completed(item) && (targetDay ? dateOnly(item.timestamp ?? item.dueAt) === targetDay : dateOnly(item.timestamp ?? item.dueAt) >= currentDay))).sort(sortDate).slice(0, 12);
    return { kind: 'meetings', resolution: items.length ? 'resolved' : 'not_found', answer: items.length ? `Meetings:\n${items.map((item) => `- ${item.title} — ${displayDate(item.timestamp ?? item.dueAt)}`).join('\n')}` : 'No upcoming meetings found.', items };
  }
  if (/\b(?:active|open|current) reminders?\b|\breminders?\s+(?:are|still)\s+active\b/.test(normalized)) {
    const items = unique(documents.filter((item) => item.resourceType === 'reminder' && !completed(item)));
    return { kind: 'active_reminders', resolution: items.length ? 'resolved' : 'not_found', answer: items.length ? `Active reminders:\n${items.map((item) => `- ${item.title}`).join('\n')}` : 'No active reminders.', items };
  }
  if (/\bwhen\b.*\bdue\b.*\bproject\b|\bproject\b.*\bdue\b/.test(normalized)) {
    const query = normalize(titleQuery(question));
    const items = unique(documents.filter((item) => item.resourceType === 'project' && (!query || normalize(item.title).includes(query))));
    if (items.length > 1) return { kind: 'project_due', resolution: 'ambiguous', answer: 'More than one project matches that name.', items };
    if (items.length === 1) {
      const date = dateValue(items[0]);
      return { kind: 'project_due', resolution: date ? 'resolved' : 'insufficient_data', answer: date ? `${items[0].title} is due ${displayDate(date)}.` : `${items[0].title} has no due date recorded.`, items };
    }
    return { kind: 'project_due', resolution: 'not_found', answer: 'No matching project was found.', items };
  }
  if (/\bwho\b.*\b(?:owns?|owner|responsible|assigned)\b|\b(?:owns?|owner)\b.*\btask\b/.test(normalized)) {
    const query = normalize(titleQuery(question));
    const items = unique(documents.filter((item) => item.resourceType === 'task' && (!query || normalize(item.title).includes(query))));
    if (items.length > 1) return { kind: 'task_owner', resolution: 'ambiguous', answer: 'More than one task matches that name.', items };
    if (items.length === 1) {
      const taskOwner = owner(items[0]);
      return { kind: 'task_owner', resolution: taskOwner ? 'resolved' : 'insufficient_data', answer: taskOwner ? `${items[0].title} is assigned to ${String(taskOwner)}.` : `No owner is recorded for ${items[0].title}.`, items };
    }
    return { kind: 'task_owner', resolution: 'not_found', answer: 'No matching task was found.', items };
  }
  if (/\b(?:show|list|get)\b.*\blast\s+\d+\s+notes?\b|\blast\s+\d+\s+notes?\b/.test(normalized)) {
    const count = Math.min(20, Number(normalized.match(/last\s+(\d+)/)?.[1] ?? 3));
    const items = unique(documents.filter((item) => item.resourceType === 'note')).sort((left, right) => (Date.parse(right.updatedAt ?? right.createdAt ?? '') || 0) - (Date.parse(left.updatedAt ?? left.createdAt ?? '') || 0)).slice(0, count);
    return { kind: 'recent_notes', resolution: items.length ? 'resolved' : 'not_found', answer: items.length ? `Recent notes:\n${items.map((item) => `- ${item.title}`).join('\n')}` : 'No notes found.', items };
  }
  return undefined;
};

export const fastPathSource = (item: AskLedgerContextItem): AskLedgerSource => ({ resourceType: item.resourceType, resourceId: item.resourceId, title: item.title, route: item.route, projectId: item.projectId, projectName: item.projectName, updatedAt: item.updatedAt, parentResourceId: item.parentResourceId, relationships: item.relationships });
