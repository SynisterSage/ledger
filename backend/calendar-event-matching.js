const normalizeTitle = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const eventSchedule = (event) => {
  const start = new Date(event?.start_at ?? '');
  const end = new Date(event?.end_at ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return {
    weekday: start.getUTCDay(),
    minutes: start.getUTCHours() * 60 + start.getUTCMinutes(),
    durationMinutes: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)),
  };
};

const sameSeries = (anchor, candidate) => {
  if (anchor.series_id && anchor.series_id === candidate.series_id) return 'recurring series';
  if (anchor.import_series_key && anchor.import_series_key === candidate.import_series_key)
    return 'imported series';
  return null;
};

export const isBulkDeletableCalendarEvent = (event) =>
  !['apple', 'google', 'outlook'].includes(String(event?.source_platform ?? '').toLowerCase());

export const isBulkDeleteEligibleCalendarEvent = (event) =>
  isBulkDeletableCalendarEvent(event) &&
  (event?.source_platform === 'ics' || Boolean(event?.series_id));

const isSimilarImportedEvent = (anchor, candidate) => {
  if (anchor.source_platform !== 'ics' || candidate.source_platform !== 'ics') return false;
  if (anchor.calendar_id !== candidate.calendar_id) return false;
  if (normalizeTitle(anchor.title) !== normalizeTitle(candidate.title)) return false;
  const anchorSchedule = eventSchedule(anchor);
  const candidateSchedule = eventSchedule(candidate);
  if (!anchorSchedule || !candidateSchedule) return false;
  return (
    anchorSchedule.weekday === candidateSchedule.weekday &&
    Math.abs(anchorSchedule.minutes - candidateSchedule.minutes) <= 15 &&
    Math.abs(anchorSchedule.durationMinutes - candidateSchedule.durationMinutes) <= 15
  );
};

const isSameImportedBatchEvent = (anchor, candidate) => {
  if (anchor.source_platform !== 'ics' || candidate.source_platform !== 'ics') return false;
  if (!anchor.import_batch_id || anchor.import_batch_id !== candidate.import_batch_id) return false;
  if (anchor.calendar_id !== candidate.calendar_id) return false;
  return normalizeTitle(anchor.title) === normalizeTitle(candidate.title);
};

const eventPreview = (event, reason) => ({
  id: String(event.id),
  title: event.title,
  start_at: event.start_at,
  end_at: event.end_at,
  all_day: Boolean(event.all_day),
  status: event.status ?? null,
  reason,
});

export const getCalendarEventMatches = ({
  anchor,
  candidates,
  scope = 'future',
  now = new Date(),
}) => {
  if (!isBulkDeleteEligibleCalendarEvent(anchor)) return [];
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const matches = [];
  for (const candidate of candidates ?? []) {
    if (!candidate?.id || String(candidate.id) === String(anchor?.id)) continue;
    if (
      candidate.workspace_id !== anchor.workspace_id ||
      candidate.calendar_id !== anchor.calendar_id
    )
      continue;
    if (scope === 'future' && new Date(candidate.start_at).getTime() < nowTime) continue;
    const reason = sameSeries(anchor, candidate);
    if (reason || isSameImportedBatchEvent(anchor, candidate) || isSimilarImportedEvent(anchor, candidate)) {
      matches.push(eventPreview(candidate, reason ?? (isSameImportedBatchEvent(anchor, candidate) ? 'same imported class' : 'same title and schedule')));
    }
  }
  return matches.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
};

export const calendarEventPreviewAnchor = (event) => ({
  id: String(event.id),
  title: event.title,
  start_at: event.start_at,
  end_at: event.end_at,
  source_platform: event.source_platform ?? null,
  import_series_key: event.import_series_key ?? null,
  series_id: event.series_id ?? null,
});

export const normalizeBulkEventIds = (value) => {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > 1000) return null;
  if (
    ids.some(
      (id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    )
  )
    return null;
  return ids;
};
