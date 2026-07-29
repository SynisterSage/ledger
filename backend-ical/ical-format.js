const DEFAULT_TIMEZONE = 'UTC';

function escapeICalText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldICalLine(line) {
  if (line.length <= 75) return [line];
  const output = [];
  let remaining = line;
  while (remaining.length > 75) {
    output.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }
  output.push(remaining);
  return output;
}

function safeTimezone(value) {
  const timezone = String(value || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function toICalDateTime(dateLike) {
  const iso = new Date(dateLike).toISOString();
  return iso.replace(/[-:]/g, '').replace('.000', '');
}

function toZonedICalDateTime(dateLike, timezone) {
  const date = new Date(dateLike);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

function recurrenceRuleValue(rule, until = null) {
  const suffix = until ? `;UNTIL=${toICalDateTime(until)}` : '';
  switch (String(rule || '').toLowerCase()) {
    case 'daily': return `FREQ=DAILY${suffix}`;
    case 'weekly': return `FREQ=WEEKLY${suffix}`;
    case 'monthly': return `FREQ=MONTHLY${suffix}`;
    case 'yearly': return `FREQ=YEARLY${suffix}`;
    case 'weekdays': return `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR${suffix}`;
    default: return null;
  }
}

function allDayDate(value) {
  return String(value || '').replace(/-/g, '').slice(0, 8);
}

function nextAllDayDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

module.exports = {
  allDayDate,
  escapeICalText,
  foldICalLine,
  nextAllDayDate,
  recurrenceRuleValue,
  safeTimezone,
  toICalDateTime,
  toZonedICalDateTime,
};
