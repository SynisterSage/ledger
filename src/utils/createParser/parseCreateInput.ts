import type { ParsedCreateInput } from './createParserTypes';

const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = (value: number) => String(value).padStart(2, '0');
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const resolveDate = (text: string, now: Date) => {
  const lower = text.toLowerCase();
  const relative = lower.match(/\b(today|tomorrow|next week)\b/);
  if (relative) {
    const result = new Date(now);
    result.setHours(0, 0, 0, 0);
    result.setDate(result.getDate() + (relative[1] === 'tomorrow' ? 1 : relative[1] === 'next week' ? 7 : 0));
    return { value: dateKey(result), confidence: 'high' as const };
  }
  const weekday = lower.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday) {
    const target = weekdays.indexOf(weekday[2]);
    const result = new Date(now);
    result.setHours(0, 0, 0, 0);
    let delta = (target - result.getDay() + 7) % 7;
    if (delta === 0) delta += 7;
    result.setDate(result.getDate() + delta);
    return { value: dateKey(result), confidence: 'high' as const };
  }
  const month = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})\b|\b(\d{1,2})\/(\d{1,2})\b/);
  if (month) {
    const result = new Date(now);
    const parsed = month[3] ? new Date(result.getFullYear(), Number(month[3]) - 1, Number(month[4])) : new Date(`${month[1]} ${month[2]}, ${result.getFullYear()}`);
    const expectedMonth = month[3] ? Number(month[3]) - 1 : parsed.getMonth();
    const expectedDay = Number(month[3] ?? month[2]);
    if (!Number.isNaN(parsed.getTime())) {
      if (parsed.getMonth() !== expectedMonth || parsed.getDate() !== expectedDay) return undefined;
      if (parsed < new Date(now.getFullYear(), now.getMonth(), now.getDate())) parsed.setFullYear(parsed.getFullYear() + 1);
      return { value: dateKey(parsed), confidence: 'high' as const };
    }
  }
  return undefined;
};

const resolveTime = (text: string) => {
  const lower = text.toLowerCase();
  if (/\bmidnight\b/.test(lower)) return { value: '00:00', confidence: 'high' as const };
  if (/\bnoon\b/.test(lower)) return { value: '12:00', confidence: 'high' as const };
  const range = lower.match(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:-|to)\s*\d{1,2}(?::\d{2})?\s*(am|pm)\b/);
  if (range) {
    let hour = Number(range[1]);
    if (range[3] === 'pm' && hour < 12) hour += 12;
    if (range[3] === 'am' && hour === 12) hour = 0;
    return { value: `${pad(hour)}:${range[2] ?? '00'}`, confidence: 'high' as const };
  }
  const meridiem = lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (meridiem) {
    let hour = Number(meridiem[1]);
    if (meridiem[3] === 'pm' && hour < 12) hour += 12;
    if (meridiem[3] === 'am' && hour === 12) hour = 0;
    return { value: `${pad(hour)}:${meridiem[2] ?? '00'}`, confidence: 'high' as const };
  }
  const bare = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (bare && Number(bare[1]) <= 23) {
    let hour = Number(bare[1]);
    if (hour < 8) hour += 12;
    return { value: `${pad(hour)}:${bare[2] ?? '00'}`, confidence: 'medium' as const };
  }
  if (/\bmorning\b/.test(lower)) return { value: '09:00', confidence: 'medium' as const };
  if (/\bafternoon\b/.test(lower)) return { value: '15:00', confidence: 'medium' as const };
  return undefined;
};

const resolveDuration = (text: string) => {
  const match = text.toLowerCase().match(/(?:for\s+)?(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h)\b|\bfor\s+an?\s+hour\b/);
  if (!match) return undefined;
  if (match[0].includes('an hour')) return { value: 60, confidence: 'high' as const };
  const amount = Number(match[1]);
  return { value: /hour|hr|\bh\b/.test(match[2] ?? '') ? amount * 60 : amount, confidence: 'high' as const };
};

const resolveRecurrence = (text: string) => {
  const lower = text.toLowerCase();
  if (/\bevery\s+month\s+on\s+\d{1,2}(?:st|nd|rd|th)?\b/.test(lower)) return undefined;
  if (/\bevery\s+(weekday|weekdays)\b/.test(lower)) return 'weekdays' as const;
  if (/\bevery\s+(day|daily)\b/.test(lower)) return 'daily' as const;
  if (/\bevery\s+(month|monthly)\b/.test(lower)) return 'monthly' as const;
  if (/\bmonthly\b/.test(lower)) return 'monthly' as const;
  if (/\bevery\s+(week|weekly|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lower)) return 'weekly' as const;
  return undefined;
};

export const parseCreateInput = (input: string, now = new Date()): ParsedCreateInput => {
  const text = input.trim();
  if (!text) return { confidence: {} };
  const date = resolveDate(text, now);
  const time = resolveTime(text);
  const duration = resolveDuration(text);
  const rangeDuration = !duration && text.match(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const recurrence = resolveRecurrence(text);
  const allDay = /\ball[ -]?day\b/i.test(text);
  const locationMatch = text.match(/\b(?:at|in)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s*$/);
  let title = text.replace(/^\s*(?:remind me to|remember to|don't forget to)\s+/i, '');
  title = title.replace(/\bevery\s+(?:weekday|weekdays|day|daily|month|monthly|week|weekly|(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/gi, '');
  title = title.replace(/\bmonthly\b/gi, '');
  title = title.replace(/\ball[ -]?day\b/gi, '');
  title = title.replace(/\bfor\s+(?:an?\s+hour|\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?|h))\b/gi, '');
  title = title.replace(/\b(?:today|tomorrow|next week|next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/gi, '');
  title = title.replace(/\b(?:from\s+)?\d{1,2}(?::\d{2})?\s*(?:-|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '');
  title = title.replace(/\b(?:at\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight|morning|afternoon)\b/gi, '');
  if (locationMatch) title = title.replace(locationMatch[0], '');
  title = title.replace(/\s{2,}/g, ' ').replace(/[,.\-\s]+$/, '').trim();
  return {
    title: title || undefined,
    date: date?.value,
    time: time?.value,
    durationMinutes: duration?.value ?? (rangeDuration ? (() => {
      const start = Number(rangeDuration[1]) + (rangeDuration[5] === 'pm' && Number(rangeDuration[1]) < 12 ? 12 : 0);
      const end = Number(rangeDuration[3]) + (rangeDuration[5] === 'pm' && Number(rangeDuration[3]) < 12 ? 12 : 0);
      return Math.max(1, (end * 60 + Number(rangeDuration[4] ?? 0)) - (start * 60 + Number(rangeDuration[2] ?? 0)));
    })() : undefined),
    recurrence,
    allDay: allDay || undefined,
    location: locationMatch?.[1],
    confidence: { date: date?.confidence, time: time?.confidence, duration: duration?.confidence },
  };
};
