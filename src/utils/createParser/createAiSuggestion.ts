import type { ParsedRecurrence } from './createParserTypes';

export type CreateSuggestionResource = {
  type: 'project' | 'note' | 'event' | 'task';
  id: string;
  label: string;
};

export interface AiCreateSuggestion {
  title?: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  location?: string;
  recurrence?: ParsedRecurrence;
  relatedResources?: CreateSuggestionResource[];
  confidence: 'high' | 'medium' | 'low';
  unresolved?: string[];
}

const validDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};
const validTime = (value: unknown) => typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);
const recurrenceValues = new Set(['none', 'daily', 'weekly', 'monthly', 'weekdays']);

export const parseAiCreateSuggestion = (
  text: string,
  allowedResources: CreateSuggestionResource[] = []
): AiCreateSuggestion | null => {
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
    const raw = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
    if (!['high', 'medium', 'low'].includes(String(raw.confidence))) return null;
    const duration = raw.durationMinutes;
    if (duration !== undefined && (!Number.isFinite(Number(duration)) || Number(duration) < 1 || Number(duration) > 1440)) return null;
    const recurrence = raw.recurrence === undefined ? undefined : String(raw.recurrence);
    if (recurrence && !recurrenceValues.has(recurrence)) return null;
    if (raw.date !== undefined && !validDate(raw.date)) return null;
    if (raw.time !== undefined && !validTime(raw.time)) return null;
    const allowed = new Set(allowedResources.map((resource) => `${resource.type}:${resource.id}`));
    const relatedResources = Array.isArray(raw.relatedResources)
      ? raw.relatedResources.filter((resource): resource is Record<string, unknown> => Boolean(resource) && typeof resource === 'object')
        .map((resource) => ({ type: String(resource.type), id: String(resource.id), label: String(resource.label) }))
        .filter((resource): resource is CreateSuggestionResource => allowed.has(`${resource.type}:${resource.id}`) && ['project', 'note', 'event', 'task'].includes(resource.type))
        .slice(0, 3)
      : undefined;
    return {
      title: typeof raw.title === 'string' ? raw.title.trim().slice(0, 240) || undefined : undefined,
      date: validDate(raw.date) ? (raw.date as string) : undefined,
      time: validTime(raw.time) ? (raw.time as string) : undefined,
      durationMinutes: duration === undefined ? undefined : Math.round(Number(duration)),
      location: typeof raw.location === 'string' ? raw.location.trim().slice(0, 160) || undefined : undefined,
      recurrence: recurrence as AiCreateSuggestion['recurrence'],
      relatedResources,
      confidence: raw.confidence as AiCreateSuggestion['confidence'],
      unresolved: Array.isArray(raw.unresolved) ? raw.unresolved.filter((item): item is string => typeof item === 'string').slice(0, 5) : undefined,
    };
  } catch {
    return null;
  }
};

export const shouldUseCreateAi = (input: string, deterministic: { date?: string; time?: string }) => {
  const normalized = input.toLowerCase();
  const contextualSignal = /\b(last|previous|meeting|project|team|people|after|before|from my|related to|kickoff|workday|alfa)\b/.test(normalized);
  const unresolvedTemporalSignal = /\b(later|sometime|after lunch|before the|after the|next week)\b/.test(normalized) && !deterministic.date;
  return contextualSignal || unresolvedTemporalSignal;
};
