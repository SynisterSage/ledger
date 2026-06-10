function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function formatDateToLocalIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseNaturalDate(input: string, baseDate = new Date()) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;

  const today = new Date(baseDate);
  today.setHours(0, 0, 0, 0);

  if (normalized === 'today') return today;

  if (normalized === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }

  const inDaysMatch = normalized.match(/^in\s+(\d+)\s+day(?:s)?$/);
  if (inDaysMatch) {
    const days = Number.parseInt(inDaysMatch[1], 10);
    if (Number.isFinite(days)) {
      const next = new Date(today);
      next.setDate(next.getDate() + days);
      return next;
    }
  }

  const dateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const date = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const date = new Date(
      Number(slashMatch[3]),
      Number(slashMatch[1]) - 1,
      Number(slashMatch[2]),
    );
    if (!Number.isNaN(date.getTime())) return date;
  }

  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

export function parseDateInputToIsoDate(input: string, baseDate = new Date(), fallbackDate: string | null = null) {
  const trimmed = input.trim();
  if (!trimmed) return fallbackDate;

  const parsed = parseNaturalDate(trimmed, baseDate);
  if (!parsed) return fallbackDate;

  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

export function parseTimeInputTo24Hour(input: string) {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return null;

  const timeMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!timeMatch) return null;

  let hour = Number.parseInt(timeMatch[1], 10);
  const minute = Number.parseInt(timeMatch[2] ?? '0', 10);
  const meridiem = timeMatch[3];

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem) {
    if (hour === 12) {
      hour = meridiem === 'am' ? 0 : 12;
    } else if (meridiem === 'pm') {
      hour += 12;
    }
  }

  if (hour < 0 || hour > 23) {
    return null;
  }

  return `${pad(hour)}:${pad(minute)}`;
}

export function buildLocalIsoDateTime({
  dateInput,
  timeInput,
  baseDate = new Date(),
  fallbackTime = '09:00',
}: {
  dateInput: string;
  timeInput: string;
  baseDate?: Date;
  fallbackTime?: string;
}) {
  const isoDate = parseDateInputToIsoDate(dateInput, baseDate);
  if (!isoDate) return null;

  const time24 = parseTimeInputTo24Hour(timeInput) ?? parseTimeInputTo24Hour(fallbackTime) ?? '09:00';
  const [hours, minutes] = time24.split(':').map((part) => Number.parseInt(part, 10));

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}
