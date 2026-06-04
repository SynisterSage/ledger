function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function cloneDateAtHour(base: Date, hour: number, minute = 0) {
  const date = new Date(base);
  date.setHours(hour, minute, 0, 0);
  return date;
}

export function getTomorrowAt(hour: number, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return cloneDateAtHour(date, hour, minute);
}

export function formatRelativeDayLabel(input: Date) {
  const now = new Date();
  const diffMs = new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime() -
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round(diffMs / 86_400_000);

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days`;
  return `${pad(input.getMonth() + 1)}/${pad(input.getDate())}`;
}

function parseClockTime(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = match[3] ?? null;

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (minutes < 0 || minutes > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }

  return { hours, minutes };
}

function parseDatePart(value: string, fallback: Date) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const relative = normalized.match(/^(today|tomorrow)(?:\s+(.*))?$/);
  if (relative) {
    const base = new Date();
    if (relative[1] === 'tomorrow') {
      base.setDate(base.getDate() + 1);
    }

    const parsedTime = relative[2] ? parseClockTime(relative[2]) : null;
    if (parsedTime) {
      base.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
    } else {
      base.setHours(fallback.getHours(), fallback.getMinutes(), 0, 0);
    }

    return base;
  }

  const isoLike = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:[ t](\d{1,2}:\d{2}(?:\s*[ap]m)?))?$/);
  if (isoLike) {
    const [year, month, day] = isoLike[1].split('-').map(Number);
    const next = new Date();
    next.setFullYear(year, month - 1, day);

    const parsedTime = isoLike[2] ? parseClockTime(isoLike[2]) : null;
    if (parsedTime) {
      next.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
    } else {
      next.setHours(fallback.getHours(), fallback.getMinutes(), 0, 0);
    }

    return next;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return null;
}

export function parseMobileDateTimeInput(value: string, fallback: Date) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;

  return parseDatePart(normalized, fallback) ?? fallback;
}

export function parseMobileDateInput(value: string, fallback: Date) {
  const parsed = parseMobileDateTimeInput(value, fallback);
  parsed.setHours(fallback.getHours(), fallback.getMinutes(), 0, 0);
  return parsed;
}
