export type TimelineProjectDateFields = {
  start_date?: string | null;
  end_date?: string | null;
};

export type TimelineDateRange = {
  start: Date;
  end: Date;
};

const parseDateValue = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const date = new Date(
      Number(dateOnlyMatch[1]),
      Number(dateOnlyMatch[2]) - 1,
      Number(dateOnlyMatch[3])
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const parseProjectTimelineDate = (value: string | null | undefined) => {
  const date = parseDateValue(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

export const getProjectTimelineSpan = (project: TimelineProjectDateFields) => {
  const dates = [
    parseProjectTimelineDate(project.start_date),
    parseProjectTimelineDate(project.end_date),
  ].filter((date): date is Date => Boolean(date));
  if (dates.length === 0) return null;

  return {
    start: new Date(Math.min(...dates.map((date) => date.getTime()))),
    end: new Date(Math.max(...dates.map((date) => date.getTime()))),
  };
};

/** A project is visible when any part of its normalized date span overlaps the range. */
export const projectOverlapsTimelineRange = (
  project: TimelineProjectDateFields,
  range: TimelineDateRange
) => {
  const span = getProjectTimelineSpan(project);
  if (!span) return false;
  return span.end >= range.start && span.start < range.end;
};

export const getProjectTimelineVisibility = (
  project: TimelineProjectDateFields,
  range: TimelineDateRange
): 'visible' | 'invalid_dates' | 'outside_range' => {
  if (!getProjectTimelineSpan(project)) return 'invalid_dates';
  return projectOverlapsTimelineRange(project, range) ? 'visible' : 'outside_range';
};
