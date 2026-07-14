import { format, isValid, parse } from 'date-fns';

export type SmartDateState = 'detected' | 'linked-event' | 'linked-reminder' | 'dismissed';

export type SmartDateMatch = {
  phrase: string;
  resolvedDate: Date;
  hasExplicitTime: boolean;
  source: 'relative' | 'weekday' | 'named' | 'numeric';
  startOffset: number;
  endOffset: number;
};

export type SmartDateComposerContext = {
  sourceKey: string;
  sourceText: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  noteId: string;
  noteTitle: string;
  noteProjectId?: string | null;
  resolvedDateISO: string;
  hasExplicitTime: boolean;
  suggestedTitle: string;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const SHORT_MONTHS = MONTHS.map((month) => month.slice(0, 3));

const PART_OF_DAY_TO_TIME: Record<string, { hour: number; minute: number }> = {
  morning: { hour: 9, minute: 0 },
  afternoon: { hour: 15, minute: 0 },
  evening: { hour: 18, minute: 0 },
  night: { hour: 20, minute: 0 },
};

const ORDINAL_SUFFIX = '(?:st|nd|rd|th)';

const DATE_ONLY_PATTERNS: Array<{ regex: RegExp; kind: SmartDateMatch['source'] }> = [
  {
    regex: /\b(?:today|tomorrow)\b/gi,
    kind: 'relative',
  },
  {
    regex:
      /\b(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi,
    kind: 'weekday',
  },
  {
    regex:
      new RegExp(
        `\\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\s+\\d{1,2}(?:${ORDINAL_SUFFIX})?(?:,?\\s+\\d{4})?\\b`,
        'gi'
      ),
    kind: 'named',
  },
  {
    regex: new RegExp(
      `\\b\\d{1,2}(?:${ORDINAL_SUFFIX})?[\\/.-]\\d{1,2}(?:${ORDINAL_SUFFIX})?(?:[\\/.-]\\d{2,4})?\\b`,
      'gi'
    ),
    kind: 'numeric',
  },
];

const TIME_PATTERN = /^(?:\s*(?:at\s+)?)?(morning|afternoon|evening|night|\d{1,2}(?::\d{2})?\s?(?:am|pm)?|\d{1,2}:\d{2})(?:\b|$)/i;
const SENTENCE_SPLIT_PATTERN = /[.!?]\s+/;

export const getSmartDateNow = () => new Date();

export const formatSmartDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

const normalizeText = (value: string) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const stripOrdinalSuffixes = (value: string) =>
  String(value ?? '').replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1');

const inferNumericDateOrder = (locale: string) => {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date(2006, 0, 2));
    const monthIndex = parts.findIndex((part) => part.type === 'month');
    const dayIndex = parts.findIndex((part) => part.type === 'day');
    return monthIndex >= 0 && dayIndex >= 0 && monthIndex < dayIndex ? 'mdy' : 'dmy';
  } catch {
    return 'mdy';
  }
};

const getLocale = () => {
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'en-US';
};

const getLocalDate = (source: Date) =>
  new Date(source.getFullYear(), source.getMonth(), source.getDate(), source.getHours(), source.getMinutes(), 0, 0);

const addDays = (base: Date, days: number) => {
  const next = getLocalDate(base);
  next.setDate(next.getDate() + days);
  return next;
};

const setTimeOnDate = (base: Date, hour: number, minute: number) => {
  const next = getLocalDate(base);
  next.setHours(hour, minute, 0, 0);
  return next;
};

const nextWeekday = (base: Date, weekday: number, includeToday = false) => {
  const next = getLocalDate(base);
  const current = next.getDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  next.setDate(next.getDate() + delta);
  return next;
};

const resolveNamedMonthDate = (value: string, now: Date) => {
  const normalized = stripOrdinalSuffixes(normalizeText(value)).toLowerCase();
  const parsed = parse(normalized.replace(/\s+/g, ' '), 'MMMM d yyyy', now);
  if (isValid(parsed)) return parsed;

  const parsedShort = parse(normalized.replace(/\s+/g, ' '), 'MMM d yyyy', now);
  if (isValid(parsedShort)) return parsedShort;

  const monthMatch = normalized.match(
    /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/
  );
  if (!monthMatch) return null;

  const monthName = monthMatch[1];
  const day = Number(monthMatch[2]);
  const year = monthMatch[3] ? Number(monthMatch[3]) : now.getFullYear();
  const monthIndex = [...MONTHS, ...SHORT_MONTHS].indexOf(monthName);
  if (monthIndex < 0) return null;

  const normalizedMonth = monthIndex >= 12 ? monthIndex - 12 : monthIndex;
  let candidate = new Date(year, normalizedMonth, day, 0, 0, 0, 0);
  if (!monthMatch[3] && candidate.getTime() < now.getTime()) {
    candidate = new Date(year + 1, normalizedMonth, day, 0, 0, 0, 0);
  }
  return candidate;
};

const resolveNumericDate = (value: string, now: Date) => {
  const normalized = stripOrdinalSuffixes(normalizeText(value));
  const match = normalized.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (!match) return null;

  const localeOrder = inferNumericDateOrder(getLocale());
  const first = Number(match[1]);
  const second = Number(match[2]);
  const thirdRaw = match[3] ? Number(match[3]) : null;

  let month = localeOrder === 'mdy' ? first : second;
  let day = localeOrder === 'mdy' ? second : first;
  let year = thirdRaw ?? now.getFullYear();

  if (thirdRaw !== null && match[3].length === 2) {
    year = 2000 + thirdRaw;
  }

  if (localeOrder === 'dmy' && first > 12 && second <= 12) {
    month = second;
    day = first;
  } else if (localeOrder === 'mdy' && second > 12 && first <= 12) {
    month = first;
    day = second;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let candidate = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (thirdRaw === null && candidate.getTime() < now.getTime()) {
    candidate = new Date(year + 1, month - 1, day, 0, 0, 0, 0);
  }
  return candidate;
};

const resolveRelativeDate = (value: string, now: Date) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'today') return getLocalDate(now);
  if (normalized === 'tomorrow') return addDays(now, 1);

  const weekdayMatch = normalized.match(/^(next|this)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (!weekdayMatch) return null;

  const modifier = weekdayMatch[1] ?? null;
  const weekdayName = weekdayMatch[2];
  const weekday = WEEKDAY_INDEX[weekdayName];
  if (typeof weekday !== 'number') return null;

  if (modifier === 'this') {
    const candidate = nextWeekday(now, weekday, true);
    return candidate.getTime() < now.getTime() ? addDays(candidate, 7) : candidate;
  }

  return nextWeekday(now, weekday, true);
};

const resolveExplicitTime = (value: string) => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return null;

  if (PART_OF_DAY_TO_TIME[normalized]) {
    return { ...PART_OF_DAY_TO_TIME[normalized], explicit: false };
  }

  const timeMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
  const meridiem = timeMatch[3]?.toLowerCase() ?? null;
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && hour > 23) return null;
  if (!meridiem && hour < 8) {
    // Treat bare early-morning hours as ambiguous unless the context explicitly asked for time.
    return { hour, minute, explicit: true };
  }

  return { hour, minute, explicit: Boolean(meridiem || timeMatch[2] || hour >= 8) };
};

const parseCandidate = (phrase: string, now: Date): SmartDateMatch | null => {
  const original = normalizeText(phrase);
  const trimmed = stripOrdinalSuffixes(original);
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const dateMatchers: Array<{
    kind: 'relative' | 'weekday' | 'named' | 'numeric';
    value: string;
    resolved: Date | null;
  }> = [
    { kind: 'relative', value: trimmed, resolved: resolveRelativeDate(trimmed, now) },
    {
      kind: 'named',
      value: trimmed,
      resolved: resolveNamedMonthDate(trimmed, now),
    },
    {
      kind: 'numeric',
      value: trimmed,
      resolved: resolveNumericDate(trimmed, now),
    },
  ];

  const weekdayOnly = lower.match(/^(next|this)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (weekdayOnly) {
      dateMatchers.unshift({
        kind: 'weekday',
        value: trimmed,
        resolved: resolveRelativeDate(trimmed, now),
      });
  }

  for (const match of dateMatchers) {
    if (!match.resolved) continue;
    const remaining = lower.slice(match.value.length);
    const timeMatch = remaining.match(TIME_PATTERN);
    if (timeMatch?.[1]) {
      const resolvedTime = resolveExplicitTime(timeMatch[1]);
      if (resolvedTime) {
        const resolved = setTimeOnDate(match.resolved, resolvedTime.hour, resolvedTime.minute);
        return {
          phrase: original,
          resolvedDate: resolved,
          hasExplicitTime: true,
          source: match.kind === 'weekday' ? 'weekday' : match.kind,
          startOffset: 0,
          endOffset: original.length,
        };
      }
    }

    return {
      phrase: original,
      resolvedDate: match.resolved,
      hasExplicitTime: false,
      source: match.kind === 'weekday' ? 'weekday' : match.kind,
      startOffset: 0,
      endOffset: original.length,
    };
  }

  return null;
};

export const findSmartDateMatch = (value: string, now = getSmartDateNow()): SmartDateMatch | null => {
  const text = String(value ?? '');
  if (!text.trim()) return null;

  const matches: Array<SmartDateMatch & { absoluteStart: number }> = [];

  for (const pattern of DATE_ONLY_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text))) {
      const raw = match[0];
      const after = text.slice(match.index + raw.length);
      const suffixMatch = after.match(TIME_PATTERN);
      const candidate = suffixMatch?.[1]
        ? `${raw}${suffixMatch[0]}`
        : raw;
      const resolved = parseCandidate(candidate, now);
      if (!resolved) continue;
      matches.push({
        ...resolved,
        absoluteStart: match.index,
        startOffset: match.index,
        endOffset: match.index + resolved.endOffset,
      });
      if (raw.length === 0) break;
    }
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    if (a.absoluteStart !== b.absoluteStart) return a.absoluteStart - b.absoluteStart;
    const aLength = a.endOffset - a.startOffset;
    const bLength = b.endOffset - b.startOffset;
    return bLength - aLength;
  });

  const first = matches[0];
  return {
    phrase: first.phrase,
    resolvedDate: first.resolvedDate,
    hasExplicitTime: first.hasExplicitTime,
    source: first.source,
    startOffset: first.startOffset,
    endOffset: first.endOffset,
  };
};

export const formatSmartDateResolution = (resolvedDate: Date, hasExplicitTime: boolean) => {
  const datePart = new Intl.DateTimeFormat(getLocale(), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: resolvedDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  }).format(resolvedDate);

  if (!hasExplicitTime) return datePart;

  const timePart = new Intl.DateTimeFormat(getLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  }).format(resolvedDate);
  return `${datePart} · ${timePart}`;
};

export const buildSmartDateA11yLabel = (phrase: string, resolvedDate: Date, hasExplicitTime: boolean) =>
  `Date detected: ${normalizeText(phrase)}. Resolved as ${formatSmartDateResolution(resolvedDate, hasExplicitTime)}`;

export const stripPhraseFromSentence = (sentence: string, phrase: string) => {
  const source = normalizeText(sentence);
  const target = normalizeText(phrase);
  if (!source || !target) return source;

  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return normalizeText(source.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'i'), ' '));
};

export const findSentenceContainingRange = (text: string, startOffset: number, endOffset: number) => {
  const source = String(text ?? '');
  if (!source) return '';

  const parts = source.split(SENTENCE_SPLIT_PATTERN);
  let cursor = 0;
  for (const part of parts) {
    const start = cursor;
    const end = cursor + part.length;
    if (startOffset >= start && endOffset <= end) {
      return part.trim();
    }
    cursor = end + 1;
  }

  return source.trim();
};

export const createSmartDateComposerContext = (args: {
  sourceKey: string;
  sourceText: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  noteId: string;
  noteTitle: string;
  noteProjectId?: string | null;
  resolvedDate: Date;
  hasExplicitTime: boolean;
  suggestedTitle: string;
}): SmartDateComposerContext => ({
  sourceKey: args.sourceKey,
  sourceText: normalizeText(args.sourceText),
  sourceStartOffset: args.sourceStartOffset,
  sourceEndOffset: args.sourceEndOffset,
  noteId: args.noteId,
  noteTitle: args.noteTitle,
  noteProjectId: args.noteProjectId ?? null,
  resolvedDateISO: args.resolvedDate.toISOString(),
  hasExplicitTime: args.hasExplicitTime,
  suggestedTitle: normalizeText(args.suggestedTitle),
});

export const encodeSmartDateComposerContext = (context: SmartDateComposerContext) =>
  `smart-date:${encodeURIComponent(JSON.stringify(context))}`;

export const decodeSmartDateComposerContext = (
  value: string | null | undefined
): SmartDateComposerContext | null => {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith('smart-date:')) return null;
  const payload = raw.slice('smart-date:'.length);
  try {
    const decoded = JSON.parse(decodeURIComponent(payload)) as Partial<SmartDateComposerContext>;
    if (
      typeof decoded.sourceKey !== 'string' ||
      typeof decoded.sourceText !== 'string' ||
      typeof decoded.noteId !== 'string' ||
      typeof decoded.noteTitle !== 'string' ||
      typeof decoded.resolvedDateISO !== 'string'
    ) {
      return null;
    }
    return {
      sourceKey: decoded.sourceKey,
      sourceText: decoded.sourceText,
      sourceStartOffset: Number(decoded.sourceStartOffset ?? 0) || 0,
      sourceEndOffset: Number(decoded.sourceEndOffset ?? 0) || 0,
      noteId: decoded.noteId,
      noteTitle: decoded.noteTitle,
      noteProjectId: decoded.noteProjectId ?? null,
      resolvedDateISO: decoded.resolvedDateISO,
      hasExplicitTime: Boolean(decoded.hasExplicitTime),
      suggestedTitle: String(decoded.suggestedTitle ?? '').trim(),
    };
  } catch {
    return null;
  }
};
