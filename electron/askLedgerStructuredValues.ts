import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';

export type AskLedgerStructuredValueOptions = {
  timeZone?: string;
  timeFormat?: '12h' | '24h';
  now?: Date;
};

export type AskLedgerStructuredDiagnostics = {
  rawIsoDateObserved: boolean;
  raw24HourTimeObserved: boolean;
  invalidDateDetected: boolean;
  invalidTimeDetected: boolean;
  dateNormalizationFailure: boolean;
  relativeDateAvailableButUnused: boolean;
  dueStateMismatchDetected: boolean;
};

export type AskLedgerDisplayValues = {
  displayDueDate?: string;
  relativeDueDate?: string;
  dueStatus?: 'overdue' | 'due_today' | 'due_tomorrow' | 'upcoming' | 'completed' | 'no_due_date';
  dueStateLabel?: string;
  displayTimestamp?: string;
  displayEndAt?: string;
  displayUpdatedAt?: string;
  displayCreatedAt?: string;
  displayStatus?: string;
  displayPriority?: string;
  displayDuration?: string;
  diagnostics: AskLedgerStructuredDiagnostics;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const CLOSED_STATUS = /^(?:completed?|done|finished|cancelled|canceled|dismissed|archived)$/i;

const emptyDiagnostics = (): AskLedgerStructuredDiagnostics => ({
  rawIsoDateObserved: false,
  raw24HourTimeObserved: false,
  invalidDateDetected: false,
  invalidTimeDetected: false,
  dateNormalizationFailure: false,
  relativeDateAvailableButUnused: false,
  dueStateMismatchDetected: false,
});

const validTimeZone = (candidate?: string) => {
  if (!candidate) return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
};

const partsFor = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
};

const dateKeyFor = (value: Date, timeZone: string) => {
  const parts = partsFor(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const dateKeyToUtc = (value: string) => {
  const match = value.match(ISO_DATE);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
};

const isValidDateKey = (value: string) => {
  const match = value.match(ISO_DATE);
  if (!match) return false;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return parsed.getUTCFullYear() === Number(match[1]) && parsed.getUTCMonth() === Number(match[2]) - 1 && parsed.getUTCDate() === Number(match[3]);
};

const wallTimeToInstant = (value: string, timeZone: string) => {
  const match = value.match(ISO_DATE_TIME);
  if (!match || !isValidDateKey(`${match[1]}-${match[2]}-${match[3]}`) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59) return undefined;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = partsFor(new Date(guess), timeZone);
    const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const adjustment = target - rendered;
    if (!adjustment) return new Date(guess);
    guess += adjustment;
  }
  return new Date(guess);
};

const parseStructuredDate = (value: string, timeZone: string): { date?: Date; dateOnly: boolean; valid: boolean } => {
  const dateOnly = ISO_DATE.test(value);
  if (dateOnly) return { date: isValidDateKey(value) ? wallTimeToInstant(`${value}T12:00:00`, timeZone) : undefined, dateOnly: true, valid: isValidDateKey(value) };
  const match = value.match(ISO_DATE_TIME);
  if (match && !match[8]) return { date: wallTimeToInstant(value, timeZone), dateOnly: false, valid: Boolean(wallTimeToInstant(value, timeZone)) };
  const parsed = Date.parse(value);
  return { date: Number.isFinite(parsed) ? new Date(parsed) : undefined, dateOnly: false, valid: Number.isFinite(parsed) };
};

const humanDate = (date: Date, timeZone: string, includeWeekday = true, referenceDate = new Date()) => {
  const parts = partsFor(date, timeZone);
  const currentYear = Number(partsFor(referenceDate, timeZone).year);
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: includeWeekday ? 'long' : undefined,
    month: 'short',
    day: 'numeric',
    year: Number(parts.year) === currentYear ? undefined : 'numeric',
  }).format(date);
};

const humanTime = (date: Date, timeZone: string, timeFormat: '12h' | '24h' = '12h') => new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: timeFormat === '12h' }).format(date);

const humanDateTime = (date: Date, timeZone: string, referenceDate: Date, timeFormat: '12h' | '24h' = '12h') => `${humanDate(date, timeZone, true, referenceDate)} at ${humanTime(date, timeZone, timeFormat)}`;

const relativeDate = (dateKey: string, todayKey: string) => {
  const difference = Math.round((dateKeyToUtc(dateKey) - dateKeyToUtc(todayKey)) / 86_400_000);
  if (difference === 0) return 'today';
  if (difference === 1) return 'tomorrow';
  if (difference === -1) return 'yesterday';
  if (difference > 1 && difference <= 7) return `in ${difference} days`;
  if (difference < -1) return `${Math.abs(difference)} days overdue`;
  return undefined;
};

const humanize = (value?: string) => {
  if (!value) return undefined;
  const text = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : undefined;
};

const durationLabel = (value: unknown) => {
  const seconds = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
};

export const formatAskLedgerStructuredValues = (item: AskLedgerContextItem, options: AskLedgerStructuredValueOptions = {}): AskLedgerDisplayValues => {
  const timeZone = validTimeZone(options.timeZone);
  const now = options.now ?? new Date();
  const todayKey = dateKeyFor(now, timeZone);
  const diagnostics = emptyDiagnostics();
  const format = (value: string | undefined, includeTime: boolean) => {
    if (!value) return undefined;
    const parsed = parseStructuredDate(value, timeZone);
    if (!parsed.valid || !parsed.date) {
      diagnostics.invalidDateDetected = true;
      if (ISO_DATE_TIME.test(value)) diagnostics.invalidTimeDetected = true;
      diagnostics.dateNormalizationFailure = true;
      return undefined;
    }
    if (includeTime && !parsed.dateOnly && /(?:T|\s)\d{2}:\d{2}/.test(value)) {
      const match = value.match(ISO_DATE_TIME);
      if (match && Number(match[4]) >= 0 && Number(match[4]) <= 23) diagnostics.raw24HourTimeObserved = true;
      return humanDateTime(parsed.date, timeZone, now, options.timeFormat);
    }
    return humanDate(parsed.date, timeZone, true, now);
  };
  const dueParsed = item.dueAt ? parseStructuredDate(item.dueAt, timeZone) : undefined;
  const completed = CLOSED_STATUS.test(String(item.status ?? '').replace(/[_-]/g, ' '));
  const dueKey = dueParsed?.valid && dueParsed.date ? dueParsed.dateOnly ? item.dueAt!.slice(0, 10) : dateKeyFor(dueParsed.date, timeZone) : undefined;
  const relativeDueDate = dueKey ? relativeDate(dueKey, todayKey) : undefined;
  const dueStatus = !dueKey ? 'no_due_date' : completed ? 'completed' : dueKey < todayKey ? 'overdue' : dueKey === todayKey ? 'due_today' : dueKey === `${new Date(dateKeyToUtc(todayKey) + 86_400_000).toISOString().slice(0, 10)}` ? 'due_tomorrow' : 'upcoming';
  if (item.dueAt && (!dueParsed?.valid || !dueKey)) {
    diagnostics.invalidDateDetected = true;
    diagnostics.dateNormalizationFailure = true;
  }
  if (dueStatus === 'completed') diagnostics.dueStateMismatchDetected = false;
  if (/\boverdue\b/i.test(String(item.status ?? '')) && dueStatus !== 'overdue' && dueStatus !== 'completed') diagnostics.dueStateMismatchDetected = true;
  const dueStateLabel = dueStatus === 'overdue' ? `${Math.abs(Math.round((dateKeyToUtc(todayKey) - dateKeyToUtc(dueKey!)) / 86_400_000))} days overdue` : dueStatus === 'due_today' ? 'today' : dueStatus === 'due_tomorrow' ? 'tomorrow' : undefined;
  const metadata = item.metadata ?? {};
  const startParsed = item.timestamp ? parseStructuredDate(item.timestamp, timeZone) : undefined;
  const endParsed = item.endAt ? parseStructuredDate(item.endAt, timeZone) : undefined;
  const derivedDuration = startParsed?.valid && endParsed?.valid && startParsed.date && endParsed.date && endParsed.date >= startParsed.date
    ? (endParsed.date.getTime() - startParsed.date.getTime()) / 1000
    : undefined;
  return {
    displayDueDate: format(item.dueAt, false),
    relativeDueDate,
    dueStatus,
    dueStateLabel,
    displayTimestamp: format(item.timestamp, true),
    displayEndAt: format(item.endAt, true),
    displayUpdatedAt: format(item.updatedAt, true),
    displayCreatedAt: format(item.createdAt, true),
    displayStatus: humanize(item.status),
    displayPriority: item.priority ? `${humanize(item.priority)} priority` : item.severity ? humanize(item.severity) : undefined,
    displayDuration: durationLabel(metadata.durationSeconds ?? metadata.duration ?? metadata.duration_seconds ?? derivedDuration),
    diagnostics,
  };
};

export const structuredValueLinesFor = (item: AskLedgerContextItem, options?: AskLedgerStructuredValueOptions) => {
  const display = formatAskLedgerStructuredValues(item, options);
  return {
    display,
    lines: [
      display.displayStatus ? `Status: ${display.displayStatus}` : '',
      display.displayDueDate ? `Due: ${display.displayDueDate}${display.dueStateLabel ? ` · ${display.dueStateLabel}` : ''}` : '',
      display.dueStatus && display.dueStatus !== 'no_due_date' ? `Due state: ${display.dueStatus}` : '',
      display.displayTimestamp ? `Time: ${display.displayTimestamp}` : '',
      display.displayEndAt ? `Ends: ${display.displayEndAt}` : '',
      display.displayPriority ? `Priority: ${display.displayPriority}` : '',
      display.displayDuration ? `Duration: ${display.displayDuration}` : '',
      display.displayUpdatedAt ? `Updated: ${display.displayUpdatedAt}` : '',
    ].filter(Boolean),
  };
};

export const diagnoseAskLedgerStructuredOutput = (answer: string, items: AskLedgerContextItem[], options: AskLedgerStructuredValueOptions = {}): AskLedgerStructuredDiagnostics => {
  const diagnostics = emptyDiagnostics();
  diagnostics.rawIsoDateObserved = /\b\d{4}-\d{2}-\d{2}(?:T|\b)/.test(answer);
  diagnostics.raw24HourTimeObserved = /\b(?:[01]\d|2[0-3]):[0-5]\d\b/.test(answer);
  items.forEach((item) => {
    const display = formatAskLedgerStructuredValues(item, options);
    diagnostics.invalidDateDetected ||= display.diagnostics.invalidDateDetected;
    diagnostics.invalidTimeDetected ||= display.diagnostics.invalidTimeDetected;
    diagnostics.dateNormalizationFailure ||= display.diagnostics.dateNormalizationFailure;
    if (display.relativeDueDate && answer.toLowerCase().includes(item.title.toLowerCase()) && !answer.toLowerCase().includes(display.relativeDueDate.toLowerCase()) && !answer.toLowerCase().includes(display.displayDueDate?.toLowerCase() ?? '')) diagnostics.relativeDateAvailableButUnused = true;
    if (display.dueStatus === 'completed' && answer.toLowerCase().includes(item.title.toLowerCase()) && /\boverdue\b|\bupcoming\b/.test(answer.toLowerCase())) diagnostics.dueStateMismatchDetected = true;
  });
  return diagnostics;
};
