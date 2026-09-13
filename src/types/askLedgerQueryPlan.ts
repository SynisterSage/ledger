import type { AskLedgerResourceType } from './askLedgerContext.ts';

export type AskLedgerQueryCategory =
  | 'projects'
  | 'tasks'
  | 'milestones'
  | 'events'
  | 'notes'
  | 'reminders'
  | 'attachments'
  | 'integrations'
  | 'activity'
  | 'notifications';

export type AskLedgerQueryOperation = 'lookup' | 'summarize' | 'analyze' | 'compare' | 'plan';

export type AskLedgerQueryPlan = {
  version: 1;
  question: string;
  operation: AskLedgerQueryOperation;
  categories: AskLedgerQueryCategory[];
  entity?: { type?: AskLedgerResourceType; name: string; confidence: 'explicit' | 'inferred' };
  attachment?: { nameHint?: string; kind?: 'syllabus' | 'pdf' | 'document' | 'file'; confidence: 'explicit' | 'inferred' };
  temporal?: { kind: 'today' | 'tomorrow' | 'yesterday' | 'this_week' | 'next_week' | 'recent' };
  followUp: { likely: boolean; reference?: string; confidence: 'high' | 'medium' | 'low' };
  ambiguity: { detected: boolean; reasons: string[] };
};

const normalize = (value: string) => value.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();

const unique = <T>(values: T[]) => [...new Set(values)];

const operationFor = (question: string): AskLedgerQueryOperation => {
  const normalized = normalize(question);
  if (/\b(compare|versus|vs|difference)\b/.test(normalized)) return 'compare';
  if (/\b(summarize|summary|recap|look through|review)\b/.test(normalized)) return 'summarize';
  if (/\b(analy[sz]e|where things stand|what changed|blocking|blocked)\b/.test(normalized)) return 'analyze';
  if (/\b(plan|prioritize|what should|next actions?|next steps?)\b/.test(normalized)) return 'plan';
  return 'lookup';
};

const categoriesFor = (question: string): AskLedgerQueryCategory[] => {
  const normalized = normalize(question);
  const categories: AskLedgerQueryCategory[] = [];
  if (/\bprojects?\b|\bproject work\b|\bwhat still needs to happen\b/.test(normalized)) categories.push('projects');
  if (/\b(tasks?|todos?|to dos?|next actions?|action items?|what do i need to do)\b/.test(normalized)) categories.push('tasks');
  if (/\bmilestones?|checkpoints?\b/.test(normalized)) categories.push('milestones');
  if (/\b(events?|meetings?|calendar)\b|\bnext\s+(?:class|meeting)\b|\bupcoming\s+(?:class|meeting|event)\b/.test(normalized)) categories.push('events');
  if (/\bnotes?|transcripts?\b/.test(normalized)) categories.push('notes');
  if (/\breminders?\b/.test(normalized)) categories.push('reminders');
  if (/\b(files?|pdfs?|documents?|attachments?|folders?)\b/.test(normalized)) categories.push('attachments');
  if (/\b(slack|github|figma|drive|integration|circle)\b/.test(normalized)) categories.push('integrations');
  if (/\b(activity|what changed|changes|happening)\b/.test(normalized)) categories.push('activity');
  if (/\bnotifications?|alerts?\b/.test(normalized)) categories.push('notifications');
  return unique(categories);
};

const entityFor = (question: string) => {
  const explicit = question.match(/\b(?:for|about|on|with)\s+(?:my|the)?\s*([A-Za-z][A-Za-z0-9'-]*(?:\s+[A-Za-z][A-Za-z0-9'-]*){0,5}?)(?=\s+(?:project|projects|tasks?|events?|meetings?|notes?|reminders?|pdf|file|and|what|where|when|how|$))/i);
  if (!explicit?.[1]) return undefined;
  const name = explicit[1].trim();
  return name.length >= 3 ? { name, confidence: 'explicit' as const } : undefined;
};

const attachmentFor = (question: string) => {
  const normalized = normalize(question);
  if (!/\b(files?|pdfs?|documents?|attachments?|syllabus)\b/.test(normalized)) return undefined;
  const kind = /\bsyllabus\b/.test(normalized) ? 'syllabus' as const : /\bpdfs?\b/.test(normalized) ? 'pdf' as const : /\bdocuments?\b/.test(normalized) ? 'document' as const : 'file' as const;
  return { kind, confidence: 'explicit' as const };
};

export const buildAskLedgerQueryPlan = (question: string): AskLedgerQueryPlan => {
  const normalized = normalize(question);
  const categories = categoriesFor(question);
  const reference = normalized.match(/\b(that|this|it|those|these|what about|how about)\b/)?.[1];
  const temporal = normalized.includes('tomorrow') ? 'tomorrow' as const
    : normalized.includes('yesterday') ? 'yesterday' as const
      : normalized.includes('next week') ? 'next_week' as const
        : normalized.includes('this week') || normalized.includes('my week') ? 'this_week' as const
          : /\b(recent|latest|last|newest)\b/.test(normalized) ? 'recent' as const : undefined;
  const entity = entityFor(question);
  const ambiguityReasons: string[] = [];
  if (reference && !entity && categories.length === 0) ambiguityReasons.push('unresolved_reference');
  if (reference && categories.length > 1) ambiguityReasons.push('reference_with_multiple_categories');
  return {
    version: 1,
    question,
    operation: operationFor(question),
    categories,
    ...(entity ? { entity } : {}),
    ...(attachmentFor(question) ? { attachment: attachmentFor(question) } : {}),
    ...(temporal ? { temporal: { kind: temporal } } : {}),
    followUp: { likely: Boolean(reference), ...(reference ? { reference } : {}), confidence: entity ? 'high' : reference ? 'medium' : 'low' },
    ambiguity: { detected: ambiguityReasons.length > 0, reasons: ambiguityReasons },
  };
};
