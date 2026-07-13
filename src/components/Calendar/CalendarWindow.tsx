import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  BellRing,
  ClipboardPaste,
  CalendarPlus,
  Palette,
  PencilLine,
  Trash2,
  Folder,
  Plus,
  Loader2,
  Eye,
  EyeOff,
  Inbox,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModalOverlay } from '../Common/ModalOverlay';
import * as rruleModule from 'rrule';
import { useAuthContext } from '../../context/AuthContext';
import { PinActionButton } from '../Common/PinActionButton';
import { useSidebar } from '../../context/SidebarContext';
import {
  modulePaneSizing,
  clampPaneWidth,
  getPaneWidthForViewport,
} from '../../config/modulePaneSizes';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { useWorkspaceRealtimeRefresh } from '../../hooks/useWorkspaceRealtimeRefresh';
import { useWorkspaceRouteHistory } from '../../hooks/useWorkspaceRouteHistory';
import {
  ModuleHeaderSegmentedButton,
  ModuleHeaderSegmentedGroup,
  ModuleHeaderStripAction,
  ModuleWindowHeader,
} from '../Common/ModuleWindowHeader';
import { CloseGuardModal } from '../Common/CloseGuardModal';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { useViewportWidth } from '../../hooks/useViewportWidth';

// Get RRule from the module - handles both ESM and CommonJS
const RRule = (rruleModule as any).RRule || (rruleModule as any).default?.RRule || rruleModule;

const preferenceColorMap: Record<
  NonNullable<CalendarPreferenceSnapshot['calendarColor']>,
  string
> = {
  'ledger-orange': '#FF5F40',
  blue: '#3B82F6',
  green: '#22C55E',
  gray: '#94A3B8',
};

const resolveReminderSnoozeOptions = (
  setting: CalendarPreferenceSnapshot['reminderSnoozePreset'] | undefined
) => {
  switch (setting) {
    case '5m-15m-1h':
      return [
        { label: '5 min', minutes: 5 },
        { label: '15 min', minutes: 15 },
        { label: '1 hour', minutes: 60 },
      ];
    case '15m-1h-tomorrow':
      return [
        { label: '15 min', minutes: 15 },
        { label: '1 hour', minutes: 60 },
        { label: 'Tomorrow', minutes: 24 * 60 },
      ];
    case '10m-1h-tomorrow':
    default:
      return [
        { label: '10 min', minutes: 10 },
        { label: '1 hour', minutes: 60 },
        { label: 'Tomorrow', minutes: 24 * 60 },
      ];
  }
};

type CalendarRow = {
  id: string;
  name: string;
  color: string;
  workspace_id: string;
  is_personal: boolean;
  is_default?: boolean;
  is_visible?: boolean;
  created_by?: string | null;
};

type EventRow = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  calendar_id: string;
  color?: string;
  status?: 'planned' | 'done' | 'missed' | 'cancelled';
  visibility?: 'private' | 'workspace';
  recurrence_rule?: 'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays' | 'specific_dates';
  all_day?: boolean;
  project_id?: string | null;
  note_id?: string | null;
  notes?: string | null;
  series_id?: string | null;
  series_type?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  workspace_color?: string | null;
};

type ReminderRow = {
  id: string;
  title: string;
  remind_at: string;
  calendar_id: string;
  color?: string;
  is_done: boolean;
  recurrence_rule?: 'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays' | 'specific_dates';
  project_id?: string | null;
  note_id?: string | null;
  notes?: string | null;
  series_id?: string | null;
  series_type?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  workspace_color?: string | null;
};

type CalendarPreferenceSnapshot = {
  weekStartsOn?: 'sunday' | 'monday';
  timeFormat?: '12h' | '24h';
  defaultEventMinutes?: number;
  defaultEventCalendar?: 'personal' | 'work' | 'projects';
  defaultEventStatus?: 'planned' | 'tentative' | 'confirmed';
  defaultEventVisibility?: 'private' | 'workspace';
  defaultReminderTime?: '08:00' | '09:00' | '12:00' | '17:00';
  defaultCalendarView?: 'day' | 'week' | 'month';
  showWeekends?: boolean;
  showRemindersOnCalendar?: boolean;
  showCompletedItems?: 'muted' | 'hidden' | 'visible';
  reminderSnoozePreset?: '10m-1h-tomorrow' | '5m-15m-1h' | '15m-1h-tomorrow';
  reminderDestination?: 'today-calendar' | 'today' | 'calendar';
  missedReminderBehavior?: 'needs_attention' | 'today' | 'hide';
  completedReminderBehavior?: 'collapse' | 'keep_visible' | 'hide_immediately';
  pastEventBehavior?: 'history' | 'fade' | 'upcoming_only';
  followUpBehavior?: 'none' | 'offer' | 'review_prompt';
  followUpDefaultTime?: 'tomorrow_9' | 'today_5' | 'next_morning' | 'custom';
  eventNotesBehavior?: 'enabled' | 'disabled';
  linkedProjectFollowUps?: 'project_and_today' | 'project_only' | 'today_only';
  defaultWorkspaceCalendar?: 'personal' | 'workspace' | 'projects';
  calendarScope?: 'current_workspace' | 'all_accessible_workspaces';
  calendarColor?: 'ledger-orange' | 'blue' | 'green' | 'gray';
};

type TaskRow = {
  id: string;
  title: string;
  status?: string | null;
  project_id?: string | null;
  description?: string | null;
  notes?: string | null;
  created_at?: string;
};

type ProjectRow = {
  id: string;
  name: string;
  color?: string;
};

type NoteRow = {
  id: string;
  title: string;
};

type GridQuickAddState = {
  dateKey: string;
  hour: number;
};

type CalendarContextMenuState = {
  x: number;
  y: number;
  dateKey: string;
  hour: number;
};

type CalendarRowContextMenuState = {
  x: number;
  y: number;
  calendarId: string;
};

type CalendarColorMenuState = {
  x: number;
  y: number;
  calendarId: string;
};

type ListContextMenuState = {
  x: number;
  y: number;
  kind: 'event' | 'reminder';
  id: string;
};

type CalendarViewMode = 'day' | 'week' | 'month';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CALENDAR_DAY_START_HOUR = 8;
const CALENDAR_DAY_END_HOUR = 21;
const hours = Array.from(
  { length: CALENDAR_DAY_END_HOUR - CALENDAR_DAY_START_HOUR + 1 },
  (_, i) => `${i + CALENDAR_DAY_START_HOUR}:00`
);
const NOTIFICATION_VISIBLE_MS = 4000;
const NOTIFICATION_FADE_MS = 350;
const SIDEBAR_MIN_WIDTH = modulePaneSizing.calendar.left.min;
const SIDEBAR_MAX_WIDTH = 460;
const INSPECTOR_MIN_WIDTH = modulePaneSizing.calendar.right.min;
const INSPECTOR_MAX_WIDTH = 420;
const TIMELINE_HOUR_HEIGHT = 64;

const startOfWeek = (date: Date, weekStartsOn: 'sunday' | 'monday' = 'monday') => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = weekStartsOn === 'sunday' ? -day : day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date: Date, daysToAdd: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + daysToAdd);
  return d;
};

const startOfMonth = (date: Date) => {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfMonthGrid = (date: Date) => {
  const monthStart = startOfMonth(date);
  const day = monthStart.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(monthStart, diff);
};

const addMonths = (date: Date, monthsToAdd: number) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + monthsToAdd);
  return d;
};

const formatDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const parseDateKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
};

const uniqueSortedDateKeys = (dates: string[]) => Array.from(new Set(dates)).sort();

const formatSpecificDatesPreview = (dates: string[], maxVisible = 5) => {
  const sorted = uniqueSortedDateKeys(dates);
  if (sorted.length === 0) return 'No dates selected';

  const preview = sorted
    .slice(0, maxVisible)
    .map((dateKey) =>
      parseDateKey(dateKey).toLocaleDateString([], { month: 'short', day: 'numeric' })
    )
    .join(', ');

  if (sorted.length > maxVisible) {
    return `${preview} +${sorted.length - maxVisible} more`;
  }

  return preview;
};

const formatSpecificDatesLabel = (count: number) =>
  count > 0 ? `Specific dates · ${count} date${count === 1 ? '' : 's'}` : 'Specific dates';

const buildMonthGrid = (anchor: Date) => {
  const start = startOfMonthGrid(anchor);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
};

const parseValidCalendarDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const endOfLocalDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};
const baseEventId = (id: string) => id.split('__')[0];
const baseReminderId = (id: string) => id.split('__')[0];
const ICAL_SERVICE_URL = (import.meta.env.VITE_ICAL_SERVICE_URL ?? '').replace(/\/$/, '');

type ParsedIcsEvent = {
  title: string;
  startAt: string;
  endAt: string;
  notes?: string;
  location?: string;
};

const unfoldIcsLines = (raw: string) => {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.replace(/\n[ \t]/g, '');
};

const parseIcsDate = (value: string): Date | null => {
  const v = value.trim();
  if (!v) return null;

  const direct = new Date(v);
  if (!Number.isNaN(direct.getTime())) return direct;

  const compactIso = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z)?$/i);
  if (compactIso) {
    const [, y, m, d, hh, mm, ss = '00', z] = compactIso;
    if (z) {
      return new Date(
        Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
      );
    }
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }
  const utcMatch = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utcMatch) {
    const [, y, m, d, hh, mm, ss] = utcMatch;
    return new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
    );
  }

  const utcNoSeconds = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/);
  if (utcNoSeconds) {
    const [, y, m, d, hh, mm] = utcNoSeconds;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0));
  }

  const localMatch = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (localMatch) {
    const [, y, m, d, hh, mm, ss] = localMatch;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }

  const localNoSeconds = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/);
  if (localNoSeconds) {
    const [, y, m, d, hh, mm] = localNoSeconds;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0);
  }

  const dateOnly = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d), 9, 0, 0);
  }

  return null;
};

const recurrenceImportHorizon = (start: Date) => {
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  return end;
};

// RRule frequency constants
const RRULE_FREQ = {
  DAILY: 2,
  WEEKLY: 3,
  MONTHLY: 4,
  YEARLY: 5,
};

const rruleFrequencyMap: Record<string, number> = {
  SECONDLY: 0,
  MINUTELY: 1,
  HOURLY: 2,
  DAILY: RRULE_FREQ.DAILY,
  WEEKLY: RRULE_FREQ.WEEKLY,
  MONTHLY: RRULE_FREQ.MONTHLY,
  YEARLY: RRULE_FREQ.YEARLY,
};

// Get actual RRule weekday constant if available
const getRRuleWeekday = (day: string, ordinal: number | null) => {
  const dayMap: Record<string, string> = {
    MO: 'MO',
    TU: 'TU',
    WE: 'WE',
    TH: 'TH',
    FR: 'FR',
    SA: 'SA',
    SU: 'SU',
  };

  const dayStr = dayMap[day];
  if (!dayStr) return null;

  // Try to access the real RRule weekday constant
  const weekdayConst = (RRule as any)[dayStr];
  if (!weekdayConst) return null;

  if (ordinal) {
    return typeof weekdayConst.nth === 'function' ? weekdayConst.nth(ordinal) : weekdayConst;
  }
  return weekdayConst;
};

const rruleWeekdayMap: Record<string, any> = {
  MO: { index: 0, nth: (n: number) => ({ index: 0, nth_val: n }) },
  TU: { index: 1, nth: (n: number) => ({ index: 1, nth_val: n }) },
  WE: { index: 2, nth: (n: number) => ({ index: 2, nth_val: n }) },
  TH: { index: 3, nth: (n: number) => ({ index: 3, nth_val: n }) },
  FR: { index: 4, nth: (n: number) => ({ index: 4, nth_val: n }) },
  SA: { index: 5, nth: (n: number) => ({ index: 5, nth_val: n }) },
  SU: { index: 6, nth: (n: number) => ({ index: 6, nth_val: n }) },
};

const parseRRuleValue = (value: string, dtstart: Date) => {
  const options: Record<string, unknown> = { dtstart };

  for (const part of value.split(';')) {
    const [rawKey, rawValue] = part.split('=');
    const key = rawKey?.trim().toUpperCase();
    const partValue = rawValue?.trim() ?? '';
    if (!key || !partValue) continue;

    if (key === 'FREQ') {
      const freq = rruleFrequencyMap[partValue.toUpperCase()];
      if (typeof freq === 'number') {
        options.freq = freq;
      }
      continue;
    }

    if (key === 'INTERVAL') {
      const interval = Number(partValue);
      if (Number.isFinite(interval) && interval > 0) {
        options.interval = interval;
      }
      continue;
    }

    if (key === 'COUNT') {
      const count = Number(partValue);
      if (Number.isFinite(count) && count > 0) {
        options.count = count;
      }
      continue;
    }

    if (key === 'UNTIL') {
      const until = parseIcsDate(partValue);
      if (until) {
        options.until = until;
      }
      continue;
    }

    if (key === 'BYDAY') {
      const byweekday = partValue
        .split(',')
        .map((token) => token.trim().toUpperCase())
        .map((token) => {
          const match = token.match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/);
          if (!match) return null;
          const ordinal = match[1] ? Number(match[1]) : null;
          // Try to get the real RRule weekday constant first
          const rruleWeekday = getRRuleWeekday(match[2], ordinal);
          if (rruleWeekday) return rruleWeekday;
          // Fallback to mock object
          const weekday = rruleWeekdayMap[match[2]];
          if (!weekday) return null;
          return ordinal ? weekday.nth(ordinal) : weekday;
        })
        .filter(Boolean);

      if (byweekday.length > 0) {
        options.byweekday = byweekday;
      }
      continue;
    }

    if (key === 'BYMONTHDAY') {
      const bymonthday = partValue
        .split(',')
        .map((token) => Number(token.trim()))
        .filter((token) => Number.isFinite(token) && token !== 0);

      if (bymonthday.length > 0) {
        options.bymonthday = bymonthday;
      }
      continue;
    }

    if (key === 'BYMONTH') {
      const bymonth = partValue
        .split(',')
        .map((token) => Number(token.trim()))
        .filter((token) => Number.isFinite(token) && token >= 1 && token <= 12);

      if (bymonth.length > 0) {
        options.bymonth = bymonth;
      }
      continue;
    }

    if (key === 'WKST') {
      const dayStr = partValue.toUpperCase();
      const rruleWeekday = getRRuleWeekday(dayStr, null);
      if (rruleWeekday) {
        options.wkst = rruleWeekday;
      } else {
        const wkst = rruleWeekdayMap[dayStr];
        if (wkst) {
          options.wkst = wkst;
        }
      }
    }
  }

  if (typeof options.freq !== 'number') return null;
  return options;
};

const expandRecurringIcsEvent = (
  baseEvent: Omit<ParsedIcsEvent, 'startAt' | 'endAt'>,
  start: Date,
  end: Date,
  rruleValue: string
): ParsedIcsEvent[] => {
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const options = parseRRuleValue(rruleValue, start);
  if (!options) {
    console.warn('[expandRecurringIcsEvent] Failed to parse RRULE:', rruleValue);
    return [
      {
        ...baseEvent,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      },
    ];
  }

  try {
    const rule = new RRule(options as ConstructorParameters<typeof RRule>[0]);
    const hasExplicitLimit = Boolean(options.count || options.until);
    const occurrences = hasExplicitLimit
      ? rule.all()
      : rule.between(start, recurrenceImportHorizon(start), true);

    console.log('[expandRecurringIcsEvent] Expanded:', {
      rruleValue,
      occurrenceCount: occurrences.length,
      hasExplicitLimit,
    });

    if (occurrences.length === 0) {
      return [
        {
          ...baseEvent,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        },
      ];
    }

    return occurrences.map((occurrence: Date) => ({
      ...baseEvent,
      startAt: occurrence.toISOString(),
      endAt: new Date(occurrence.getTime() + durationMs).toISOString(),
    }));
  } catch (error) {
    // Fallback if RRule fails
    console.warn('RRULE expansion failed:', error);
    return [
      {
        ...baseEvent,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      },
    ];
  }
};

const parseIcsEvents = (rawIcs: string): ParsedIcsEvent[] => {
  const text = unfoldIcsLines(rawIcs);
  const out: ParsedIcsEvent[] = [];
  let blockCount = 0;

  const parseBlock = (section: string, blockType: 'VEVENT' | 'VTODO' | 'VJOURNAL') => {
    blockCount++;
    const lines = section
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const props: Record<string, string[]> = {};

    for (const line of lines) {
      const sep = line.indexOf(':');
      if (sep <= 0) continue;
      const keyRaw = line.slice(0, sep).toUpperCase();
      const key = keyRaw.split(';')[0];
      const value = line.slice(sep + 1);

      if (!props[key]) props[key] = [];
      props[key].push(value);
    }

    const summary = props.SUMMARY?.[0] ?? '';
    const dtStart = props.DTSTART?.[0] ?? '';
    const dtEnd = props.DTEND?.[0] ?? '';
    const dtStamp = props.DTSTAMP?.[0] ?? '';
    const due = props.DUE?.[0] ?? '';
    const rrule = props.RRULE?.[0] ?? '';
    const description = (props.DESCRIPTION?.[0] ?? '')
      .replace(/\\n/g, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';');
    const location = (props.LOCATION?.[0] ?? '').replace(/\\,/g, ',').replace(/\\;/g, ';');

    const start = parseIcsDate(dtStart || due || dtStamp);
    let end = parseIcsDate(dtEnd || due);
    if (!start) {
      console.warn(`[parseIcsEvents] Block ${blockCount} skipped: no valid start date`, {
        dtStart,
        due,
        dtStamp,
      });
      return;
    }
    if (!end) {
      end = new Date(start);
      const isDateOnly = /^\d{8}$/.test((dtStart || due || '').trim());
      end.setHours(start.getHours() + (isDateOnly ? 24 : 1));
    }
    if (end <= start) {
      const fallbackEnd = new Date(start);
      fallbackEnd.setHours(start.getHours() + (blockType === 'VTODO' ? 24 : 1));
      end = fallbackEnd;
    }

    const baseEvent = {
      title: summary || 'Imported Event',
      notes: description || undefined,
      location: location || undefined,
    };

    // Expand recurring events
    if (rrule) {
      const beforeCount = out.length;
      out.push(...expandRecurringIcsEvent(baseEvent, start, end, rrule));
      const afterCount = out.length;
      console.log(
        `[parseIcsEvents] Block ${blockCount} (${blockType}): "${summary}" expanded from ${beforeCount} to ${afterCount} (${
          afterCount - beforeCount
        } instances from RRULE)`
      );
      return;
    }

    out.push({
      ...baseEvent,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    });
    console.log(`[parseIcsEvents] Block ${blockCount} (${blockType}): "${summary}" (single event)`);
  };

  const componentRegex = /BEGIN:(VEVENT|VTODO|VJOURNAL)\s*([\s\S]*?)END:\1/gi;
  let componentCount = 0;
  for (const match of text.matchAll(componentRegex)) {
    componentCount++;
    const blockType = (match[1] || '').toUpperCase() as 'VEVENT' | 'VTODO' | 'VJOURNAL';
    const section = match[2] || '';
    parseBlock(section, blockType);
  }

  console.log(`[parseIcsEvents] Total: ${componentCount} components → ${out.length} events`);
  return out;
};

export const CalendarWindow = () => {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const { workspaceShellLayout } = useSidebar();
  const api = useApi();
  const viewportWidth = useViewportWidth();
  const centerScrollRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedDataRef = useRef(false);
  const hasAppliedInitialFocusContextRef = useRef(false);
  const initialFocusDate = new URLSearchParams(window.location.search).get('focusDate');
  const initialFocusContext =
    new URLSearchParams(window.location.search).get('focusContext')?.trim() ?? '';
  const initialCalendarSection =
    new URLSearchParams(window.location.search).get('section')?.trim() ?? '';
  const [viewMode, setViewMode] = useState<CalendarViewMode>(
    initialCalendarSection === 'day' || initialCalendarSection === 'month'
      ? initialCalendarSection
      : 'week'
  );
  const [viewAnchor, setViewAnchor] = useState(() => {
    const date = parseValidCalendarDate(initialFocusDate);
    if (date) {
      date.setHours(0, 0, 0, 0);
      return date;
    }
    return new Date();
  });
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [editingCalendarId, setEditingCalendarId] = useState<string | null>(null);
  const [editingCalendarName, setEditingCalendarName] = useState('');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inboxCount, setInboxCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);

  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDate, setNewEventDate] = useState(() => formatDateKey(new Date()));
  const [newEventTime, setNewEventTime] = useState('09:00');
  const [newEventDurationValue, setNewEventDurationValue] = useState(30);
  const [newEventDurationUnit, setNewEventDurationUnit] = useState<'minutes' | 'hours'>('minutes');
  const [newEventRecurrence, setNewEventRecurrence] = useState<
    'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays' | 'specific_dates'
  >('none');
  const [newEventSpecificDates, setNewEventSpecificDates] = useState<string[]>([]);
  const [composerMode, setComposerMode] = useState<'event' | 'reminder'>('event');
  const [composerCalendarId, setComposerCalendarId] = useState('');
  const [composerProjectId, setComposerProjectId] = useState('');
  const [composerNoteId, setComposerNoteId] = useState('');
  const [composerNotes, setComposerNotes] = useState('');
  const [newEventVisibility, setNewEventVisibility] = useState<'private' | 'workspace'>('private');
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [, setIsSyncingApple] = useState(false);
  const [appleSyncMessage, setAppleSyncMessage] = useState<string | null>(null);
  const [isAppleSyncMessageVisible, setIsAppleSyncMessageVisible] = useState(false);
  const [isImportingIcs, setIsImportingIcs] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isImportMessageVisible, setIsImportMessageVisible] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [gridQuickAdd, setGridQuickAdd] = useState<GridQuickAddState | null>(null);
  const [gridQuickTitle, setGridQuickTitle] = useState('');
  const [contextMenu, setContextMenu] = useState<CalendarContextMenuState | null>(null);
  const [calendarRowContextMenu, setCalendarRowContextMenu] =
    useState<CalendarRowContextMenuState | null>(null);
  const [calendarColorMenu, setCalendarColorMenu] = useState<CalendarColorMenuState | null>(null);
  const [listContextMenu, setListContextMenu] = useState<ListContextMenuState | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [eventEditorEvent, setEventEditorEvent] = useState<EventRow | null>(null);
  const [selectedReminder, setSelectedReminder] = useState<ReminderRow | null>(null);
  const [pendingFocusEventId, setPendingFocusEventId] = useState<string | null>(null);
  const [pendingFocusReminderId, setPendingFocusReminderId] = useState<string | null>(null);
  const [eventNotesDrafts, setEventNotesDrafts] = useState<Record<string, string>>({});
  const [followUpTasksByEvent, setFollowUpTasksByEvent] = useState<Record<string, TaskRow[]>>({});
  const [isLinkProjectModalOpen, setIsLinkProjectModalOpen] = useState(false);
  const [linkProjectsSearch, setLinkProjectsSearch] = useState('');
  const [linkProjects, setLinkProjects] = useState<
    Array<{ id: string; name: string; color?: string }>
  >([]);
  const [isLoadingLinkProjects, setIsLoadingLinkProjects] = useState(false);
  const [isLinkingProject, setIsLinkingProject] = useState(false);
  const [isLinkNoteModalOpen, setIsLinkNoteModalOpen] = useState(false);
  const [linkNotesSearch, setLinkNotesSearch] = useState('');
  const [linkNotes, setLinkNotes] = useState<NoteRow[]>([]);
  const [isLoadingLinkNotes, setIsLoadingLinkNotes] = useState(false);
  const [isLinkingNote, setIsLinkingNote] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editDurationValue, setEditDurationValue] = useState(30);
  const [editDurationUnit, setEditDurationUnit] = useState<'minutes' | 'hours'>('minutes');
  const [editStatus, setEditStatus] = useState<'planned' | 'done' | 'missed' | 'cancelled'>(
    'planned'
  );
  const [editCalendarId, setEditCalendarId] = useState('');
  const [editColor, setEditColor] = useState('#93C5FD');
  const [editProjectId, setEditProjectId] = useState('');
  const [editNoteId, setEditNoteId] = useState('');
  const [editVisibility, setEditVisibility] = useState<'private' | 'workspace'>('private');
  const [editRecurrence, setEditRecurrence] = useState<
    'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays'
  >('none');
  const [reminderEditTitle, setReminderEditTitle] = useState('');
  const [reminderEditDate, setReminderEditDate] = useState('');
  const [reminderEditTime, setReminderEditTime] = useState('');
  const [reminderEditCalendarId, setReminderEditCalendarId] = useState('');
  const [reminderEditColor, setReminderEditColor] = useState('#F59E0B');
  const [reminderEditDone, setReminderEditDone] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  const [isDeletingReminder, setIsDeletingReminder] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, setCalendarColorDrafts] = useState<Record<string, string>>({});
  const [isSavingColorId, setIsSavingColorId] = useState<string | null>(null);
  const [isSpecificDatesModalOpen, setIsSpecificDatesModalOpen] = useState(false);
  const [specificDatesDraft, setSpecificDatesDraft] = useState<string[]>([]);
  const [specificDatesMonthAnchor, setSpecificDatesMonthAnchor] = useState(() =>
    startOfMonth(new Date())
  );
  const [specificDatesCleared, setSpecificDatesCleared] = useState(false);
  const specificDatesPreviousRepeatRef = useRef<
    'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays' | 'specific_dates'
  >('none');
  const [defaultEventDurationMinutes, setDefaultEventDurationMinutes] = useState(30);
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);
  const [isNewCalendarModalOpen, setIsNewCalendarModalOpen] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [newCalendarColor, setNewCalendarColor] = useState(preferenceColorMap['ledger-orange']);
  const [isCreatingCalendar, setIsCreatingCalendar] = useState(false);
  const [calendarPreferences, setCalendarPreferences] = useState<CalendarPreferenceSnapshot>({
    weekStartsOn: 'monday',
    timeFormat: '12h',
    defaultEventMinutes: 30,
    defaultEventCalendar: 'personal',
    defaultEventStatus: 'planned',
    defaultEventVisibility: 'private',
    defaultReminderTime: '09:00',
    defaultCalendarView: 'week',
    showWeekends: true,
    showRemindersOnCalendar: true,
    showCompletedItems: 'muted',
    reminderSnoozePreset: '10m-1h-tomorrow',
    reminderDestination: 'today-calendar',
    missedReminderBehavior: 'needs_attention',
    completedReminderBehavior: 'collapse',
    pastEventBehavior: 'history',
    followUpBehavior: 'offer',
    followUpDefaultTime: 'tomorrow_9',
    eventNotesBehavior: 'enabled',
    linkedProjectFollowUps: 'project_and_today',
    defaultWorkspaceCalendar: 'personal',
    calendarScope: 'current_workspace',
    calendarColor: 'ledger-orange',
  });
  const [calendarRefreshToken, setCalendarRefreshToken] = useState(0);
  const [leftPaneWidth, setLeftPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.calendar.left)
  );
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [rightPaneWidth, setRightPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.calendar.right)
  );
  const [isResizingRightPane, setIsResizingRightPane] = useState(false);
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(false);
  const [isRightPaneCollapsed, setIsRightPaneCollapsed] = useState(true);
  const [overflowDayKey, setOverflowDayKey] = useState<string | null>(null);
  const areSidePanelsCollapsed = isLeftPaneCollapsed && isRightPaneCollapsed;

  const handleCalendarWorkspaceRefresh = useCallback(() => {
    setCalendarRefreshToken((current) => current + 1);
  }, []);

  useWorkspaceRealtimeRefresh({
    workspaceId: activeWorkspaceId,
    tables: ['events', 'reminders', 'notes', 'tasks', 'projects'],
    enabled: Boolean(user && activeWorkspaceId),
    onChange: handleCalendarWorkspaceRefresh,
  });

  useEffect(() => {
    const onHideSidePanelsShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey) return;
      if (event.key.toLowerCase() !== 'h') return;

      event.preventDefault();
      if (areSidePanelsCollapsed) {
        setIsLeftPaneCollapsed(false);
        setIsRightPaneCollapsed(false);
      } else {
        setIsLeftPaneCollapsed(true);
        setIsRightPaneCollapsed(true);
      }
    };

    window.addEventListener('keydown', onHideSidePanelsShortcut);
    return () => window.removeEventListener('keydown', onHideSidePanelsShortcut);
  }, [areSidePanelsCollapsed]);

  useEffect(() => {
    if (!user) {
      setInboxCount(0);
      return;
    }

    let cancelled = false;
    const loadInboxCount = async () => {
      try {
        const payload = (await api.getInboxCount()) as { count?: number };
        if (!cancelled) {
          setInboxCount(Math.max(0, Number(payload?.count ?? 0)));
        }
      } catch {
        if (!cancelled) setInboxCount(0);
      }
    };

    void loadInboxCount();

    const handleRefreshInboxCount = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void loadInboxCount();
    };

    const handleInboxItemsUpdated = (_event: unknown, payload?: { delta?: number }) => {
      if (typeof payload?.delta === 'number' && Number.isFinite(payload.delta)) {
        setInboxCount((current) => Math.max(0, current + payload.delta!));
        return;
      }

      void loadInboxCount();
    };

    window.ipcRenderer?.on('inbox:items-updated', handleInboxItemsUpdated);
    window.addEventListener('focus', handleRefreshInboxCount);
    document.addEventListener('visibilitychange', handleRefreshInboxCount);

    const timer = window.setInterval(() => {
      void loadInboxCount();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.ipcRenderer?.off('inbox:items-updated', handleInboxItemsUpdated);
      window.removeEventListener('focus', handleRefreshInboxCount);
      document.removeEventListener('visibilitychange', handleRefreshInboxCount);
    };
  }, [api, user]);

  useEffect(() => {
    if (!user) {
      setNotificationCount(0);
      return;
    }

    let cancelled = false;
    const loadNotificationCount = async () => {
      try {
        const payload = (await api.getNotificationCenterSummary()) as {
          counts?: { active?: number };
        };
        if (!cancelled) {
          setNotificationCount(Number(payload?.counts?.active ?? 0));
        }
      } catch {
        if (!cancelled) setNotificationCount(0);
      }
    };

    const handleNotificationsSummary = (event: Event) => {
      const detail = (event as CustomEvent<{ activeCount?: number }>).detail;
      setNotificationCount(Number(detail?.activeCount ?? 0));
    };

    void loadNotificationCount();
    window.addEventListener(
      'ledger:notifications-summary',
      handleNotificationsSummary as EventListener
    );

    const timer = window.setInterval(() => {
      void loadNotificationCount();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(
        'ledger:notifications-summary',
        handleNotificationsSummary as EventListener
      );
    };
  }, [api, user]);

  const monthPreview = useMemo(() => {
    const start = startOfMonthGrid(viewAnchor);
    return {
      label: viewAnchor.toLocaleDateString([], { month: 'long', year: 'numeric' }),
      dates: Array.from({ length: 42 }, (_, i) => addDays(start, i)),
    };
  }, [viewAnchor]);
  const specificDatesMonthGrid = useMemo(
    () => buildMonthGrid(specificDatesMonthAnchor),
    [specificDatesMonthAnchor]
  );
  const specificDatesDraftPreview = useMemo(
    () => formatSpecificDatesPreview(specificDatesDraft),
    [specificDatesDraft]
  );
  const specificDatesValidationMessage =
    newEventRecurrence === 'specific_dates' && newEventSpecificDates.length === 0
      ? 'Choose at least one date.'
      : null;
  const selectedEventPreview = useMemo(() => {
    if (!selectedEvent) return null;
    const fresh = events.find((row) => row.id === baseEventId(selectedEvent.id));
    if (!fresh) return null;
    if (fresh.id === selectedEvent.id) return fresh;
    return {
      ...fresh,
      id: selectedEvent.id,
      start_at: selectedEvent.start_at,
      end_at: selectedEvent.end_at,
    };
  }, [events, selectedEvent]);
  const isInitialLoading = isLoading && !hasLoadedData;

  const focusEventById = (eventIdRaw: string) => {
    const eventId = baseEventId(eventIdRaw);
    const target = events.find((event) => baseEventId(event.id) === eventId) ?? null;
    if (!target) {
      setPendingFocusEventId(eventId);
      return;
    }
    setSelectedEvent(target);
    setSelectedReminder(null);
    setViewMode('day');
    const eventDate = new Date(target.start_at);
    eventDate.setHours(0, 0, 0, 0);
    setViewAnchor(eventDate);
    setPendingFocusEventId(null);
  };

  const focusReminderById = (reminderIdRaw: string) => {
    const reminderId = baseReminderId(reminderIdRaw);
    const target = reminders.find((reminder) => baseReminderId(reminder.id) === reminderId) ?? null;
    if (!target) {
      setPendingFocusReminderId(reminderId);
      return;
    }
    setSelectedReminder(target);
    setSelectedEvent(null);
    setViewMode('day');
    const reminderDate = new Date(target.remind_at);
    reminderDate.setHours(0, 0, 0, 0);
    setViewAnchor(reminderDate);
    setPendingFocusReminderId(null);
  };

  const getEventStatusMeta = (status?: EventRow['status']) => {
    switch (status) {
      case 'done':
        return {
          label: 'Done',
          chipClass:
            'border-[color:rgba(50,213,131,0.26)] bg-[color:rgba(50,213,131,0.12)] text-[rgb(150,255,201)]',
          dotClass: 'bg-[rgb(50,213,131)]',
          previewClass:
            'bg-[color:rgba(50,213,131,0.12)] border-[color:rgba(50,213,131,0.22)] text-[var(--ledger-text-primary)]',
        };
      case 'missed':
        return {
          label: 'Missed',
          chipClass:
            'border-[color:rgba(245,158,11,0.26)] bg-[color:rgba(245,158,11,0.12)] text-[rgb(253,224,130)]',
          dotClass: 'bg-[rgb(245,158,11)]',
          previewClass:
            'bg-[color:rgba(245,158,11,0.12)] border-[color:rgba(245,158,11,0.22)] text-[var(--ledger-text-primary)]',
        };
      case 'cancelled':
        return {
          label: 'Cancelled',
          chipClass:
            'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-secondary)]',
          dotClass: 'bg-[var(--ledger-text-muted)]',
          previewClass:
            'bg-[var(--ledger-surface-hover)] border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-secondary)]',
        };
      default:
        return {
          label: 'Planned',
          chipClass:
            'border-[color:rgba(59,130,246,0.26)] bg-[color:rgba(59,130,246,0.12)] text-[rgb(191,219,254)]',
          dotClass: 'bg-[rgb(59,130,246)]',
          previewClass:
            'bg-[color:rgba(59,130,246,0.12)] border-[color:rgba(59,130,246,0.22)] text-[var(--ledger-text-primary)]',
        };
    }
  };
  useEffect(() => {
    const applyFocusDate = (focusDate: string) => {
      const date = parseValidCalendarDate(focusDate);
      if (!date) return;
      date.setHours(0, 0, 0, 0);
      setViewAnchor(date);
    };

    if (initialFocusDate) {
      applyFocusDate(initialFocusDate);
    }

    const focusDateListener = (
      _event: unknown,
      payload: { kind?: string; focusDate?: string | null }
    ) => {
      if (payload?.kind === 'calendar' && payload.focusDate) {
        applyFocusDate(payload.focusDate);
      }
    };

    window.ipcRenderer?.on('module:focus-date', focusDateListener);

    return () => {
      window.ipcRenderer?.off('module:focus-date', focusDateListener);
    };
  }, [initialFocusDate]);

  useEffect(() => {
    const applyFocusContext = (focusContext: string | null | undefined) => {
      if (!focusContext) return;
      if (focusContext.startsWith('focus-event:')) {
        const eventId = focusContext.slice('focus-event:'.length).trim();
        if (eventId) {
          focusEventById(eventId);
        }
        return;
      }
      if (focusContext.startsWith('focus-reminder:')) {
        const reminderId = focusContext.slice('focus-reminder:'.length).trim();
        if (reminderId) {
          focusReminderById(reminderId);
        }
      }
    };

    if (!hasAppliedInitialFocusContextRef.current) {
      applyFocusContext(initialFocusContext);
      hasAppliedInitialFocusContextRef.current = true;
    }

    const focusContextListener = (
      _event: unknown,
      payload: { kind?: string; focusContext?: string | null }
    ) => {
      if (payload?.kind !== 'calendar') return;
      applyFocusContext(payload.focusContext);
    };

    window.ipcRenderer?.on('module:focus-context', focusContextListener);
    return () => {
      window.ipcRenderer?.off('module:focus-context', focusContextListener);
    };
  }, [initialFocusContext, events, reminders]);

  useEffect(() => {
    if (!pendingFocusEventId) return;
    focusEventById(pendingFocusEventId);
  }, [events, pendingFocusEventId]);

  useEffect(() => {
    if (!pendingFocusReminderId) return;
    focusReminderById(pendingFocusReminderId);
  }, [reminders, pendingFocusReminderId]);

  useEffect(() => {
    setLeftPaneWidth((current) =>
      clampPaneWidth(current, viewportWidth, modulePaneSizing.calendar.left)
    );
    setRightPaneWidth((current) =>
      clampPaneWidth(current, viewportWidth, modulePaneSizing.calendar.right)
    );
  }, [viewportWidth]);

  const viewConfig = useMemo(() => {
    if (viewMode === 'day') {
      const start = startOfDay(viewAnchor);
      const end = addDays(start, 1);
      return {
        label: start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
        start,
        end,
        dates: [start],
      };
    }

    if (viewMode === 'month') {
      const monthStart = startOfMonth(viewAnchor);
      const start = startOfMonthGrid(viewAnchor);
      const end = addDays(start, 42);
      const monthLabel = monthStart.toLocaleDateString([], { month: 'long', year: 'numeric' });
      return {
        label: monthLabel,
        start,
        end,
        dates: Array.from({ length: 42 }, (_, i) => addDays(start, i)),
      };
    }

    const start = startOfWeek(viewAnchor, calendarPreferences.weekStartsOn);
    const end = addDays(start, calendarPreferences.showWeekends ? 7 : 5);
    const dates = calendarPreferences.showWeekends
      ? Array.from({ length: 7 }, (_, i) => addDays(start, i))
      : Array.from({ length: 5 }, (_, i) => addDays(start, i));
    return {
      label: `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${new Date(
        end.getTime() - 1
      ).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`,
      start,
      end,
      dates,
    };
  }, [viewAnchor, viewMode, calendarPreferences.showWeekends, calendarPreferences.weekStartsOn]);

  const visibleCalendarIdsMemo = useMemo(() => {
    return new Set(calendars.filter((calendar) => calendar.is_visible !== false).map((c) => c.id));
  }, [calendars]);

  const isPastEvent = (event: EventRow) => new Date(event.end_at).getTime() < Date.now();
  const canEditEvent = (event: EventRow) => !isPastEvent(event);
  const isPastReminder = (reminder: ReminderRow) =>
    new Date(reminder.remind_at).getTime() < Date.now();
  const isPastEventMuted = (event: EventRow) =>
    isPastEvent(event) && (calendarPreferences.pastEventBehavior ?? 'history') === 'fade';
  const shouldHidePastEvent = (event: EventRow) =>
    isPastEvent(event) && (calendarPreferences.pastEventBehavior ?? 'history') === 'upcoming_only';
  const shouldHideReminder = (reminder: ReminderRow) => {
    if (!calendarPreferences.showRemindersOnCalendar) return true;
    if (calendarPreferences.showCompletedItems === 'hidden' && reminder.is_done) return true;
    const isOverdue = isPastReminder(reminder) && !reminder.is_done;
    if (isOverdue && (calendarPreferences.missedReminderBehavior ?? 'needs_attention') === 'hide') {
      return true;
    }
    if (
      reminder.is_done &&
      (calendarPreferences.completedReminderBehavior ?? 'collapse') === 'hide_immediately'
    ) {
      return true;
    }
    return false;
  };

  const visibleEvents = useMemo(() => {
    const expanded: EventRow[] = [];
    // Use the precomputed visibleCalendarIds to filter events
    const visibleCalendarIds = visibleCalendarIdsMemo;
    for (const event of events) {
      if (!visibleCalendarIds.has(event.calendar_id)) continue;
      if (calendarPreferences.showCompletedItems === 'hidden' && event.status === 'done') continue;
      if (shouldHidePastEvent(event)) continue;
      const recurrence = event.recurrence_rule ?? 'none';
      if (recurrence === 'none' || recurrence === 'specific_dates') {
        expanded.push(event);
        continue;
      }

      const baseStart = new Date(event.start_at);
      const baseEnd = new Date(event.end_at);
      const durationMs = baseEnd.getTime() - baseStart.getTime();

      let cursor = startOfDay(viewConfig.start);
      const hardEnd = endOfLocalDay(viewConfig.end);

      while (cursor <= hardEnd) {
        const sameWeekday = cursor.getDay() === baseStart.getDay();
        const sameMonthDay = cursor.getDate() === baseStart.getDate();
        const isWeekday = cursor.getDay() >= 1 && cursor.getDay() <= 5;
        const matches =
          recurrence === 'daily' ||
          (recurrence === 'weekly' && sameWeekday) ||
          (recurrence === 'monthly' && sameMonthDay) ||
          (recurrence === 'weekdays' && isWeekday);

        if (matches) {
          const occurrenceStart = new Date(cursor);
          occurrenceStart.setHours(
            baseStart.getHours(),
            baseStart.getMinutes(),
            baseStart.getSeconds(),
            baseStart.getMilliseconds()
          );

          if (
            occurrenceStart >= baseStart &&
            occurrenceStart >= viewConfig.start &&
            occurrenceStart < viewConfig.end
          ) {
            const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
            // Debug: log if baseStart or occurrenceStart have unexpected midnight hours
            try {
              if (baseStart.getHours() === 0 || occurrenceStart.getHours() === 0) {
                console.debug('[Calendar] recurrence expansion hours', {
                  eventId: event.id,
                  baseStart: baseStart.toISOString(),
                  baseStartHours: baseStart.getHours(),
                  occurrenceStart: occurrenceStart.toISOString(),
                  occurrenceHours: occurrenceStart.getHours(),
                });
              }
            } catch (err) {
              /* ignore */
            }
            expanded.push({
              ...event,
              id: `${event.id}__${formatDateKey(occurrenceStart)}`,
              start_at: occurrenceStart.toISOString(),
              end_at: occurrenceEnd.toISOString(),
            });
          }
        }

        cursor = addDays(cursor, 1);
      }
    }

    expanded.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    return expanded;
  }, [
    events,
    viewConfig.start,
    viewConfig.end,
    visibleCalendarIdsMemo,
    calendarPreferences.showCompletedItems,
  ]);

  const calendarById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars]
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);

  const eventsByDay = useMemo(() => {
    const grouped: Record<string, EventRow[]> = {};
    for (const date of viewConfig.dates) grouped[formatDateKey(date)] = [];

    for (const evt of visibleEvents) {
      const key = formatDateKey(new Date(evt.start_at));
      // Debug: detect suspicious midnight times on past events
      try {
        const h = new Date(evt.start_at).getHours();
        const isPast = new Date(evt.end_at).getTime() < Date.now();
        if (isPast && h === 0) {
          console.debug('[Calendar] past event at midnight', {
            id: evt.id,
            start_at: evt.start_at,
            end_at: evt.end_at,
          });
        }
      } catch (err) {
        // ignore
      }
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(evt);
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    }

    // If a specific occurrence is selected (could be a recurrence occurrence), ensure
    // it appears in the grouped results for its day so the center timeline can render it.
    try {
      if (selectedEvent) {
        const selectedKey = formatDateKey(new Date(selectedEvent.start_at));
        if (grouped[selectedKey]) {
          const exists = grouped[selectedKey].some((e) => e.id === selectedEvent.id);
          if (!exists) {
            grouped[selectedKey].push(selectedEvent);
            grouped[selectedKey].sort(
              (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
            );
          }
        }
      }
    } catch (err) {
      // ignore
    }

    return grouped;
  }, [visibleEvents, viewConfig.dates]);

  const remindersByDay = useMemo(() => {
    const grouped: Record<string, ReminderRow[]> = {};
    for (const date of viewConfig.dates) grouped[formatDateKey(date)] = [];

    if (!calendarPreferences.showRemindersOnCalendar) {
      return grouped;
    }

    const todayKey = formatDateKey(new Date());
    for (const reminder of reminders) {
      // only include reminders from visible calendars
      if (!visibleCalendarIdsMemo.has(reminder.calendar_id)) continue;
      if (shouldHideReminder(reminder)) continue;
      const recurrence = reminder.recurrence_rule ?? 'none';
      if (recurrence === 'none' || recurrence === 'specific_dates') {
        const isOverdue = isPastReminder(reminder) && !reminder.is_done;
        const key =
          isOverdue && (calendarPreferences.missedReminderBehavior ?? 'needs_attention') === 'today'
            ? todayKey
            : formatDateKey(new Date(reminder.remind_at));
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(reminder);
        continue;
      }

      const baseStart = new Date(reminder.remind_at);
      const hardEnd = endOfLocalDay(viewConfig.end);
      let cursor = startOfDay(viewConfig.start);

      while (cursor <= hardEnd) {
        const sameWeekday = cursor.getDay() === baseStart.getDay();
        const sameMonthDay = cursor.getDate() === baseStart.getDate();
        const isWeekday = cursor.getDay() >= 1 && cursor.getDay() <= 5;
        const matches =
          recurrence === 'daily' ||
          (recurrence === 'weekly' && sameWeekday) ||
          (recurrence === 'monthly' && sameMonthDay) ||
          (recurrence === 'weekdays' && isWeekday);

        if (matches) {
          const occurrenceAt = new Date(cursor);
          occurrenceAt.setHours(
            baseStart.getHours(),
            baseStart.getMinutes(),
            baseStart.getSeconds(),
            baseStart.getMilliseconds()
          );

          if (
            occurrenceAt >= baseStart &&
            occurrenceAt >= viewConfig.start &&
            occurrenceAt < viewConfig.end
          ) {
            const key = formatDateKey(occurrenceAt);
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push({
              ...reminder,
              id: `${reminder.id}__${key}`,
              remind_at: occurrenceAt.toISOString(),
            });
          }
        }

        cursor = addDays(cursor, 1);
      }
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].sort(
        (a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime()
      );
    }

    return grouped;
  }, [
    reminders,
    viewConfig.dates,
    visibleCalendarIdsMemo,
    calendarPreferences.showRemindersOnCalendar,
  ]);

  const selectedContextDate = selectedEventPreview
    ? new Date(selectedEventPreview.start_at)
    : selectedReminder
    ? new Date(selectedReminder.remind_at)
    : viewAnchor;
  const selectedContextDayKey = formatDateKey(selectedContextDate);
  const selectedContextDayEvents = eventsByDay[selectedContextDayKey] ?? [];
  const selectedContextDayReminders = remindersByDay[selectedContextDayKey] ?? [];
  const activeVisibleEvents = visibleEvents.filter((event) => event.status !== 'done');
  const activeRemindersByDay = Object.values(remindersByDay).reduce(
    (total, items) => total + items.filter((reminder) => !reminder.is_done).length,
    0
  );
  const selectedContextDayActiveEvents = selectedContextDayEvents.filter(
    (event) => event.status !== 'done'
  );
  const selectedContextDayActiveReminders = selectedContextDayReminders.filter(
    (reminder) => !reminder.is_done
  );
  const overviewEventCount = activeVisibleEvents.length;
  const overviewReminderCount = activeRemindersByDay;
  const selectedContextDayEventCount = selectedContextDayActiveEvents.length;
  const selectedContextDayReminderCount = selectedContextDayActiveReminders.length;
  const selectedContextDayEventCountLabel = `${selectedContextDayEventCount} event${
    selectedContextDayEventCount === 1 ? '' : 's'
  }`;
  const selectedContextDayReminderCountLabel = `${selectedContextDayReminderCount} reminder${
    selectedContextDayReminderCount === 1 ? '' : 's'
  }`;
  const selectedTimelineDate = selectedEventPreview
    ? new Date(selectedEventPreview.start_at)
    : selectedReminder
    ? new Date(selectedReminder.remind_at)
    : null;
  const selectedTimelineHour = selectedTimelineDate?.getHours() ?? null;
  const selectedTimelineInVisibleHours =
    selectedTimelineHour !== null &&
    selectedTimelineHour >= CALENDAR_DAY_START_HOUR &&
    selectedTimelineHour <= CALENDAR_DAY_END_HOUR;
  const use24HourTime = calendarPreferences.timeFormat === '24h';
  const formatCalendarTime = (date: Date) =>
    date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: !use24HourTime,
    });
  const formatCalendarHourLabel = (hour: number) => {
    const date = new Date();
    date.setHours(hour, 0, 0, 0);
    return formatCalendarTime(date);
  };
  const hoursToRender = useMemo(() => {
    const hourSet = new Set<number>(hours.map((h) => Number.parseInt(h.split(':')[0], 10)));

    // Include hours present in visible events/reminders for the current view's dates
    const dateKeys = new Set(viewConfig.dates.map((d) => formatDateKey(d)));

    for (const evt of visibleEvents) {
      const key = formatDateKey(new Date(evt.start_at));
      if (!dateKeys.has(key)) continue;
      const startHour = new Date(evt.start_at).getHours();
      const endHour = new Date(evt.end_at).getHours();
      for (let hour = startHour; hour <= Math.min(CALENDAR_DAY_END_HOUR, endHour); hour += 1) {
        hourSet.add(hour);
      }
    }

    for (const rem of reminders) {
      const key = formatDateKey(new Date(rem.remind_at));
      if (!dateKeys.has(key)) continue;
      hourSet.add(new Date(rem.remind_at).getHours());
    }

    return Array.from(hourSet)
      .sort((a, b) => a - b)
      .map((h) => `${h}:00`);
  }, [hours, visibleEvents, reminders, viewConfig.dates]);
  const selectedEventProject = useMemo(
    () =>
      selectedEventPreview?.project_id
        ? projectById.get(selectedEventPreview.project_id) ?? null
        : null,
    [projectById, selectedEventPreview]
  );
  const selectedEventNote = useMemo(
    () =>
      selectedEventPreview?.note_id ? noteById.get(selectedEventPreview.note_id) ?? null : null,
    [noteById, selectedEventPreview]
  );
  const selectedReminderProject = useMemo(
    () =>
      selectedReminder?.project_id ? projectById.get(selectedReminder.project_id) ?? null : null,
    [projectById, selectedReminder]
  );
  const selectedReminderNote = useMemo(
    () => (selectedReminder?.note_id ? noteById.get(selectedReminder.note_id) ?? null : null),
    [noteById, selectedReminder]
  );
  const isAllDayEvent = (event: EventRow) => {
    if (event.all_day) return true;
    const start = new Date(event.start_at);
    const end = new Date(event.end_at);
    const durationMinutes = (end.getTime() - start.getTime()) / 60000;
    return (
      start.getHours() === 0 &&
      start.getMinutes() === 0 &&
      end.getHours() === 0 &&
      end.getMinutes() === 0 &&
      durationMinutes >= 1380
    );
  };
  const formatEventTimeLabel = (event: EventRow) => {
    if (isAllDayEvent(event)) return 'All day';
    const start = new Date(event.start_at);
    const end = new Date(event.end_at);
    const startLabel = formatCalendarTime(start);
    if (getEventDurationMinutes(event) > 60) {
      const endLabel = formatCalendarTime(end);
      return `${startLabel} – ${endLabel}`;
    }
    return startLabel;
  };
  const formatEventDateTimeLabel = (event: EventRow) =>
    (() => {
      const start = new Date(event.start_at);
      const base = start.toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      if (isAllDayEvent(event)) return base;
      const startLabel = formatCalendarTime(start);
      if (getEventDurationMinutes(event) > 60) {
        const endLabel = formatCalendarTime(new Date(event.end_at));
        return `${base}, ${startLabel} – ${endLabel}`;
      }
      return `${base}, ${startLabel}`;
    })();
  const getEventDurationMinutes = (event: EventRow) =>
    Math.max(
      1,
      Math.round((new Date(event.end_at).getTime() - new Date(event.start_at).getTime()) / 60000)
    );
  const getEventDurationRows = (event: EventRow) =>
    Math.max(1, Math.min(12, Math.ceil(getEventDurationMinutes(event) / 60)));
  const getEventMinuteOffset = (event: EventRow) => {
    const start = new Date(event.start_at);
    return Math.max(0, Math.min(59, start.getMinutes()));
  };
  const formatEventTimeRangeLabel = (event: EventRow) => {
    if (isAllDayEvent(event)) return 'All day';
    const start = new Date(event.start_at);
    const end = new Date(event.end_at);
    const startLabel = formatCalendarTime(start);
    const endLabel = formatCalendarTime(end);
    return `${startLabel} – ${endLabel}`;
  };
  const getDurationDisplay = (minutes: number) => {
    if (minutes >= 60 && minutes % 60 === 0) {
      return { value: minutes / 60, unit: 'hours' as const };
    }
    return { value: minutes, unit: 'minutes' as const };
  };
  const getDurationMinutes = (value: number, unit: 'minutes' | 'hours') =>
    Math.max(1, Math.round(unit === 'hours' ? value * 60 : value));

  useEffect(() => {
    let cancelled = false;

    const loadPreferenceDefaults = async () => {
      try {
        const payload = (await api.getUserSettings()) as {
          preferences?: CalendarPreferenceSnapshot | null;
        };
        if (cancelled) return;

        const nextPreferences: CalendarPreferenceSnapshot = {
          weekStartsOn: payload?.preferences?.weekStartsOn === 'sunday' ? 'sunday' : 'monday',
          timeFormat: payload?.preferences?.timeFormat === '24h' ? '24h' : '12h',
          defaultEventMinutes: [30, 45, 60].includes(
            Number(payload?.preferences?.defaultEventMinutes)
          )
            ? Number(payload?.preferences?.defaultEventMinutes)
            : 30,
          defaultEventCalendar: ['personal', 'work', 'projects'].includes(
            String(payload?.preferences?.defaultEventCalendar)
          )
            ? (payload?.preferences?.defaultEventCalendar as 'personal' | 'work' | 'projects')
            : 'personal',
          defaultEventStatus: ['planned', 'tentative', 'confirmed'].includes(
            String(payload?.preferences?.defaultEventStatus)
          )
            ? (payload?.preferences?.defaultEventStatus as 'planned' | 'tentative' | 'confirmed')
            : 'planned',
          defaultEventVisibility:
            payload?.preferences?.defaultEventVisibility === 'workspace' ? 'workspace' : 'private',
          defaultReminderTime: ['08:00', '09:00', '12:00', '17:00'].includes(
            String(payload?.preferences?.defaultReminderTime)
          )
            ? (payload?.preferences?.defaultReminderTime as '08:00' | '09:00' | '12:00' | '17:00')
            : '09:00',
          defaultCalendarView: ['day', 'week', 'month'].includes(
            String(payload?.preferences?.defaultCalendarView)
          )
            ? (payload?.preferences?.defaultCalendarView as 'day' | 'week' | 'month')
            : 'week',
          showWeekends: payload?.preferences?.showWeekends !== false,
          showRemindersOnCalendar: payload?.preferences?.showRemindersOnCalendar !== false,
          showCompletedItems: ['muted', 'hidden', 'visible'].includes(
            String(payload?.preferences?.showCompletedItems)
          )
            ? (payload?.preferences?.showCompletedItems as 'muted' | 'hidden' | 'visible')
            : 'muted',
          reminderSnoozePreset: ['10m-1h-tomorrow', '5m-15m-1h', '15m-1h-tomorrow'].includes(
            String(payload?.preferences?.reminderSnoozePreset)
          )
            ? (payload?.preferences?.reminderSnoozePreset as
                | '10m-1h-tomorrow'
                | '5m-15m-1h'
                | '15m-1h-tomorrow')
            : '10m-1h-tomorrow',
          reminderDestination: ['today-calendar', 'today', 'calendar'].includes(
            String(payload?.preferences?.reminderDestination)
          )
            ? (payload?.preferences?.reminderDestination as 'today-calendar' | 'today' | 'calendar')
            : 'today-calendar',
          missedReminderBehavior: ['needs_attention', 'today', 'hide'].includes(
            String(payload?.preferences?.missedReminderBehavior)
          )
            ? (payload?.preferences?.missedReminderBehavior as 'needs_attention' | 'today' | 'hide')
            : 'needs_attention',
          completedReminderBehavior: ['collapse', 'keep_visible', 'hide_immediately'].includes(
            String(payload?.preferences?.completedReminderBehavior)
          )
            ? (payload?.preferences?.completedReminderBehavior as
                | 'collapse'
                | 'keep_visible'
                | 'hide_immediately')
            : 'collapse',
          pastEventBehavior: ['history', 'fade', 'upcoming_only'].includes(
            String(payload?.preferences?.pastEventBehavior)
          )
            ? (payload?.preferences?.pastEventBehavior as 'history' | 'fade' | 'upcoming_only')
            : 'history',
          followUpBehavior: ['none', 'offer', 'review_prompt'].includes(
            String(payload?.preferences?.followUpBehavior)
          )
            ? (payload?.preferences?.followUpBehavior as 'none' | 'offer' | 'review_prompt')
            : 'offer',
          followUpDefaultTime: ['tomorrow_9', 'today_5', 'next_morning', 'custom'].includes(
            String(payload?.preferences?.followUpDefaultTime)
          )
            ? (payload?.preferences?.followUpDefaultTime as
                | 'tomorrow_9'
                | 'today_5'
                | 'next_morning'
                | 'custom')
            : 'tomorrow_9',
          eventNotesBehavior:
            payload?.preferences?.eventNotesBehavior === 'disabled' ? 'disabled' : 'enabled',
          linkedProjectFollowUps: ['project_and_today', 'project_only', 'today_only'].includes(
            String(payload?.preferences?.linkedProjectFollowUps)
          )
            ? (payload?.preferences?.linkedProjectFollowUps as
                | 'project_and_today'
                | 'project_only'
                | 'today_only')
            : 'project_and_today',
          defaultWorkspaceCalendar: ['personal', 'workspace', 'projects'].includes(
            String(payload?.preferences?.defaultWorkspaceCalendar)
          )
            ? (payload?.preferences?.defaultWorkspaceCalendar as
                | 'personal'
                | 'workspace'
                | 'projects')
            : 'personal',
          calendarScope: ['current_workspace', 'all_accessible_workspaces'].includes(
            String(payload?.preferences?.calendarScope)
          )
            ? (payload?.preferences?.calendarScope as
                | 'current_workspace'
                | 'all_accessible_workspaces')
            : 'current_workspace',
          calendarColor: ['ledger-orange', 'blue', 'green', 'gray'].includes(
            String(payload?.preferences?.calendarColor)
          )
            ? (payload?.preferences?.calendarColor as 'ledger-orange' | 'blue' | 'green' | 'gray')
            : 'ledger-orange',
        };

        setCalendarPreferences(nextPreferences);
        setNewCalendarColor(preferenceColorMap[nextPreferences.calendarColor ?? 'ledger-orange']);

        const minutes = Number(nextPreferences.defaultEventMinutes ?? 30);
        setDefaultEventDurationMinutes([30, 45, 60].includes(minutes) ? minutes : 30);
        if (!initialFocusDate) {
          setViewMode(nextPreferences.defaultCalendarView ?? 'week');
        }
      } catch {
        if (!cancelled) {
          setDefaultEventDurationMinutes(30);
        }
      }
    };

    void loadPreferenceDefaults();

    return () => {
      cancelled = true;
    };
  }, [api, user?.id, initialFocusDate]);

  useEffect(() => {
    if (viewMode !== 'day' || !selectedTimelineInVisibleHours || selectedTimelineHour === null) {
      return;
    }

    const container = centerScrollRef.current;
    if (!container) return;

    const hourRow = container.querySelector(
      `[data-timeline-hour="${selectedTimelineHour}"]`
    ) as HTMLElement | null;
    if (!hourRow) return;

    container.scrollTo({
      top: Math.max(0, hourRow.offsetTop - 24),
      behavior: 'smooth',
    });
  }, [
    selectedTimelineHour,
    selectedTimelineInVisibleHours,
    viewMode,
    selectedEventPreview,
    selectedReminder,
  ]);

  const selectedEventNoteDraft = selectedEventPreview
    ? eventNotesDrafts[selectedEventPreview.id] ?? selectedEventPreview.notes ?? ''
    : '';
  const selectedEventFollowUps = useMemo(() => {
    if (!selectedEventPreview) return [];
    return followUpTasksByEvent[baseEventId(selectedEventPreview.id)] ?? [];
  }, [followUpTasksByEvent, selectedEventPreview]);
  const getCalendarColor = (calendarId: string) => calendarById.get(calendarId)?.color ?? '#93C5FD';
  const getDefaultCalendar = () =>
    calendars.find(
      (calendar) => calendar.is_visible !== false && (calendar.is_default || calendar.is_personal)
    ) ??
    calendars[0] ??
    null;
  const getPreferredCalendar = (source: 'event' | 'workspace' = 'event') => {
    const preference =
      source === 'workspace'
        ? calendarPreferences.defaultWorkspaceCalendar
        : calendarPreferences.defaultEventCalendar;

    const personalCalendar =
      calendars.find((calendar) => calendar.is_visible !== false && calendar.is_personal) ??
      getDefaultCalendar();
    const workspaceCalendar =
      calendars.find(
        (calendar) => calendar.is_visible !== false && !calendar.is_personal && calendar.is_default
      ) ?? calendars.find((calendar) => calendar.is_visible !== false && !calendar.is_personal);
    const projectCalendar =
      calendars.find(
        (calendar) =>
          calendar.is_visible !== false && /project/i.test(String(calendar.name ?? '').trim())
      ) ??
      workspaceCalendar ??
      personalCalendar;

    if (preference === 'work' || preference === 'workspace') {
      return workspaceCalendar ?? personalCalendar ?? getDefaultCalendar();
    }
    if (preference === 'projects') {
      return projectCalendar ?? personalCalendar ?? getDefaultCalendar();
    }
    return personalCalendar ?? workspaceCalendar ?? getDefaultCalendar();
  };

  const notifyCalendarItemsUpdated = () => {
    window.ipcRenderer?.send('calendar:items-updated');
  };

  const overflowEvents = useMemo(
    () => (overflowDayKey ? eventsByDay[overflowDayKey] ?? [] : []),
    [overflowDayKey, eventsByDay]
  );

  const overflowReminders = useMemo(
    () => (overflowDayKey ? remindersByDay[overflowDayKey] ?? [] : []),
    [overflowDayKey, remindersByDay]
  );
  const showWorkspaceNames = calendarPreferences.calendarScope === 'all_accessible_workspaces';

  useEffect(() => {
    let cancelled = false;

    const loadCalendarData = async () => {
      if (!user || !activeWorkspaceId) {
        if (!cancelled) {
          setCalendars([]);
          setEvents([]);
          setReminders([]);
          setHasLoadedData(false);
          setIsLoading(false);
        }
        return;
      }

      const isInitialLoad = !hasLoadedDataRef.current;
      if (isInitialLoad) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const loadedCalendars = await api.getCalendars({
          scope: calendarPreferences.calendarScope,
        });

        if (cancelled) return;

        let finalCalendars = (loadedCalendars ?? []) as CalendarRow[];

        if (finalCalendars.length === 0) {
          const createdCalendar = await api.createCalendar('Personal', '#3B82F6', true);
          if (cancelled) return;

          if (!createdCalendar) {
            setError('Could not create default calendar.');
            return;
          }

          finalCalendars = [createdCalendar as CalendarRow];
        }

        setCalendars(finalCalendars);
        setCalendarColorDrafts(
          Object.fromEntries(finalCalendars.map((calendar) => [calendar.id, calendar.color]))
        );

        const [eventRows, reminderRows] = await Promise.all([
          api.getEvents(viewConfig.start.toISOString(), viewConfig.end.toISOString(), {
            scope: calendarPreferences.calendarScope,
          }),
          api.getReminders({ scope: calendarPreferences.calendarScope }),
        ]);

        if (cancelled) return;

        setEvents((eventRows ?? []) as EventRow[]);
        setReminders(
          ((reminderRows ?? []) as ReminderRow[]).filter((reminder) => {
            const remindAt = new Date(reminder.remind_at).getTime();
            return remindAt >= viewConfig.start.getTime() && remindAt < viewConfig.end.getTime();
          })
        );

        const eventRowsById = new Set(((eventRows ?? []) as EventRow[]).map((event) => event.id));
        const reminderRowsById = new Set(
          ((reminderRows ?? []) as ReminderRow[]).map((item) => item.id)
        );
        setSelectedEvent((current) =>
          current && !eventRowsById.has(baseEventId(current.id)) ? null : current
        );
        setSelectedReminder((current) =>
          current && !reminderRowsById.has(current.id) ? null : current
        );

        const [projectResult, noteResult, taskResult] = await Promise.allSettled([
          api.getProjects({ includeCompleted: true }),
          api.getNotes(),
          api.getTasks(),
        ]);

        if (cancelled) return;

        setProjects(
          projectResult.status === 'fulfilled' && Array.isArray(projectResult.value)
            ? (projectResult.value as ProjectRow[])
            : []
        );
        setNotes(
          noteResult.status === 'fulfilled' &&
            noteResult.value &&
            Array.isArray((noteResult.value as { notes?: NoteRow[] }).notes)
            ? (noteResult.value as { notes: NoteRow[] }).notes ?? []
            : []
        );
        if (taskResult.status === 'fulfilled' && Array.isArray(taskResult.value)) {
          const followUpMap: Record<string, TaskRow[]> = {};
          for (const task of taskResult.value as TaskRow[]) {
            const marker = String(task.description ?? '');
            if (!marker.startsWith('calendar_followup:')) continue;
            const eventId = baseEventId(marker.slice('calendar_followup:'.length).trim());
            if (!eventId) continue;
            if (!followUpMap[eventId]) followUpMap[eventId] = [];
            followUpMap[eventId].push(task);
          }
          Object.keys(followUpMap).forEach((eventId) => {
            followUpMap[eventId].sort(
              (left, right) =>
                new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime()
            );
          });
          setFollowUpTasksByEvent(followUpMap);
        }
        hasLoadedDataRef.current = true;
        setHasLoadedData(true);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load calendar data:', error);
          setError('Could not load calendar data right now.');
          if (!hasLoadedDataRef.current) {
            setCalendars([]);
            setEvents([]);
            setReminders([]);
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadCalendarData();

    const handleCalendarItemsUpdated = () => {
      void loadCalendarData();
    };

    window.ipcRenderer?.on('calendar:items-updated', handleCalendarItemsUpdated);

    const refreshTimer = window.setInterval(() => {
      void loadCalendarData();
    }, 60_000);

    return () => {
      cancelled = true;
      window.ipcRenderer?.off('calendar:items-updated', handleCalendarItemsUpdated);
      window.clearInterval(refreshTimer);
    };
  }, [
    user?.id,
    activeWorkspaceId,
    viewConfig.start.getTime(),
    viewConfig.end.getTime(),
    api,
    calendarPreferences.calendarScope,
    calendarRefreshToken,
  ]);

  useEffect(() => {
    if (!appleSyncMessage) return;
    setIsAppleSyncMessageVisible(true);

    const hideTimer = window.setTimeout(() => {
      setIsAppleSyncMessageVisible(false);
    }, NOTIFICATION_VISIBLE_MS);

    const clearTimer = window.setTimeout(() => {
      setAppleSyncMessage(null);
    }, NOTIFICATION_VISIBLE_MS + NOTIFICATION_FADE_MS);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [appleSyncMessage]);

  useEffect(() => {
    if (!importMessage) return;
    setIsImportMessageVisible(true);

    const hideTimer = window.setTimeout(() => {
      setIsImportMessageVisible(false);
    }, NOTIFICATION_VISIBLE_MS);

    const clearTimer = window.setTimeout(() => {
      setImportMessage(null);
    }, NOTIFICATION_VISIBLE_MS + NOTIFICATION_FADE_MS);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [importMessage]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!calendarRowContextMenu && !calendarColorMenu) return;

    const closeMenu = () => {
      setCalendarRowContextMenu(null);
      setCalendarColorMenu(null);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [calendarColorMenu, calendarRowContextMenu]);

  useEffect(() => {
    if (!listContextMenu) return;

    const closeMenu = () => setListContextMenu(null);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', onEscape);
    };
  }, [listContextMenu]);

  useEffect(() => {
    const hasOpenModal =
      isComposerOpen ||
      Boolean(eventEditorEvent) ||
      Boolean(selectedReminder) ||
      Boolean(overflowDayKey);
    if (!hasOpenModal) return;

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (overflowDayKey) {
        setOverflowDayKey(null);
        return;
      }
      if (selectedReminder) {
        setSelectedReminder(null);
        return;
      }
      if (eventEditorEvent) {
        setEventEditorEvent(null);
        setConfirmDelete(false);
        return;
      }
      if (isComposerOpen) {
        setIsComposerOpen(false);
      }
    };

    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [eventEditorEvent, isComposerOpen, overflowDayKey, selectedReminder]);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMove = (event: MouseEvent) => {
      const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, event.clientX));
      setLeftPaneWidth(next);
    };

    const handleUp = () => {
      setIsResizingSidebar(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (!isResizingRightPane) return;

    const handleMove = (event: MouseEvent) => {
      const next = window.innerWidth - event.clientX;
      const clamped = Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, next));
      setRightPaneWidth(clamped);
    };

    const handleUp = () => {
      setIsResizingRightPane(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingRightPane]);

  useEffect(() => {
    const handleFollowUpCreated = (
      _event: unknown,
      payload?: { eventId?: string; task?: TaskRow }
    ) => {
      const eventId = payload?.eventId ? baseEventId(payload.eventId) : null;
      const task = payload?.task;
      if (!eventId || !task?.id) return;

      setFollowUpTasksByEvent((current) => {
        const existing = current[eventId] ?? [];
        if (existing.some((entry) => entry.id === task.id)) return current;
        return {
          ...current,
          [eventId]: [task, ...existing].slice(0, 12),
        };
      });
    };

    window.ipcRenderer?.on('calendar:follow-up-created', handleFollowUpCreated);
    return () => {
      window.ipcRenderer?.off('calendar:follow-up-created', handleFollowUpCreated);
    };
  }, []);

  const openComposerAtSlot = (
    dateKey: string,
    hour: number,
    title = '',
    mode: 'event' | 'reminder' = 'event'
  ) => {
    setGridQuickAdd(null);
    setGridQuickTitle('');
    setNewEventDate(dateKey);
    setNewEventTime(
      mode === 'reminder'
        ? calendarPreferences.defaultReminderTime ?? '09:00'
        : `${String(hour).padStart(2, '0')}:00`
    );
    const defaultDuration = getDurationDisplay(defaultEventDurationMinutes);
    setNewEventDurationValue(defaultDuration.value);
    setNewEventDurationUnit(defaultDuration.unit);
    setNewEventTitle(title);
    setNewEventRecurrence('none');
    setNewEventSpecificDates([]);
    setComposerCalendarId(
      mode === 'reminder' &&
        (calendarPreferences.reminderDestination ?? 'today-calendar') === 'today'
        ? getPreferredCalendar('workspace')?.id ?? ''
        : getPreferredCalendar('event')?.id ?? ''
    );
    setComposerProjectId('');
    setComposerNoteId('');
    setComposerNotes('');
    setNewEventVisibility(calendarPreferences.defaultEventVisibility ?? 'private');
    setComposerMode(mode);
    setIsSpecificDatesModalOpen(false);
    setSpecificDatesDraft([]);
    setSpecificDatesCleared(false);
    setIsComposerOpen(true);
  };

  const openSpecificDatesPicker = () => {
    specificDatesPreviousRepeatRef.current = newEventRecurrence;
    const fallbackDateKey = newEventDate || formatDateKey(new Date());
    const initialDraft =
      newEventSpecificDates.length > 0 ? newEventSpecificDates : [fallbackDateKey];
    const anchorDate = parseDateKey(uniqueSortedDateKeys(initialDraft)[0] ?? fallbackDateKey);

    setSpecificDatesDraft(uniqueSortedDateKeys(initialDraft));
    setSpecificDatesMonthAnchor(startOfMonth(anchorDate));
    setSpecificDatesCleared(false);
    setNewEventRecurrence('specific_dates');
    setIsSpecificDatesModalOpen(true);
  };

  const closeSpecificDatesPicker = (restorePreviousRepeat = true) => {
    if (restorePreviousRepeat) {
      setNewEventRecurrence(specificDatesPreviousRepeatRef.current);
    }
    setIsSpecificDatesModalOpen(false);
    setSpecificDatesDraft([]);
    setSpecificDatesCleared(false);
  };

  const saveSpecificDatesPicker = () => {
    if (specificDatesDraft.length === 0 && !specificDatesCleared) return;

    if (specificDatesDraft.length === 0) {
      setNewEventSpecificDates([]);
      setNewEventRecurrence('none');
    } else {
      setNewEventSpecificDates(uniqueSortedDateKeys(specificDatesDraft));
      setNewEventRecurrence('specific_dates');
    }
    setIsSpecificDatesModalOpen(false);
    setSpecificDatesCleared(false);
  };

  const toggleSpecificDate = (dateKey: string) => {
    setSpecificDatesCleared(false);
    setSpecificDatesDraft((current) => {
      const set = new Set(current);
      if (set.has(dateKey)) {
        set.delete(dateKey);
      } else {
        set.add(dateKey);
      }
      return Array.from(set).sort();
    });
  };

  const clearSpecificDatesDraft = () => {
    setSpecificDatesDraft([]);
    setSpecificDatesCleared(true);
  };

  const getListContextMenuSlot = () => {
    if (!listContextMenu) return null;

    if (listContextMenu.kind === 'event') {
      const event = events.find((item) => item.id === baseEventId(listContextMenu.id));
      if (!event) return null;
      const start = new Date(event.start_at);
      if (Number.isNaN(start.getTime())) return null;
      return {
        dateKey: formatDateKey(start),
        hour: start.getHours(),
        title: event.title,
        kind: 'event' as const,
        timeLabel: formatEventTimeLabel(event),
        isPast: isPastEvent(event),
      };
    }

    const reminder = reminders.find((item) => item.id === listContextMenu.id);
    if (!reminder) return null;
    const remindAt = new Date(reminder.remind_at);
    if (Number.isNaN(remindAt.getTime())) return null;
    return {
      dateKey: formatDateKey(remindAt),
      hour: remindAt.getHours(),
      title: reminder.title,
      kind: 'reminder' as const,
      timeLabel: formatCalendarTime(remindAt),
      isPast: isPastReminder(reminder),
    };
  };

  const openNewItemFromListContextMenu = (mode: 'event' | 'reminder') => {
    const slot = getListContextMenuSlot();
    if (!slot) return;
    openComposerAtSlot(slot.dateKey, slot.hour, mode === 'reminder' ? 'Reminder' : '', mode);
    setListContextMenu(null);
  };

  const moveView = (direction: -1 | 1) => {
    setSelectedEvent(null);
    setSelectedReminder(null);
    setViewAnchor((prev) => {
      if (viewMode === 'day') return addDays(prev, direction);
      if (viewMode === 'month') return addMonths(prev, direction);
      return addDays(prev, direction * 7);
    });
  };

  const jumpToToday = () => {
    setSelectedEvent(null);
    setSelectedReminder(null);
    setViewAnchor(new Date());
  };

  useWorkspaceRouteHistory(
    {
      kind: 'calendar',
      focusDate: formatDateKey(viewAnchor),
      focusSection: viewMode,
    },
    true
  );

  const createQuickEvent = async () => {
    if (!user || !newEventTitle.trim() || calendars.length === 0) return;
    if (newEventRecurrence === 'specific_dates' && newEventSpecificDates.length === 0) {
      setError('Choose at least one date.');
      return;
    }

    const selectedCalendar =
      calendars.find((calendar) => calendar.id === composerCalendarId) ?? getDefaultCalendar();
    if (!selectedCalendar) return;
    const start = new Date(`${newEventDate}T${newEventTime}:00`);
    const durationMinutes = getDurationMinutes(newEventDurationValue, newEventDurationUnit);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    if (end <= start) {
      end.setHours(start.getHours() + 1);
    }

    setIsSavingEvent(true);
    setError(null);

    if (composerMode === 'reminder') {
      const reminderCalendarPreference =
        calendarPreferences.reminderDestination ?? 'today-calendar';
      const selectedReminderCalendar =
        reminderCalendarPreference === 'today'
          ? getPreferredCalendar('workspace') ?? selectedCalendar
          : selectedCalendar;
      const reminderPayload = {
        title: newEventTitle.trim(),
        remind_at: start.toISOString(),
        calendar_id: selectedReminderCalendar.id,
        color: selectedReminderCalendar.color,
        is_done: false,
        project_id: composerProjectId || null,
        note_id: composerNoteId || null,
        notes: composerNotes.trim() || null,
        recurrence_rule:
          newEventRecurrence === 'specific_dates' ? 'specific_dates' : newEventRecurrence,
        specific_dates: newEventRecurrence === 'specific_dates' ? newEventSpecificDates : undefined,
        series_type: newEventRecurrence === 'specific_dates' ? 'specific_dates' : undefined,
      };
      const createdReminderResponse = await api.createReminder(reminderPayload);
      const createdReminders = Array.isArray(
        (createdReminderResponse as { created?: ReminderRow[] })?.created
      )
        ? (createdReminderResponse as { created: ReminderRow[] }).created ?? []
        : createdReminderResponse
        ? [createdReminderResponse as ReminderRow]
        : [];

      setIsSavingEvent(false);

      if (createdReminders.length === 0) {
        setError('Could not create reminder.');
        return;
      }

      setReminders((prev) =>
        [...prev, ...createdReminders].sort(
          (a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime()
        )
      );
      setSelectedEvent(null);
      setNewEventTitle('');
      setIsComposerOpen(false);
      setComposerMode('event');
      setNewEventRecurrence('none');
      setNewEventSpecificDates([]);
      setComposerCalendarId(getPreferredCalendar('event')?.id ?? '');
      setComposerProjectId('');
      setComposerNoteId('');
      setComposerNotes('');
      setNewEventVisibility(calendarPreferences.defaultEventVisibility ?? 'private');
      const defaultDuration = getDurationDisplay(defaultEventDurationMinutes);
      setNewEventDurationValue(defaultDuration.value);
      setNewEventDurationUnit(defaultDuration.unit);
      notifyCalendarItemsUpdated();
      window.dispatchEvent(new CustomEvent('ledger:notifications-refresh'));
      return;
    }

    const createdEvent = (await api.createEvent({
      title: newEventTitle.trim(),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      calendar_id: selectedCalendar.id,
      color: selectedCalendar.color,
      recurrence_rule:
        newEventRecurrence === 'specific_dates' ? 'specific_dates' : newEventRecurrence,
      status: calendarPreferences.defaultEventStatus ?? 'planned',
      visibility: newEventVisibility ?? calendarPreferences.defaultEventVisibility ?? 'private',
      project_id: composerProjectId || null,
      note_id: composerNoteId || null,
      notes: composerNotes.trim() || null,
      specific_dates: newEventRecurrence === 'specific_dates' ? newEventSpecificDates : undefined,
      series_type: newEventRecurrence === 'specific_dates' ? 'specific_dates' : undefined,
    })) as EventRow | { created?: EventRow[] };

    setIsSavingEvent(false);

    const createdEvents = Array.isArray((createdEvent as { created?: EventRow[] })?.created)
      ? (createdEvent as { created: EventRow[] }).created ?? []
      : createdEvent
      ? [createdEvent as EventRow]
      : [];

    if (createdEvents.length === 0) {
      setError('Could not create event.');
      return;
    }

    setEvents((prev) =>
      [...prev, ...createdEvents].sort(
        (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      )
    );
    setSelectedEvent(createdEvents[0] ?? null);
    setSelectedReminder(null);
    setNewEventTitle('');
    setIsComposerOpen(false);
    setComposerMode('event');
    setNewEventRecurrence('none');
    setNewEventSpecificDates([]);
    setComposerCalendarId(getPreferredCalendar('event')?.id ?? '');
    setComposerProjectId('');
    setComposerNoteId('');
    setComposerNotes('');
    setNewEventVisibility(calendarPreferences.defaultEventVisibility ?? 'private');
    const defaultDuration = getDurationDisplay(defaultEventDurationMinutes);
    setNewEventDurationValue(defaultDuration.value);
    setNewEventDurationUnit(defaultDuration.unit);
    notifyCalendarItemsUpdated();
    window.dispatchEvent(new CustomEvent('ledger:notifications-refresh'));
  };

  const createNewCalendar = async () => {
    const name = newCalendarName.trim() || 'Personal';
    setIsCreatingCalendar(true);
    setError(null);

    try {
      const created = (await api.createCalendar(name, newCalendarColor, true)) as CalendarRow;
      if (!created) {
        setError('Could not create calendar.');
        return;
      }

      setCalendars((prev) =>
        [...prev, created].sort(
          (a, b) => Number(b.is_personal) - Number(a.is_personal) || a.name.localeCompare(b.name)
        )
      );
      setCalendarColorDrafts((prev) => ({ ...prev, [created.id]: created.color }));
      setComposerCalendarId(created.id);
      setIsNewCalendarModalOpen(false);
      setNewCalendarName('');
      setNewCalendarColor(preferenceColorMap[calendarPreferences.calendarColor ?? 'ledger-orange']);
    } catch (error) {
      setError('Could not create calendar.');
    } finally {
      setIsCreatingCalendar(false);
    }
  };

  const toggleReminderDone = async (reminder: ReminderRow) => {
    try {
      const targetId = baseReminderId(reminder.id);
      const updated = (await api.updateReminder(targetId, {
        is_done: !reminder.is_done,
      })) as ReminderRow;

      if (!updated) {
        setError('Could not update reminder.');
        return;
      }

      setReminders((prev) =>
        prev.map((item) =>
          baseReminderId(item.id) === baseReminderId(updated.id) ? updated : item
        )
      );
    } catch (error) {
      setError('Could not update reminder.');
      return;
    }
  };

  const quickDeleteReminder = async (reminderId: string) => {
    try {
      const targetId = baseReminderId(reminderId);
      await api.deleteReminder(targetId);
      setReminders((prev) =>
        prev.filter((item) => baseReminderId(item.id) !== baseReminderId(reminderId))
      );
    } catch (error) {
      setError('Could not delete reminder.');
      return;
    }
  };

  const openReminderEditor = (reminder: ReminderRow) => {
    const start = new Date(reminder.remind_at);
    const source = reminders.find((row) => row.id === baseReminderId(reminder.id)) ?? reminder;
    setSelectedReminder(reminder);
    setReminderEditTitle(source.title);
    setReminderEditDate(formatDateKey(start));
    setReminderEditTime(
      `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
    );
    setReminderEditCalendarId(source.calendar_id);
    setReminderEditColor(source.color ?? '#F59E0B');
    setReminderEditDone(source.is_done);
  };

  const snoozeReminderByMinutes = async (reminder: ReminderRow, minutes: number) => {
    const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    try {
      const targetId = baseReminderId(reminder.id);
      const updated = (await api.snoozeReminder(targetId, snoozeUntil)) as ReminderRow;
      setReminders((prev) =>
        prev
          .map((item) => (item.id === updated.id ? updated : item))
          .sort((a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime())
      );
      setSelectedReminder((current) =>
        current && baseReminderId(current.id) === baseReminderId(updated.id) ? updated : current
      );
    } catch (error) {
      setError('Could not snooze reminder.');
    }
  };

  const saveReminderEdits = async () => {
    if (!selectedReminder || !reminderEditTitle.trim()) return;
    setIsSavingEdit(true);
    setError(null);

    const originalReminderDate = new Date(selectedReminder.remind_at);
    const remindAt = new Date(`${reminderEditDate}T${reminderEditTime}:00`);
    const resolvedReminderCalendarId =
      reminderEditCalendarId || selectedReminder.calendar_id || getDefaultCalendar()?.id || '';
    const resolvedReminderColor =
      calendarById.get(resolvedReminderCalendarId)?.color ?? reminderEditColor;

    const updated = (await api.updateReminder(baseReminderId(selectedReminder.id), {
      title: reminderEditTitle.trim(),
      remind_at: remindAt.toISOString(),
      calendar_id: resolvedReminderCalendarId,
      color: resolvedReminderColor,
      is_done: reminderEditDone,
    })) as ReminderRow;

    setIsSavingEdit(false);

    if (!updated) {
      setError('Could not update reminder.');
      return;
    }

    setReminders((prev) =>
      prev
        .map((item) => (baseReminderId(item.id) === baseReminderId(updated.id) ? updated : item))
        .sort((a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime())
    );

    const updatedReminderDate = new Date(updated.remind_at);
    updatedReminderDate.setHours(0, 0, 0, 0);
    const updatedReminderDateKey = formatDateKey(updatedReminderDate);
    const originalReminderDateKey = formatDateKey(originalReminderDate);
    if (updatedReminderDateKey !== originalReminderDateKey) {
      setViewMode('day');
      setViewAnchor(updatedReminderDate);
    }

    setSelectedReminder(updated);
    notifyCalendarItemsUpdated();
    window.dispatchEvent(new CustomEvent('ledger:notifications-refresh'));
  };

  const deleteReminderFromEditor = async () => {
    if (!selectedReminder) return;
    setIsDeletingReminder(true);
    setError(null);

    try {
      await api.deleteReminder(baseReminderId(selectedReminder.id));
      setReminders((prev) =>
        prev.filter((item) => baseReminderId(item.id) !== baseReminderId(selectedReminder.id))
      );
      setSelectedReminder(null);
      notifyCalendarItemsUpdated();
    } catch (error) {
      setError('Could not delete reminder.');
    } finally {
      setIsDeletingReminder(false);
    }
  };

  const openEventEditor = (event: EventRow) => {
    const source = events.find((row) => row.id === baseEventId(event.id)) ?? event;
    const start = new Date(event.start_at);
    const durationMinutes = Math.max(
      1,
      Math.round((new Date(source.end_at).getTime() - new Date(source.start_at).getTime()) / 60000)
    );
    const durationDisplay = getDurationDisplay(durationMinutes);
    setSelectedEvent(event);
    setEventEditorEvent(source);
    setEditTitle(source.title);
    setEditDate(formatDateKey(start));
    setEditTime(
      `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
    );
    setEditDurationValue(durationDisplay.value);
    setEditDurationUnit(durationDisplay.unit);
    setEditStatus(source.status ?? 'planned');
    setEditCalendarId(source.calendar_id);
    setEditColor(calendarById.get(source.calendar_id)?.color ?? source.color ?? '#93C5FD');
    setEditProjectId(source.project_id ?? '');
    setEditNoteId(source.note_id ?? '');
    setEditVisibility(source.visibility ?? calendarPreferences.defaultEventVisibility ?? 'private');
    setEditRecurrence(
      source.recurrence_rule === 'specific_dates' ? 'none' : source.recurrence_rule ?? 'none'
    );
    setEventNotesDrafts((prev) => ({
      ...prev,
      [source.id]: source.notes ?? prev[source.id] ?? '',
    }));
    setConfirmDelete(false);
  };

  const openLinkProjectModal = async () => {
    if (!selectedEventPreview && !selectedReminder) return;
    setIsLinkProjectModalOpen(true);
    setLinkProjectsSearch('');
    setIsLoadingLinkProjects(true);
    try {
      const projects = (await api.getProjects({ includeCompleted: true })) as Array<{
        id: string;
        name: string;
        color?: string;
      }>;
      setLinkProjects(projects);
    } catch (err) {
      console.error('Failed to load projects for linking', err);
      setLinkProjects([]);
    } finally {
      setIsLoadingLinkProjects(false);
    }
  };

  const openLinkNoteModal = async () => {
    if (!selectedEventPreview && !selectedReminder) return;
    setIsLinkNoteModalOpen(true);
    setLinkNotesSearch('');
    setIsLoadingLinkNotes(true);
    try {
      setLinkNotes(notes);
    } catch (err) {
      console.error('Failed to load notes for linking', err);
      setLinkNotes([]);
    } finally {
      setIsLoadingLinkNotes(false);
    }
  };

  const linkEventToProject = async (projectId: string) => {
    if (!selectedEventPreview && !selectedReminder) return;
    setIsLinkingProject(true);
    try {
      if (selectedEventPreview) {
        const targetId = baseEventId(selectedEventPreview.id);
        const updated = (await api.updateEvent(targetId, { project_id: projectId })) as EventRow;
        setEvents((prev) =>
          prev.map((evt) =>
            baseEventId(evt.id) === baseEventId(updated.id) ? { ...evt, ...updated } : evt
          )
        );
        setSelectedEvent((current) =>
          current && baseEventId(current.id) === updated.id ? { ...current, ...updated } : current
        );
      } else if (selectedReminder) {
        const updated = (await api.updateReminder(baseReminderId(selectedReminder.id), {
          project_id: projectId,
        })) as ReminderRow;
        setReminders((prev) =>
          prev.map((item) =>
            baseReminderId(item.id) === baseReminderId(updated.id) ? updated : item
          )
        );
        setSelectedReminder((current) =>
          current && baseReminderId(current.id) === baseReminderId(updated.id) ? updated : current
        );
      }
      setIsLinkProjectModalOpen(false);
    } catch (err) {
      console.error('Failed to link item to project', err);
    } finally {
      setIsLinkingProject(false);
    }
  };

  const linkEventToNote = async (noteId: string) => {
    if (!selectedEventPreview && !selectedReminder) return;
    setIsLinkingNote(true);
    try {
      if (selectedEventPreview) {
        const targetId = baseEventId(selectedEventPreview.id);
        const updated = (await api.updateEvent(targetId, { note_id: noteId })) as EventRow;
        setEvents((prev) =>
          prev.map((evt) =>
            baseEventId(evt.id) === baseEventId(updated.id) ? { ...evt, ...updated } : evt
          )
        );
        setSelectedEvent((current) =>
          current && baseEventId(current.id) === updated.id ? { ...current, ...updated } : current
        );
      } else if (selectedReminder) {
        const updated = (await api.updateReminder(baseReminderId(selectedReminder.id), {
          note_id: noteId,
        })) as ReminderRow;
        setReminders((prev) =>
          prev.map((item) =>
            baseReminderId(item.id) === baseReminderId(updated.id) ? updated : item
          )
        );
        setSelectedReminder((current) =>
          current && baseReminderId(current.id) === baseReminderId(updated.id) ? updated : current
        );
      }
      setIsLinkNoteModalOpen(false);
    } catch (err) {
      console.error('Failed to link item to note', err);
    } finally {
      setIsLinkingNote(false);
    }
  };

  const saveSelectedEventNotes = async () => {
    if (!selectedEventPreview) return;

    const targetId = baseEventId(selectedEventPreview.id);
    const nextNotes = selectedEventNoteDraft.trim();

    try {
      const updated = (await api.updateEvent(targetId, { notes: nextNotes || null })) as EventRow;
      setEvents((prev) =>
        prev.map((evt) =>
          baseEventId(evt.id) === baseEventId(updated.id) ? { ...evt, ...updated } : evt
        )
      );
      setEventNotesDrafts((prev) => ({ ...prev, [targetId]: updated.notes ?? '' }));
      setSelectedEvent((current) =>
        current && baseEventId(current.id) === updated.id ? { ...current, ...updated } : current
      );
    } catch (error) {
      setError('Could not save event notes.');
    }
  };

  const saveEventEdits = async () => {
    if (!eventEditorEvent || !editTitle.trim()) return;

    const start = new Date(`${editDate}T${editTime}:00`);
    const durationMinutes = getDurationMinutes(editDurationValue, editDurationUnit);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    setIsSavingEdit(true);
    setError(null);

    const resolvedEventCalendarId = editCalendarId || eventEditorEvent.calendar_id;
    const resolvedEventColor = calendarById.get(resolvedEventCalendarId)?.color ?? editColor;

    const updated = (await api.updateEvent(eventEditorEvent.id, {
      title: editTitle.trim(),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      calendar_id: resolvedEventCalendarId,
      color: resolvedEventColor,
      status: editStatus,
      visibility: editVisibility,
      recurrence_rule: editRecurrence,
      project_id: editProjectId || null,
      note_id: editNoteId || null,
      notes: eventNotesDrafts[eventEditorEvent.id] ?? eventEditorEvent.notes ?? null,
    })) as EventRow;

    setIsSavingEdit(false);

    if (!updated) {
      setError('Could not update event.');
      return;
    }

    setEvents((prev) =>
      prev
        .map((evt) => (evt.id === updated.id ? updated : evt))
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    );
    setSelectedEvent((current) => (current?.id === updated.id ? updated : current));
    setSelectedReminder(null);
    const updatedDate = new Date(updated.start_at);
    updatedDate.setHours(0, 0, 0, 0);
    const updatedDateKey = formatDateKey(updatedDate);
    const currentAnchorKey = formatDateKey(viewAnchor);
    if (updatedDateKey !== currentAnchorKey) {
      setViewMode('day');
      setViewAnchor(updatedDate);
    }
    setEventEditorEvent(null);
    notifyCalendarItemsUpdated();
  };

  const deleteEvent = async () => {
    if (!eventEditorEvent) return;

    setIsDeletingEvent(true);
    setError(null);

    try {
      await api.deleteEvent(eventEditorEvent.id);
      setEvents((prev) => prev.filter((evt) => evt.id !== eventEditorEvent.id));
      setSelectedEvent((current) => (current?.id === eventEditorEvent.id ? null : current));
      setEventEditorEvent(null);
      setConfirmDelete(false);
      notifyCalendarItemsUpdated();
    } catch (error) {
      setError('Could not delete event.');
    } finally {
      setIsDeletingEvent(false);
    }
  };

  const quickDeleteEvent = async (eventId: string) => {
    const targetId = baseEventId(eventId);
    try {
      await api.deleteEvent(targetId);
      setEvents((prev) => prev.filter((evt) => evt.id !== targetId));
      setSelectedEvent((current) =>
        current && baseEventId(current.id) === targetId ? null : current
      );
    } catch (error) {
      setError('Could not delete event.');
    }
  };

  const saveCalendarColor = async (calendar: CalendarRow, color: string) => {
    if (calendar.color === color) return;

    setIsSavingColorId(calendar.id);
    setError(null);

    try {
      const updated = (await api.updateCalendar(calendar.id, { color })) as CalendarRow;
      if (!updated) {
        setError('Could not update calendar color.');
        return;
      }

      setCalendars((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (error) {
      setError('Could not update calendar color.');
    } finally {
      setIsSavingColorId(null);
    }
  };

  const deleteCalendar = async (calendar: CalendarRow) => {
    setError(null);

    try {
      const deleted = await api.deleteCalendar(calendar.id);
      if (!deleted) {
        setError('Could not delete calendar.');
        return;
      }

      setCalendars((prev) => prev.filter((item) => item.id !== calendar.id));
      setSelectedEvent((current) =>
        current && current.calendar_id === calendar.id ? null : current
      );
      setSelectedReminder((current) =>
        current && current.calendar_id === calendar.id ? null : current
      );

      if (composerCalendarId === calendar.id) {
        setComposerCalendarId('');
      }
      if (editCalendarId === calendar.id) {
        setEditCalendarId('');
      }
      if (reminderEditCalendarId === calendar.id) {
        setReminderEditCalendarId('');
      }
    } catch (error) {
      setError('Could not delete calendar.');
    }
  };

  const toggleCalendarVisibility = async (calendar: CalendarRow) => {
    setError(null);

    try {
      const updated = (await api.updateCalendar(calendar.id, {
        is_visible: !(calendar.is_visible !== false),
      })) as CalendarRow;
      if (!updated) {
        setError('Could not update calendar visibility.');
        return;
      }

      setCalendars((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      setError('Could not update calendar visibility.');
    }
  };

  const renameCalendar = async (calendarId: string, newName: string) => {
    if (!newName.trim()) {
      setEditingCalendarId(null);
      return;
    }

    setError(null);

    try {
      const updated = (await api.updateCalendar(calendarId, {
        name: newName.trim(),
      })) as CalendarRow;
      if (!updated) {
        setError('Could not rename calendar.');
        return;
      }

      setCalendars((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setEditingCalendarId(null);
    } catch (error) {
      setError('Could not rename calendar.');
      setEditingCalendarId(null);
    }
  };

  const createGridEvent = async () => {
    if (!user || !gridQuickAdd || !gridQuickTitle.trim() || calendars.length === 0) return;

    const selectedCalendar = getPreferredCalendar('workspace');
    if (!selectedCalendar) return;
    const hourString = String(gridQuickAdd.hour).padStart(2, '0');
    const start = new Date(`${gridQuickAdd.dateKey}T${hourString}:00:00`);
    const end = new Date(start);
    end.setHours(start.getHours() + 1);

    setIsSavingEvent(true);
    setError(null);

    const result = (await api.createEvent({
      title: gridQuickTitle.trim(),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      calendar_id: selectedCalendar.id,
      color: selectedCalendar.color,
      recurrence_rule: 'none',
      status: calendarPreferences.defaultEventStatus ?? 'planned',
      visibility: calendarPreferences.defaultEventVisibility ?? 'private',
    })) as EventRow;

    setIsSavingEvent(false);

    if (!result) {
      setError('Could not create event.');
      return;
    }

    setEvents((prev) =>
      [...prev, result].sort(
        (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      )
    );
    setSelectedEvent(result);
    setSelectedReminder(null);
    setGridQuickAdd(null);
    setGridQuickTitle('');
  };

  const syncAppleCalendar = async () => {
    if (!user) return;
    if (!ICAL_SERVICE_URL) {
      setError('Missing VITE_ICAL_SERVICE_URL in frontend environment.');
      return;
    }

    setIsSyncingApple(true);
    setError(null);
    setAppleSyncMessage(null);

    try {
      const response = await fetch(`${ICAL_SERVICE_URL}/sync-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      const json = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !json.token) {
        throw new Error(json.error || 'Failed to generate sync token');
      }

      const url = `${ICAL_SERVICE_URL}/ical/${json.token}.ics`;
      const webcalUrl = url.replace(/^https?:\/\//i, 'webcal://');

      try {
        await window.desktopWindow?.openExternal(webcalUrl);
        setAppleSyncMessage('Opened Apple Calendar subscription. Confirm once to finish sync.');
      } catch {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          setAppleSyncMessage('Could not auto-open Calendar. iCal link copied instead.');
        } else {
          setAppleSyncMessage(`Could not auto-open Calendar. Copy this URL: ${url}`);
        }
      }
    } catch (syncErr) {
      const message = syncErr instanceof Error ? syncErr.message : 'Sync setup failed';
      setError(`Could not generate Apple iCal link. ${message}`);
    } finally {
      setIsSyncingApple(false);
    }
  };

  const importIcsFile = async (file: File) => {
    if (!user || calendars.length === 0) return;

    setIsImportingIcs(true);
    setError(null);
    setImportMessage(null);

    try {
      const raw = await file.text();
      const parsed = parseIcsEvents(raw);
      console.log('[CalendarWindow] ICS import:', {
        baseEventCount: (raw.match(/BEGIN:VEVENT/gi) ?? []).length,
        expandedEventCount: parsed.length,
      });
      if (parsed.length === 0) {
        const unfolded = unfoldIcsLines(raw);
        const veventCount = (unfolded.match(/BEGIN:VEVENT/gi) ?? []).length;
        const vtodoCount = (unfolded.match(/BEGIN:VTODO/gi) ?? []).length;
        const vjournalCount = (unfolded.match(/BEGIN:VJOURNAL/gi) ?? []).length;
        setImportMessage(
          `No importable events found. Detected VEVENT:${veventCount}, VTODO:${vtodoCount}, VJOURNAL:${vjournalCount}.`
        );
        setIsImportingIcs(false);
        return;
      }

      const selectedCalendar = getPreferredCalendar('workspace');
      if (!selectedCalendar) return;
      const payload = parsed.map((evt) => ({
        calendar_id: selectedCalendar.id,
        workspace_id: selectedCalendar.workspace_id,
        created_by: user.id,
        title: evt.title,
        notes: evt.notes ?? null,
        location: evt.location ?? null,
        start_at: evt.startAt,
        end_at: evt.endAt,
        color: selectedCalendar.color,
        status: 'planned',
      }));

      // Deduplicate: check if events already exist in the calendar
      const existingEventKeys = new Set<string>();
      for (const evt of events) {
        const key = `${evt.title}|${evt.start_at}|${evt.end_at}`;
        existingEventKeys.add(key);
      }

      const payloadToImport = payload.filter((item) => {
        const key = `${item.title}|${item.start_at}|${item.end_at}`;
        return !existingEventKeys.has(key);
      });

      if (payloadToImport.length < payload.length) {
        console.log(
          `[ICS Import] Deduplicated ${payload.length - payloadToImport.length} duplicate events`
        );
      }

      const importedEvents = [] as EventRow[];
      const failedEvents = [] as Array<{ title: string; startAt: string; error: string }>;

      for (let i = 0; i < payloadToImport.length; i++) {
        const item = payloadToImport[i];
        try {
          // Validate before submitting
          if (!item.title?.trim()) {
            failedEvents.push({
              title: 'Untitled',
              startAt: item.start_at,
              error: 'Missing title',
            });
            continue;
          }
          if (!item.start_at || !item.end_at) {
            failedEvents.push({
              title: item.title,
              startAt: item.start_at,
              error: 'Missing date/time',
            });
            continue;
          }

          console.log(`[ICS Import] Creating event ${i + 1}/${payload.length}:`, {
            title: item.title,
            start_at: item.start_at,
          });

          const created = (await api.createEvent({
            title: item.title,
            start_at: item.start_at,
            end_at: item.end_at,
            calendar_id: item.calendar_id,
            color: item.color,
            status: item.status || (calendarPreferences.defaultEventStatus ?? 'planned'),
            recurrence_rule: 'none',
            notes: item.notes ?? null,
            location: item.location ?? null,
          })) as EventRow | null;

          if (created) {
            importedEvents.push(created);
            console.log(`[ICS Import] ✓ Created event ${i + 1}/${payloadToImport.length}`);
          } else {
            failedEvents.push({
              title: item.title,
              startAt: item.start_at,
              error: 'API returned null',
            });
            console.warn(
              `[ICS Import] ✗ Failed to create event ${i + 1}/${
                payloadToImport.length
              }: API returned null`
            );
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          failedEvents.push({ title: item.title, startAt: item.start_at, error: errorMsg });
          console.error(
            `[ICS Import] ✗ Failed to create event ${i + 1}/${payloadToImport.length}:`,
            err
          );
        }
      }

      setEvents((prev) =>
        [...prev, ...importedEvents].sort(
          (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
        )
      );

      let message = `Imported ${importedEvents.length} of ${payloadToImport.length} events`;
      if (failedEvents.length > 0) {
        message += ` (${failedEvents.length} failed)`;
        const failureDetails = failedEvents
          .slice(0, 3)
          .map((f) => `${f.title} (${f.error})`)
          .join('; ');
        message += `. Failed: ${failureDetails}${failedEvents.length > 3 ? '...' : ''}`;
        console.warn('[ICS Import] Failed events:', failedEvents);
      }
      setImportMessage(message);
    } catch (importErr) {
      const message = importErr instanceof Error ? importErr.message : 'Import failed';
      setError(`Could not import .ics. ${message}`);
      console.error('[ICS Import] Fatal error:', importErr);
    } finally {
      setIsImportingIcs(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const loadingSkeleton = (
    <div className="h-full overflow-auto bg-[var(--ledger-background)]">
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-6 w-56 rounded bg-[var(--ledger-surface-hover)]" />
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)]">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="h-12 bg-[var(--ledger-surface-hover)]" />
          ))}
          {Array.from({ length: 28 }).map((_, index) => (
            <div
              key={index}
              className="min-h-16 border-t border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-2"
            >
              <div className="h-3 w-6 rounded bg-[var(--ledger-surface-hover)]" />
              <div className="mt-2 h-3 w-4/5 rounded bg-[var(--ledger-surface-hover)]" />
              <div className="mt-2 h-3 w-2/3 rounded bg-[var(--ledger-surface-hover)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const attemptCloseCalendar = () => {
    if (isSavingEvent || isSavingEdit || isSavingColorId !== null) {
      setShowCloseGuardModal(true);
      return;
    }
    void window.desktopWindow?.closeModule('calendar');
  };

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-background)] shadow-none"
      style={{ scrollbarGutter: 'auto', ...workspaceShellLayout.workspaceShellStyle }}
    >
      <CloseGuardModal
        isOpen={showCloseGuardModal}
        isSaving
        hasUnsavedChanges={false}
        onCancel={() => setShowCloseGuardModal(false)}
      />
      <ModuleWindowHeader
        title="Calendar"
        subtitle={viewConfig.label}
        icon={<CalendarDays size={18} className="text-[#FF5F40]" />}
        closeLabel="Close calendar"
        minimizeLabel="Minimize calendar"
        onMinimize={() => {
          void window.desktopWindow?.minimizeModule('calendar');
        }}
        fullscreenLabel="Fullscreen calendar"
        onToggleFullscreen={() => {
          void window.desktopWindow?.toggleModuleFullscreen('calendar');
        }}
        onClose={attemptCloseCalendar}
        showPanelToggle
        panelToggleLabel={areSidePanelsCollapsed ? 'Show panels' : 'Hide panels'}
        onTogglePanels={() => {
          if (areSidePanelsCollapsed) {
            setIsLeftPaneCollapsed(false);
            setIsRightPaneCollapsed(false);
          } else {
            setIsLeftPaneCollapsed(true);
            setIsRightPaneCollapsed(true);
          }
        }}
        compact
        showBodyHeader={false}
        globalActions={
          <>
            <ModuleHeaderStripAction
              icon={<Inbox size={12} />}
              count={inboxCount}
              onClick={() => window.desktopWindow?.toggleModule('inbox')}
              title="Open Intake"
              ariaLabel="Open Intake"
            />
            <ModuleHeaderStripAction
              icon={<BellRing size={12} />}
              count={notificationCount}
              onClick={() => window.desktopWindow?.openModule('notifications')}
              title="Open notifications center"
              ariaLabel="Open notifications center"
            />
          </>
        }
        viewControls={
          <div className="flex items-center gap-1.5">
            <ModuleHeaderSegmentedGroup compact>
              <ModuleHeaderSegmentedButton
                compact
                iconOnly
                title="Previous period"
                ariaLabel="Previous period"
                onClick={() => moveView(-1)}
              >
                <ChevronLeft size={14} />
              </ModuleHeaderSegmentedButton>
              <ModuleHeaderSegmentedButton compact pill title="Today" onClick={() => jumpToToday()}>
                Today
              </ModuleHeaderSegmentedButton>
              <ModuleHeaderSegmentedButton
                compact
                iconOnly
                title="Next period"
                ariaLabel="Next period"
                onClick={() => moveView(1)}
              >
                <ChevronRight size={14} />
              </ModuleHeaderSegmentedButton>
            </ModuleHeaderSegmentedGroup>

            <ModuleHeaderSegmentedGroup compact>
              {(['day', 'week', 'month'] as CalendarViewMode[]).map((mode) => (
                <ModuleHeaderSegmentedButton
                  compact
                  key={mode}
                  title={`Switch to ${mode} view`}
                  onClick={() => setViewMode(mode)}
                  active={viewMode === mode}
                >
                  {mode[0].toUpperCase() + mode.slice(1)}
                </ModuleHeaderSegmentedButton>
              ))}
            </ModuleHeaderSegmentedGroup>
          </div>
        }
      />

      {appleSyncMessage && (
        <div
          className={`border-b border-[color:rgba(50,213,131,0.18)] bg-[color:rgba(50,213,131,0.08)] px-5 py-2 text-xs text-[var(--ledger-success)] transition-opacity duration-300 ${
            isAppleSyncMessageVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {appleSyncMessage}
        </div>
      )}
      {importMessage && (
        <div
          className={`border-b border-[color:rgba(59,130,246,0.18)] bg-[color:rgba(59,130,246,0.08)] px-5 py-2 text-xs text-[rgb(191,219,254)] transition-opacity duration-300 ${
            isImportMessageVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {importMessage}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {!isLeftPaneCollapsed ? (
          <>
            <aside
              className="shrink-0 overflow-auto border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-4"
              style={{ width: `${leftPaneWidth}px` }}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Workspace</p>
                <button
                  onClick={() => setIsLeftPaneCollapsed(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                  title="Hide left panel"
                >
                  <ChevronLeft size={13} strokeWidth={2.25} className="-translate-x-px" />
                </button>
              </div>
              <div className="mb-5 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-3">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Month</p>
                    <h2 className="text-sm font-semibold text-[var(--ledger-text-primary)]">
                      {monthPreview.label}
                    </h2>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveView(-1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                      title="Previous period"
                    >
                      <ChevronLeft size={13} strokeWidth={2.25} />
                    </button>
                    <button
                      onClick={() => jumpToToday()}
                      className="h-7 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                    >
                      Today
                    </button>
                    <button
                      onClick={() => moveView(1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                      title="Next period"
                    >
                      <ChevronRight size={13} strokeWidth={2.25} />
                    </button>
                  </div>
                </div>
                <div className="mb-2 grid grid-cols-7 gap-1 text-[10px] font-medium text-[var(--ledger-text-muted)]">
                  {days.map((day) => (
                    <span key={day} className="text-center">
                      {day.slice(0, 1)}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {monthPreview.dates.map((dayDate) => {
                    const key = formatDateKey(dayDate);
                    const inMonth = dayDate.getMonth() === viewAnchor.getMonth();
                    const isToday = key === formatDateKey(new Date());
                    const isActive = key === formatDateKey(viewAnchor);

                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setViewAnchor(dayDate);
                          setViewMode('day');
                        }}
                        className={`h-7 rounded-md text-[11px] font-medium transition ${
                          isActive
                            ? 'bg-[var(--ledger-accent)] text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)]'
                            : isToday
                            ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-accent)]'
                            : inMonth
                            ? 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-accent)]'
                            : 'text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-accent)]'
                        }`}
                      >
                        {dayDate.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mb-5">
                <p className="mb-2 text-xs font-medium text-[var(--ledger-text-muted)]">Overview</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="whitespace-nowrap text-xs font-medium text-[var(--ledger-text-muted)]">
                      Events
                    </p>
                    <p className="text-xl font-semibold leading-tight text-[var(--ledger-text-primary)]">
                      {overviewEventCount}
                    </p>
                  </div>
                  <div>
                    <p className="whitespace-nowrap text-xs font-medium text-[var(--ledger-text-muted)]">
                      Reminders
                    </p>
                    <p className="text-xl font-semibold leading-tight text-[var(--ledger-text-primary)]">
                      {overviewReminderCount}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mb-5 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-xs font-medium text-[var(--ledger-text-muted)]">Calendars</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setNewCalendarName('');
                      setNewCalendarColor(
                        preferenceColorMap[calendarPreferences.calendarColor ?? 'ledger-orange']
                      );
                      setIsNewCalendarModalOpen(true);
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                    title="New calendar"
                    aria-label="New calendar"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="space-y-2">
                  {calendars.map((calendar) => (
                    <div
                      key={calendar.id}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditingCalendarId(null);
                        setCalendarRowContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          calendarId: calendar.id,
                        });
                        setCalendarColorMenu(null);
                      }}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-sm ${
                        calendar.is_visible === false
                          ? 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-muted)]'
                          : 'border-transparent text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: calendar.color }}
                        />
                        {editingCalendarId === calendar.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingCalendarName}
                            onChange={(e) => setEditingCalendarName(e.target.value)}
                            onBlur={() => renameCalendar(calendar.id, editingCalendarName)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                renameCalendar(calendar.id, editingCalendarName);
                              } else if (e.key === 'Escape') {
                                setEditingCalendarId(null);
                              }
                            }}
                            className="truncate rounded border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-1 py-0.5 text-sm font-medium text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)] focus:ring-2 focus:ring-[color:var(--ledger-surface-hover)]/60"
                          />
                        ) : (
                          <span
                            className="cursor-pointer truncate rounded px-1 py-0.5 font-medium hover:bg-[var(--ledger-surface-hover)]"
                            onDoubleClick={() => {
                              setEditingCalendarId(calendar.id);
                              setEditingCalendarName(calendar.name);
                            }}
                            title="Double-click to rename"
                          >
                            {calendar.name}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {!isLoading && calendars.length === 0 && (
                    <p className="text-xs text-[var(--ledger-text-muted)]">No calendars yet.</p>
                  )}
                </div>
              </div>

              <div className="mb-5 border-t border-[color:var(--ledger-border-subtle)] pt-4">
                <h2 className="mb-3 text-xs font-medium text-[var(--ledger-text-muted)]">
                  Quick Actions
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      openComposerAtSlot(formatDateKey(viewAnchor), 9, '', 'event');
                    }}
                    className="h-9 rounded-md bg-[var(--ledger-accent)] text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)]"
                  >
                    New Event
                  </button>
                  <button
                    onClick={() => {
                      openComposerAtSlot(formatDateKey(viewAnchor), 9, '', 'reminder');
                    }}
                    className="h-9 rounded-md bg-[var(--ledger-accent)] text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)]"
                  >
                    New Reminder
                  </button>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    disabled={isImportingIcs}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isImportingIcs ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>Importing...</span>
                      </>
                    ) : (
                      <span>Import .ics</span>
                    )}
                  </button>
                  <button
                    onClick={() => void syncAppleCalendar()}
                    className="h-9 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                  >
                    Sync iCal
                  </button>
                </div>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".ics,text/calendar"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importIcsFile(file);
                  }}
                />
              </div>

              {error && <p className="mt-4 text-xs text-[var(--ledger-danger)]">{error}</p>}
            </aside>

            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={(event) => {
                event.preventDefault();
                setIsResizingSidebar(true);
              }}
              className={`w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-[#EDE3D8] transition-colors ${
                isResizingSidebar ? 'bg-[var(--ledger-border-strong)]' : ''
              }`}
              title="Drag to resize sidebar"
            />
          </>
        ) : (
          <div className="flex w-10 shrink-0 items-start justify-center border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] pt-4">
            <button
              onClick={() => setIsLeftPaneCollapsed(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
              title="Show left panel"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        <section className="flex-1 min-w-0 p-2.5">
          <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-none">
            <div
              ref={centerScrollRef}
              className="flex-1 min-w-0 overflow-auto"
              onWheel={(event) => {
                const container = centerScrollRef.current;
                if (!container) return;

                const hasHorizontalOverflow = container.scrollWidth > container.clientWidth;
                if (!hasHorizontalOverflow) return;

                const horizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY) + 1;
                if (!horizontalIntent) return;

                event.preventDefault();
                container.scrollLeft += event.deltaX;
              }}
            >
              {isInitialLoading ? (
                loadingSkeleton
              ) : viewMode === 'month' ? (
                <div className="min-w-210 p-3">
                  <div className="grid grid-cols-7 overflow-hidden rounded-t-lg border-l border-t border-[color:var(--ledger-border-subtle)]">
                    {days.map((day) => (
                      <div
                        key={day}
                        className="flex h-10 items-center justify-center border-b border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-hover)] text-xs font-semibold text-[var(--ledger-text-secondary)]"
                      >
                        {day}
                      </div>
                    ))}
                    {viewConfig.dates.map((dayDate) => {
                      const key = formatDateKey(dayDate);
                      const dayEvents = eventsByDay[key] ?? [];
                      const dayReminders = remindersByDay[key] ?? [];
                      const visibleEvents = dayEvents.slice(0, 2);
                      const visibleReminders = dayReminders.slice(0, 1);
                      const extraCount =
                        dayEvents.length +
                        dayReminders.length -
                        visibleEvents.length -
                        visibleReminders.length;
                      const inMonth = dayDate.getMonth() === viewAnchor.getMonth();

                      return (
                        <button
                          key={key}
                          onClick={() => {
                            setSelectedEvent(null);
                            setSelectedReminder(null);
                            setViewMode('day');
                            setViewAnchor(dayDate);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setContextMenu({
                              x: event.clientX,
                              y: event.clientY,
                              dateKey: key,
                              hour: 9,
                            });
                          }}
                          className={`min-h-29 border-b border-r border-[color:var(--ledger-border-subtle)] p-2 text-left align-top transition-colors hover:bg-[var(--ledger-surface-hover)] ${
                            inMonth
                              ? 'bg-[var(--ledger-surface-card)]'
                              : 'bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-muted)]'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <span
                              className={`text-xs font-semibold ${
                                inMonth
                                  ? 'text-[var(--ledger-text-primary)]'
                                  : 'text-[var(--ledger-text-muted)]'
                              }`}
                            >
                              {dayDate.getDate()}
                            </span>
                            {dayEvents.length + dayReminders.length > 0 && (
                              <span className="text-[10px] text-[var(--ledger-text-muted)]">
                                {dayEvents.length + dayReminders.length}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 space-y-1">
                            {visibleReminders.map((reminder) =>
                              (() => {
                                const pastReminder = isPastReminder(reminder);
                                return (
                                  <div
                                    key={reminder.id}
                                    className={`text-[10px] leading-tight rounded px-1.5 py-1 truncate ${
                                      pastReminder ? 'opacity-80' : ''
                                    }`}
                                    style={{
                                      backgroundColor: pastReminder
                                        ? '#F6EFE8'
                                        : `${reminder.color ?? '#F59E0B'}1f`,
                                      color: pastReminder ? '#6B7280' : '#1F2937',
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedEvent(null);
                                      setSelectedReminder(reminder);
                                      setViewMode('day');
                                      const date = new Date(reminder.remind_at);
                                      date.setHours(0, 0, 0, 0);
                                      setViewAnchor(date);
                                    }}
                                    onContextMenu={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setListContextMenu({
                                        x: event.clientX,
                                        y: event.clientY,
                                        kind: 'reminder',
                                        id: reminder.id,
                                      });
                                    }}
                                  >
                                    {reminder.title}
                                  </div>
                                );
                              })()
                            )}
                            {visibleEvents.map((event) =>
                              (() => {
                                const meta = getEventStatusMeta(event.status);
                                const calendarColor = getCalendarColor(event.calendar_id);
                                const pastEvent = isPastEvent(event);
                                const pastEventMuted = isPastEventMuted(event);
                                return (
                                  <div
                                    key={event.id}
                                    className={`rounded-md border px-2 py-1 text-[10px] leading-tight shadow-sm ${
                                      meta.previewClass
                                    } ${event.status === 'done' ? 'line-through opacity-80' : ''} ${
                                      event.status === 'cancelled' ? 'opacity-65' : ''
                                    } ${pastEventMuted ? 'opacity-50 grayscale-[0.35]' : ''} ${
                                      pastEvent && !pastEventMuted
                                        ? 'opacity-75 grayscale-[0.15]'
                                        : ''
                                    }`}
                                    style={{
                                      backgroundColor: pastEvent
                                        ? 'var(--ledger-surface-hover)'
                                        : `${calendarColor}22`,
                                      borderColor: pastEvent
                                        ? 'var(--ledger-border-subtle)'
                                        : `${calendarColor}44`,
                                      color: pastEvent
                                        ? 'var(--ledger-text-muted)'
                                        : 'var(--ledger-text-primary)',
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setListContextMenu(null);
                                      setContextMenu(null);
                                      setGridQuickAdd(null);
                                      setGridQuickTitle('');
                                      // Select the occurrence so selectedEventPreview preserves the occurrence time
                                      setSelectedEvent(event);
                                      setSelectedReminder(null);
                                      setViewMode('day');
                                      const eventDate = new Date(event.start_at);
                                      eventDate.setHours(0, 0, 0, 0);
                                      setViewAnchor(eventDate);
                                    }}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setListContextMenu({
                                        x: e.clientX,
                                        y: e.clientY,
                                        kind: 'event',
                                        id: event.id,
                                      });
                                    }}
                                  >
                                    <span
                                      className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${meta.dotClass}`}
                                      style={{ backgroundColor: calendarColor }}
                                    />
                                    {event.status === 'done' && (
                                      <span className="mr-1 inline-block align-middle text-[12px] text-[var(--ledger-success)]">
                                        ✓
                                      </span>
                                    )}
                                    {pastEvent &&
                                      new Date(event.start_at).getHours() === 0 &&
                                      (() => {
                                        try {
                                          console.debug('[Calendar] month-preview-past-midnight', {
                                            id: event.id,
                                            start_at: event.start_at,
                                            parsed: new Date(event.start_at).toString(),
                                          });
                                        } catch (err) {}
                                        return null;
                                      })()}
                                    {event.project_id && (
                                      <Folder
                                        size={8}
                                        className="mr-1 inline-block align-middle text-[var(--ledger-text-muted)]"
                                      />
                                    )}
                                    {event.title}
                                  </div>
                                );
                              })()
                            )}
                            {extraCount > 0 && (
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOverflowDayKey(key);
                                }}
                                className="text-[10px] text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
                              >
                                +{extraCount} more
                              </button>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 p-3">
                  {/* Removed fallback card: events are rendered into the normal day grid, including off-hour rows */}
                  <div
                    className="grid min-w-210"
                    style={{
                      gridTemplateColumns: `72px repeat(${viewConfig.dates.length}, minmax(0, 1fr))`,
                    }}
                  >
                    <div className="sticky top-0 z-50 h-12 border-b border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]" />
                    {viewConfig.dates.map((dayDate) => (
                      <div
                        key={dayDate.toISOString()}
                        className="sticky top-0 z-50 flex h-12 flex-col items-center justify-center border-b border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]"
                      >
                        <span className="text-xs font-semibold text-[var(--ledger-text-secondary)]">
                          {dayDate.toLocaleDateString([], { weekday: 'short' })}
                        </span>
                        <span className="text-[10px] text-[var(--ledger-text-muted)]">
                          {dayDate.getMonth() + 1}/{dayDate.getDate()}
                        </span>
                      </div>
                    ))}

                    <div className="flex h-10 items-start justify-end border-b border-[color:var(--ledger-border-subtle)] pr-3 pt-1.5 text-[11px] text-[var(--ledger-text-muted)]">
                      All day
                    </div>
                    {viewConfig.dates.map((dayDate) => {
                      const key = formatDateKey(dayDate);
                      const allDayItems = (eventsByDay[key] ?? []).filter((evt) =>
                        isAllDayEvent(evt)
                      );
                      const visibleAllDayItems = allDayItems.slice(0, 2);
                      const hiddenAllDayCount = allDayItems.length - visibleAllDayItems.length;

                      return (
                        <div
                          key={`all-day-${key}`}
                          className="relative h-10 border-b border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)]/30 px-1 py-1"
                        >
                          <div className="space-y-0.5">
                            {visibleAllDayItems.map((evt) => {
                              const eventColor = getCalendarColor(evt.calendar_id);
                              const pastEvent = isPastEvent(evt);
                              const pastEventMuted = isPastEventMuted(evt);
                              return (
                                <button
                                  key={evt.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedEvent(evt);
                                    setSelectedReminder(null);
                                    setViewMode('day');
                                    setViewAnchor(dayDate);
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setListContextMenu({
                                      x: e.clientX,
                                      y: e.clientY,
                                      kind: 'event',
                                      id: evt.id,
                                    });
                                  }}
                                  className={`w-full truncate rounded-md border px-2 py-1 text-left text-[10px] leading-tight shadow-sm ${
                                    pastEventMuted ? 'opacity-50 grayscale-[0.35]' : ''
                                  }`}
                                  style={{
                                    backgroundColor: pastEvent
                                      ? 'var(--ledger-surface-hover)'
                                      : `${eventColor}22`,
                                    borderColor: pastEvent
                                      ? 'var(--ledger-border-subtle)'
                                      : `${eventColor}44`,
                                    color: pastEvent
                                      ? 'var(--ledger-text-muted)'
                                      : 'var(--ledger-text-primary)',
                                  }}
                                >
                                  <span
                                    className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                                    style={{ backgroundColor: eventColor }}
                                  />
                                  {evt.status === 'done' && (
                                    <span className="mr-1 inline-block align-middle text-[12px] text-[var(--ledger-success)]">
                                      ✓
                                    </span>
                                  )}
                                  {evt.title}
                                </button>
                              );
                            })}
                            {hiddenAllDayCount > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOverflowDayKey(key);
                                }}
                                className="text-[10px] text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-text-primary)]"
                                title={`${hiddenAllDayCount} more all-day event${
                                  hiddenAllDayCount === 1 ? '' : 's'
                                }`}
                              >
                                +{hiddenAllDayCount} more
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {hoursToRender.map((hour) => (
                      <Fragment key={hour}>
                        {(() => {
                          const hourInt = Number.parseInt(hour.split(':')[0], 10);
                          const rowHeight = Math.max(
                            64,
                            ...viewConfig.dates.map((dayDate) => {
                              const key = formatDateKey(dayDate);
                              const dayReminders = remindersByDay[key] ?? [];
                              const remindersForHour = dayReminders.filter(
                                (reminder) => new Date(reminder.remind_at).getHours() === hourInt
                              );
                              const visibleReminders = remindersForHour.slice(0, 2);
                              const hiddenReminders =
                                remindersForHour.length - visibleReminders.length;
                              return (
                                64 +
                                (visibleReminders.length > 0
                                  ? visibleReminders.length * 24 + (hiddenReminders > 0 ? 16 : 0)
                                  : 0)
                              );
                            })
                          );
                          return (
                            <>
                              <div
                                data-timeline-hour={hourInt}
                                className="flex items-start justify-end border-b border-[color:var(--ledger-border-subtle)] pr-3 pt-1.5 text-[11px] text-[var(--ledger-text-muted)]"
                                style={{ minHeight: `${rowHeight}px` }}
                              >
                                {formatCalendarHourLabel(hourInt)}
                              </div>
                              {viewConfig.dates.map((dayDate) => {
                                const key = formatDateKey(dayDate);
                                const hourStart = dayDate ? new Date(dayDate) : new Date();
                                hourStart.setHours(hourInt, 0, 0, 0);
                                const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
                                const hourEvents = (eventsByDay[key] ?? []).filter((evt) => {
                                  if (isAllDayEvent(evt)) return false;
                                  const startTs = new Date(evt.start_at).getTime();
                                  const endTs = new Date(evt.end_at).getTime();
                                  return startTs < hourEnd.getTime() && endTs > hourStart.getTime();
                                });
                                const startingEvents = hourEvents.filter((evt) => {
                                  const startTs = new Date(evt.start_at).getTime();
                                  return (
                                    startTs >= hourStart.getTime() && startTs < hourEnd.getTime()
                                  );
                                });
                                const dayReminders = remindersByDay[key] ?? [];
                                const visibleItems = startingEvents.slice(0, 2);
                                const hiddenCount = startingEvents.length - visibleItems.length;
                                const remindersForHour = dayReminders.filter(
                                  (reminder) => new Date(reminder.remind_at).getHours() === hourInt
                                );
                                const visibleReminders = remindersForHour.slice(0, 2);
                                const hiddenReminders =
                                  remindersForHour.length - visibleReminders.length;
                                const hasOccupiedTimelineCell =
                                  hourEvents.length > 0 || remindersForHour.length > 0;
                                const reminderStackHeight =
                                  visibleReminders.length > 0
                                    ? visibleReminders.length * 24 + (hiddenReminders > 0 ? 16 : 6)
                                    : 0;
                                const isQuickAddOpen =
                                  gridQuickAdd?.dateKey === key && gridQuickAdd?.hour === hourInt;

                                return (
                                  <div
                                    key={`${hour}-${key}`}
                                    className={`relative cursor-pointer border-b border-l border-[color:var(--ledger-border-subtle)] px-1 py-1 transition-colors ${
                                      hasOccupiedTimelineCell
                                        ? ''
                                        : 'hover:bg-[var(--ledger-surface-hover)]'
                                    }`}
                                    style={{
                                      minHeight: `${rowHeight}px`,
                                      zIndex: startingEvents.length > 0 ? 5 : 0,
                                    }}
                                    onClick={() => {
                                      setSelectedEvent(null);
                                      setSelectedReminder(null);
                                      setContextMenu(null);
                                      setListContextMenu(null);
                                      setGridQuickAdd(null);
                                      setGridQuickTitle('');
                                      setViewMode('day');
                                      setViewAnchor(dayDate);
                                    }}
                                    onContextMenu={(event) => {
                                      event.preventDefault();
                                      setGridQuickAdd(null);
                                      setGridQuickTitle('');
                                      setContextMenu({
                                        x: event.clientX,
                                        y: event.clientY,
                                        dateKey: key,
                                        hour: hourInt,
                                      });
                                    }}
                                  >
                                    {isQuickAddOpen && (
                                      <div
                                        className="absolute left-1 right-1 top-1 z-20 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 shadow-[var(--ledger-shadow)]"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <input
                                          autoFocus
                                          value={gridQuickTitle}
                                          onChange={(e) => setGridQuickTitle(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              void createGridEvent();
                                            }
                                            if (e.key === 'Escape') {
                                              setGridQuickAdd(null);
                                              setGridQuickTitle('');
                                            }
                                          }}
                                          placeholder="Quick event title"
                                          className="h-7 w-full rounded border border-[color:var(--ledger-border-subtle)] px-2 text-[11px] outline-none focus:border-[color:var(--ledger-border-strong)]"
                                        />
                                        <div className="mt-1 flex justify-end gap-1">
                                          <button
                                            onClick={() => {
                                              setGridQuickAdd(null);
                                              setGridQuickTitle('');
                                            }}
                                            className="rounded bg-[var(--ledger-surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--ledger-text-secondary)]"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            onClick={() => void createGridEvent()}
                                            disabled={!gridQuickTitle.trim() || isSavingEvent}
                                            className="rounded bg-[var(--ledger-accent)] px-1.5 py-0.5 text-[10px] text-white disabled:opacity-60"
                                          >
                                            Add
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {(visibleReminders.length > 0 || hiddenReminders > 0) && (
                                      <div className="relative z-40 mb-1 space-y-1">
                                        {visibleReminders.map((reminder) => (
                                          <button
                                            key={reminder.id}
                                            onClick={(e) => {
                                              setSelectedEvent(null);
                                              setSelectedReminder(null);
                                              e.stopPropagation();
                                              void toggleReminderDone(reminder);
                                            }}
                                            onContextMenu={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              setListContextMenu({
                                                x: e.clientX,
                                                y: e.clientY,
                                                kind: 'reminder',
                                                id: reminder.id,
                                              });
                                            }}
                                            className={`relative z-30 block w-full truncate rounded-md border px-2 py-1.5 text-left text-[10px] leading-tight shadow-sm ${
                                              reminder.is_done &&
                                              (calendarPreferences.completedReminderBehavior ??
                                                'collapse') === 'collapse'
                                                ? 'line-through opacity-70'
                                                : reminder.is_done
                                                ? 'line-through opacity-60'
                                                : ''
                                            } ${isPastReminder(reminder) ? 'opacity-80' : ''}`}
                                            style={{
                                              backgroundColor: isPastReminder(reminder)
                                                ? 'var(--ledger-surface-hover)'
                                                : `${reminder.color ?? '#F59E0B'}1a`,
                                              borderColor: isPastReminder(reminder)
                                                ? 'var(--ledger-border-subtle)'
                                                : `${reminder.color ?? '#F59E0B'}55`,
                                              color: isPastReminder(reminder)
                                                ? 'var(--ledger-text-muted)'
                                                : 'var(--ledger-text-primary)',
                                            }}
                                            title={`${formatCalendarTime(
                                              new Date(reminder.remind_at)
                                            )} • ${reminder.title}`}
                                          >
                                            <span
                                              className="mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full align-middle"
                                              style={{
                                                backgroundColor: isPastReminder(reminder)
                                                  ? '#9CA3AF'
                                                  : reminder.color ?? '#F59E0B',
                                              }}
                                            />
                                            Reminder: {reminder.title}
                                          </button>
                                        ))}
                                        {hiddenReminders > 0 && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setOverflowDayKey(key);
                                            }}
                                            className="relative z-40 text-[10px] font-medium text-[var(--ledger-warning)]"
                                            title={`${hiddenReminders} more reminder${
                                              hiddenReminders === 1 ? '' : 's'
                                            }`}
                                          >
                                            +{hiddenReminders} reminders
                                          </button>
                                        )}
                                      </div>
                                    )}
                                    {visibleItems.map((evt) => {
                                      const eventColor = getCalendarColor(evt.calendar_id);
                                      const pastEvent = isPastEvent(evt);
                                      const pastEventMuted = isPastEventMuted(evt);
                                      const durationRows = getEventDurationRows(evt);
                                      const minuteOffset = getEventMinuteOffset(evt);
                                      const durationMinutes = getEventDurationMinutes(evt);
                                      return (
                                        <button
                                          key={evt.id}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedEvent(evt);
                                          }}
                                          onContextMenu={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setListContextMenu({
                                              x: e.clientX,
                                              y: e.clientY,
                                              kind: 'event',
                                              id: evt.id,
                                            });
                                          }}
                                          className={`group absolute inset-x-1 z-30 flex flex-col rounded-md border text-left text-[10px] leading-tight shadow-sm transition-[border-color,box-shadow,transform] ${
                                            durationRows > 1 ? 'p-2' : 'px-2 py-1.5'
                                          }`}
                                          style={{
                                            pointerEvents: 'auto',
                                            top: `${Math.max(
                                              8,
                                              reminderStackHeight +
                                                6 +
                                                (minuteOffset / 60) * TIMELINE_HOUR_HEIGHT
                                            )}px`,
                                            height: `${Math.max(
                                              40,
                                              (durationMinutes / 60) * TIMELINE_HOUR_HEIGHT - 12
                                            )}px`,
                                            backgroundColor: pastEvent
                                              ? 'var(--ledger-surface-hover)'
                                              : `${eventColor}18`,
                                            borderColor: pastEvent
                                              ? 'var(--ledger-border-subtle)'
                                              : `${eventColor}55`,
                                            color: pastEvent
                                              ? 'var(--ledger-text-muted)'
                                              : 'var(--ledger-text-primary)',
                                            boxSizing: 'border-box',
                                            lineHeight: 1.2,
                                            overflow: 'hidden',
                                            boxShadow: pastEvent
                                              ? 'none'
                                              : `0 0 0 1px ${eventColor}12, 0 1px 2px rgba(15, 23, 42, 0.04)`,
                                          }}
                                        >
                                          <span
                                            aria-hidden="true"
                                            className="pointer-events-none absolute inset-0 rounded-md opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                                            style={{
                                              backgroundColor: pastEvent
                                                ? 'var(--ledger-surface-hover)'
                                                : `${eventColor}24`,
                                            }}
                                          />
                                          <div className="flex gap-1.5 min-w-0">
                                            <span
                                              className="relative z-10 h-1.5 w-1.5 rounded-full shrink-0 mt-0.5"
                                              style={{ backgroundColor: eventColor }}
                                            />
                                            <div className="relative z-10 min-w-0 flex-1">
                                              <div className="flex items-start gap-1 min-w-0">
                                                {evt.status === 'done' && (
                                                  <span className="shrink-0 text-[10px] font-semibold leading-none -mt-0.5 text-[var(--ledger-success)]">
                                                    ✓
                                                  </span>
                                                )}
                                                {evt.project_id && (
                                                  <Folder
                                                    size={8}
                                                    className="shrink-0 text-[var(--ledger-text-muted)]"
                                                  />
                                                )}
                                                <span
                                                  className={`font-medium ${
                                                    durationRows > 1 ? 'line-clamp-3' : 'truncate'
                                                  } ${pastEventMuted ? 'opacity-70' : ''}`}
                                                >
                                                  {evt.title}
                                                </span>
                                              </div>
                                              {durationRows > 1 && (
                                                <div
                                                  className={`text-[9px] text-[var(--ledger-text-muted)] ${
                                                    durationRows > 1 ? 'mt-1' : 'mt-0.5'
                                                  }`}
                                                >
                                                  {formatEventTimeRangeLabel(evt)}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </button>
                                      );
                                    })}
                                    {hiddenCount > 0 && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOverflowDayKey(key);
                                        }}
                                        className="relative z-30 px-1.5 py-0.5 text-[10px] text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                                      >
                                        +{hiddenCount} more
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </>
                          );
                        })()}
                      </Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {!isRightPaneCollapsed && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={(event) => {
                event.preventDefault();
                setIsResizingRightPane(true);
              }}
              className={`w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--ledger-surface-hover)] ${
                isResizingRightPane ? 'bg-[var(--ledger-border-strong)]' : ''
              }`}
              title="Drag to resize inspector"
            />

            <aside
              className="overflow-auto border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-5 py-6"
              style={{ width: `${rightPaneWidth}px` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Day context</p>
                  <h2 className="mt-2 text-[15px] font-semibold leading-5 text-[var(--ledger-text-primary)]">
                    {selectedContextDate.toLocaleDateString([], {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </h2>
                  <p className="mt-1 text-[13px] text-[var(--ledger-text-secondary)]">
                    {selectedContextDayEventCountLabel} · {selectedContextDayReminderCountLabel}
                  </p>
                </div>
                <button
                  onClick={() => setIsRightPaneCollapsed(true)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
                  title="Hide right panel"
                  aria-label="Hide right panel"
                >
                  <ChevronRight size={13} strokeWidth={2.25} />
                </button>
              </div>

              <div className="mt-6 space-y-6">
                <div className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-6">
                  <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                    Selected event
                  </p>
                  {selectedEventPreview ? (
                    (() => {
                      const meta = getEventStatusMeta(selectedEventPreview.status);
                      const selectedColor = getCalendarColor(selectedEventPreview.calendar_id);
                      return (
                        <div className="space-y-2">
                          <div className="flex items-start gap-2">
                            <span
                              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: selectedColor }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2">
                                <p className="flex-1 text-[14px] font-semibold leading-5 text-[var(--ledger-text-primary)]">
                                  {selectedEventPreview.title}
                                </p>
                                <div className="flex shrink-0 items-center gap-1">
                                  {selectedEventPreview.status === 'done' && (
                                    <span className="text-[14px] font-semibold leading-none text-[var(--ledger-success)]">
                                      ✓
                                    </span>
                                  )}
                                {canEditEvent(selectedEventPreview) && (
                                  <button
                                    onClick={() => openEventEditor(selectedEventPreview)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-accent)]"
                                    aria-label="Edit event"
                                    title="Edit event"
                                  >
                                    <PencilLine size={14} />
                                  </button>
                                )}
                                <PinActionButton
                                  objectType="event"
                                  objectId={selectedEventPreview.id}
                                  showLabel={false}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                                  iconSize={14}
                                />
                              </div>
                              </div>
                              <p className="mt-1 text-[13px] text-[var(--ledger-text-secondary)]">
                                {formatEventDateTimeLabel(selectedEventPreview)}
                              </p>
                              <p className="mt-1 text-[13px] text-[var(--ledger-text-primary)]">
                                {meta.label}
                              </p>
                              <p className="mt-1 text-[12px] text-[var(--ledger-text-muted)]">
                                Visibility ·{' '}
                                {selectedEventPreview.visibility === 'workspace'
                                  ? 'Workspace'
                                  : 'Private'}
                              </p>
                              {showWorkspaceNames && selectedEventPreview.workspace_name && (
                                <p className="mt-1 text-[12px] text-[var(--ledger-text-muted)]">
                                  Workspace · {selectedEventPreview.workspace_name}
                                </p>
                              )}
                              <div className="mt-3 space-y-2 text-[13px]">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[var(--ledger-text-muted)]">Project</span>
                                  {selectedEventProject ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void window.desktopWindow?.toggleModule('projects', {
                                          focusProjectId: selectedEventProject.id,
                                        })
                                      }
                                      className="truncate font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-accent)]"
                                    >
                                      {selectedEventProject.name} →
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void (selectedEventPreview ? openLinkProjectModal() : null)
                                      }
                                      className="font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-accent)]"
                                    >
                                      + Link project
                                    </button>
                                  )}
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[var(--ledger-text-muted)]">
                                    Linked note
                                  </span>
                                  {selectedEventNote ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void window.desktopWindow?.toggleModule('notes', {
                                          focusNoteId: selectedEventNote.id,
                                        })
                                      }
                                      className="max-w-36 truncate font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-accent)]"
                                    >
                                      {selectedEventNote.title} →
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => void openLinkNoteModal()}
                                      className="font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-accent)]"
                                    >
                                      + Link note
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : selectedReminder ? (
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <span
                          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: selectedReminder.color ?? '#F59E0B' }}
                        />
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold leading-5 text-[var(--ledger-text-primary)]">
                            {selectedReminder.title}
                          </p>
                          <p className="mt-1 text-[13px] text-[var(--ledger-text-secondary)]">
                            {new Date(selectedReminder.remind_at).toLocaleString([], {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </p>
                          <p className="mt-1 text-[13px] text-[var(--ledger-text-primary)]">
                            Reminder context
                          </p>
                          {showWorkspaceNames && selectedReminder.workspace_name && (
                            <p className="mt-1 text-[12px] text-[var(--ledger-text-muted)]">
                              Workspace · {selectedReminder.workspace_name}
                            </p>
                          )}
                          <div className="mt-3 space-y-2 text-[13px]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[var(--ledger-text-muted)]">Project</span>
                              {selectedReminderProject ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void window.desktopWindow?.toggleModule('projects', {
                                      focusProjectId: selectedReminderProject.id,
                                    })
                                  }
                                  className="truncate font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-accent)]"
                                >
                                  {selectedReminderProject.name} →
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void openLinkProjectModal()}
                                  className="font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-accent)]"
                                >
                                  + Link project
                                </button>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[var(--ledger-text-muted)]">Linked note</span>
                              {selectedReminderNote ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void window.desktopWindow?.toggleModule('notes', {
                                      focusNoteId: selectedReminderNote.id,
                                    })
                                  }
                                  className="truncate font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-accent)]"
                                >
                                  {selectedReminderNote.title} →
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void openLinkNoteModal()}
                                  className="font-medium text-[var(--ledger-text-muted)] transition hover:text-[var(--ledger-accent)]"
                                >
                                  + Link note
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-1">
                        <button
                          onClick={() => openReminderEditor(selectedReminder)}
                          className="w-full text-left text-[13px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-accent)]"
                        >
                          Open reminder
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[14px] text-[var(--ledger-text-muted)]">
                      Select an event or reminder to view context.
                    </p>
                  )}
                </div>

                {selectedEventPreview && calendarPreferences.eventNotesBehavior !== 'disabled' && (
                  <div className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-6">
                    <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                      Event notes
                    </p>
                    <textarea
                      value={selectedEventNoteDraft}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setEventNotesDrafts((prev) => ({
                          ...prev,
                          [selectedEventPreview.id]: nextValue,
                        }));
                      }}
                      rows={2}
                      placeholder="Add notes for this event..."
                      className="w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2 text-[13px] text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)] focus:border-[color:var(--ledger-border-strong)]"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] text-[var(--ledger-text-muted)]">
                        Saved to the event.
                      </p>
                      <button
                        type="button"
                        onClick={() => void saveSelectedEventNotes()}
                        className="text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)]"
                      >
                        Save notes
                      </button>
                    </div>
                  </div>
                )}

                {selectedEventPreview && calendarPreferences.followUpBehavior !== 'none' && (
                  <div className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-6">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-[var(--ledger-text-muted)]">
                        Follow-ups
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          window.desktopWindow?.toggleModule('quick-follow-up' as any, {
                            focusContext: `ledger-followup|${baseEventId(
                              selectedEventPreview.id
                            )}|${encodeURIComponent(selectedEventPreview.title)}|${
                              selectedEventPreview.project_id ?? ''
                            }|${selectedEventPreview.note_id ?? ''}|${
                              calendarPreferences.followUpDefaultTime ?? 'tomorrow_9'
                            }|${calendarPreferences.linkedProjectFollowUps ?? 'project_and_today'}`,
                          })
                        }
                        className="inline-flex items-center gap-0.5 text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-accent)]"
                      >
                        <span>+ </span>
                        <span>
                          {calendarPreferences.followUpBehavior === 'review_prompt'
                            ? 'Review'
                            : 'Add'}
                        </span>
                      </button>
                    </div>
                    {selectedEventFollowUps.length > 0 ? (
                      <div className="space-y-1">
                        {selectedEventFollowUps.map((task) => (
                          <button
                            key={task.id}
                            onClick={() =>
                              void window.desktopWindow?.toggleModule('dashboard', {
                                focusTaskId: task.id,
                              })
                            }
                            className="flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-[13px] transition hover:bg-[var(--ledger-surface-hover)]"
                            title={task.title}
                          >
                            <span className="min-w-0 truncate text-[var(--ledger-text-primary)]">
                              {task.title}
                            </span>
                            <span className="shrink-0 text-[12px] text-[var(--ledger-text-muted)]">
                              {task.status === 'done' ? 'Done' : 'Todo'}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[14px] text-[var(--ledger-text-muted)]">
                        No follow-ups yet.
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2 border-t border-[color:var(--ledger-border-subtle)] pt-6">
                  <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Agenda</p>
                  <div className="space-y-1">
                    {selectedContextDayEvents.length === 0 ? (
                      <p className="text-[14px] text-[var(--ledger-text-muted)]">
                        No events for this day.
                      </p>
                    ) : (
                      selectedContextDayEvents.map((event) => {
                        const isSelected = selectedEventPreview?.id === event.id;
                        const eventColor = getCalendarColor(event.calendar_id);
                        return (
                          <button
                            key={event.id}
                            onClick={() => setSelectedEvent(event)}
                            className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition ${
                              isSelected
                                ? 'bg-[var(--ledger-surface-hover)] ring-1 ring-[color:var(--ledger-border-subtle)]'
                                : 'hover:bg-[var(--ledger-surface-hover)]'
                            }`}
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{
                                backgroundColor: isPastEvent(event) ? '#9CA3AF' : eventColor,
                              }}
                            />
                            <p className="w-28 shrink-0 whitespace-nowrap text-[12px] font-medium text-[var(--ledger-text-primary)]">
                              {formatEventTimeLabel(event)}
                            </p>
                            <div className="min-w-0 flex-1">
                              <p
                                className={`truncate text-[13px] ${
                                  isPastEvent(event)
                                    ? 'text-[var(--ledger-text-muted)]'
                                    : 'text-[var(--ledger-text-secondary)]'
                                }`}
                              >
                                {event.title}
                              </p>
                              {showWorkspaceNames && event.workspace_name && (
                                <p className="mt-0.5 truncate text-[11px] text-[var(--ledger-text-muted)]">
                                  Workspace · {event.workspace_name}
                                </p>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </>
        )}
        {isRightPaneCollapsed && (
          <div className="flex w-10 shrink-0 items-start justify-center border-l border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] pt-4">
            <button
              onClick={() => setIsRightPaneCollapsed(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)]"
              title="Show right panel"
            >
              <ChevronLeft size={13} strokeWidth={2.25} />
            </button>
          </div>
        )}
      </div>

      {isComposerOpen && (
        <ModalOverlay
          isOpen={isComposerOpen}
          onClose={() => {
            if (!isSavingEvent) setIsComposerOpen(false);
          }}
          closeOnBackdropClick={!isSavingEvent}
          backdropBorderRadius="inherit"
          disablePortal
          manageWindowChrome={false}
          classNameContainer="w-full max-w-[420px] overflow-hidden rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"
        >
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                {composerMode === 'reminder' ? 'New Reminder' : 'New Event'}
              </h3>
              <ModalCloseButton
                onClick={() => {
                  if (!isSavingEvent) setIsComposerOpen(false);
                }}
                ariaLabel="Close event composer"
                disabled={isSavingEvent}
                className="shrink-0"
              />
            </div>
            <div className="space-y-2.5">
              <input
                value={newEventTitle}
                onChange={(e) => setNewEventTitle(e.target.value)}
                placeholder={composerMode === 'reminder' ? 'Reminder title' : 'Event title'}
                className="h-9 w-full rounded-md border border-[#E2D4C4] px-3 text-sm focus:border-gray-400 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={newEventDate}
                  onChange={(e) => setNewEventDate(e.target.value)}
                  className="h-9 rounded-md border border-[#E2D4C4] px-2 text-sm focus:border-gray-400 focus:outline-none"
                />
                <input
                  type="time"
                  value={newEventTime}
                  onChange={(e) => setNewEventTime(e.target.value)}
                  className="h-9 rounded-md border border-[#E2D4C4] px-2 text-sm focus:border-gray-400 focus:outline-none"
                />
              </div>
              {composerMode === 'event' && (
                <div className="grid grid-cols-[1fr_92px] gap-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={newEventDurationValue}
                    onChange={(e) => setNewEventDurationValue(Number(e.target.value) || 1)}
                    className="h-9 rounded-md border border-[#E2D4C4] px-2 text-sm focus:border-gray-400 focus:outline-none"
                  />
                  <div className="relative">
                    <select
                      value={newEventDurationUnit}
                      onChange={(e) =>
                        setNewEventDurationUnit(e.target.value as 'minutes' | 'hours')
                      }
                      className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-8 text-sm focus:border-gray-400 focus:outline-none"
                    >
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                    </select>
                    <ChevronDown
                      size={16}
                      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                  </div>
                </div>
              )}
              <div className="relative">
                <select
                  value={composerCalendarId || getDefaultCalendar()?.id || ''}
                  onChange={(e) => setComposerCalendarId(e.target.value)}
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                  disabled={calendars.length === 0}
                >
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
              {composerMode === 'event' && (
                <div className="relative">
                  <select
                    value={newEventVisibility}
                    onChange={(e) =>
                      setNewEventVisibility(e.target.value as 'private' | 'workspace')
                    }
                    className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                  >
                    <option value="private">Private</option>
                    <option value="workspace">Workspace</option>
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                  />
                </div>
              )}
              <div className="relative">
                <select
                  value={composerProjectId}
                  onChange={(e) => setComposerProjectId(e.target.value)}
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                >
                  <option value="">None</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
              <div className="relative">
                <select
                  value={composerNoteId}
                  onChange={(e) => setComposerNoteId(e.target.value)}
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                >
                  <option value="">None</option>
                  {notes.map((note) => (
                    <option key={note.id} value={note.id}>
                      {note.title}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
              <textarea
                value={composerNotes}
                onChange={(e) => setComposerNotes(e.target.value)}
                placeholder={
                  composerMode === 'reminder'
                    ? 'Optional reminder notes'
                    : 'Add context for this event...'
                }
                rows={3}
                className="w-full rounded-md border border-[#E2D4C4] px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:border-gray-400"
              />
              <div className="relative">
                <select
                  value={newEventRecurrence}
                  onChange={(e) => {
                    const nextValue = e.target.value as
                      | 'none'
                      | 'daily'
                      | 'weekly'
                      | 'monthly'
                      | 'weekdays'
                      | 'specific_dates';
                    if (nextValue === 'specific_dates') {
                      openSpecificDatesPicker();
                      return;
                    }
                    setNewEventRecurrence(nextValue);
                  }}
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="specific_dates">
                    {formatSpecificDatesLabel(newEventSpecificDates.length)}
                  </option>
                </select>
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
              {specificDatesValidationMessage && (
                <p className="text-xs text-red-600">{specificDatesValidationMessage}</p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setIsComposerOpen(false)}
                className="rounded-md bg-[#FFF1E3] px-3 py-2 text-xs font-medium text-gray-700 hover:bg-[#EDE3D8]"
              >
                Cancel
              </button>
              <button
                onClick={() => void createQuickEvent()}
                disabled={
                  isSavingEvent ||
                  !newEventTitle.trim() ||
                  calendars.length === 0 ||
                  Boolean(specificDatesValidationMessage)
                }
                className="rounded-md bg-[var(--ledger-accent)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--ledger-accent-hover)] disabled:opacity-60"
              >
                {isSavingEvent
                  ? 'Saving...'
                  : composerMode === 'reminder'
                  ? 'Create Reminder'
                  : 'Create'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      <ModalOverlay
        isOpen={isSpecificDatesModalOpen}
        onClose={() => closeSpecificDatesPicker(true)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-[460px] rounded-2xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#E8DDD4] px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Specific dates</h3>
            <p className="mt-1 text-sm text-gray-600">Choose each date this should appear.</p>
          </div>
          <ModalCloseButton
            onClick={() => closeSpecificDatesPicker(true)}
            ariaLabel="Close specific dates modal"
            className="shrink-0"
          />
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSpecificDatesMonthAnchor((current) => addMonths(current, -1))}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E2D4C4] bg-[#FFF8F2] text-gray-600 hover:bg-[#FFF1E3]"
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <p className="text-sm font-semibold text-gray-900">
              {specificDatesMonthAnchor.toLocaleDateString([], { month: 'long', year: 'numeric' })}
            </p>
            <button
              type="button"
              onClick={() => setSpecificDatesMonthAnchor((current) => addMonths(current, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E2D4C4] bg-[#FFF8F2] text-gray-600 hover:bg-[#FFF1E3]"
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-[10px] font-medium text-gray-500">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((dayLabel, index) => (
              <div key={`${dayLabel}-${index}`} className="text-center">
                {dayLabel}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {specificDatesMonthGrid.map((date) => {
              const dateKey = formatDateKey(date);
              const isSelected = specificDatesDraft.includes(dateKey);
              const isToday = dateKey === formatDateKey(new Date());
              const inMonth = date.getMonth() === specificDatesMonthAnchor.getMonth();

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => toggleSpecificDate(dateKey)}
                  className={`flex h-9 items-center justify-center rounded-full text-sm transition ${
                    isSelected
                      ? 'bg-[#FF5F40] text-white shadow-sm'
                      : isToday
                      ? 'border border-[#FDBA74] text-gray-900'
                      : inMonth
                      ? 'text-gray-800 hover:bg-[#FFF7ED]'
                      : 'text-gray-300 hover:bg-[#FFF1E3]'
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5 rounded-xl border border-[#E8DDD4] bg-[#FFF8F2] px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-gray-900">
                Selected: {specificDatesDraft.length} date
                {specificDatesDraft.length === 1 ? '' : 's'}
              </p>
              {specificDatesDraft.length > 0 && (
                <p className="text-xs text-gray-500">
                  {specificDatesDraft.length === 1
                    ? '1 selected date'
                    : `${specificDatesDraft.length} selected dates`}
                </p>
              )}
            </div>
            <p className="text-sm text-gray-700">{specificDatesDraftPreview}</p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[#E8DDD4] px-5 py-3">
          <button
            type="button"
            onClick={clearSpecificDatesDraft}
            className="rounded-lg border border-[#E2D4C4] bg-[#FFF8F2] px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-[#FFF1E3]"
          >
            Clear
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => closeSpecificDatesPicker(true)}
              className="rounded-lg border border-[#E2D4C4] bg-[#FFF8F2] px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-[#FFF1E3]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveSpecificDatesPicker}
              disabled={specificDatesDraft.length === 0 && !specificDatesCleared}
              className="rounded-lg bg-[#FF5F40] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#f4583a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save dates
            </button>
          </div>
        </div>
      </ModalOverlay>

      {isNewCalendarModalOpen && (
        <ModalOverlay
          isOpen={isNewCalendarModalOpen}
          onClose={() => {
            if (!isCreatingCalendar) setIsNewCalendarModalOpen(false);
          }}
          closeOnBackdropClick={!isCreatingCalendar}
          backdropBorderRadius="inherit"
          disablePortal
          manageWindowChrome={false}
          classNameContainer="w-full max-w-[384px] overflow-hidden rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"
        >
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">New Calendar</h3>
              <ModalCloseButton
                onClick={() => {
                  if (!isCreatingCalendar) setIsNewCalendarModalOpen(false);
                }}
                ariaLabel="Close new calendar modal"
                disabled={isCreatingCalendar}
                className="shrink-0"
              />
            </div>
            <div className="space-y-2.5">
              <input
                value={newCalendarName}
                onChange={(e) => setNewCalendarName(e.target.value)}
                placeholder="Calendar name"
                className="h-9 w-full rounded-md border border-[#E2D4C4] px-3 text-sm focus:border-gray-400 focus:outline-none"
              />
              <label className="flex h-9 items-center justify-between rounded-md border border-[#E2D4C4] px-2.5">
                <span className="text-sm text-gray-700">Color</span>
                <input
                  type="color"
                  value={newCalendarColor}
                  onChange={(e) => setNewCalendarColor(e.target.value)}
                  className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setIsNewCalendarModalOpen(false)}
                className="rounded-md bg-[#FFF1E3] px-3 py-2 text-xs font-medium text-gray-700 hover:bg-[#EDE3D8]"
              >
                Cancel
              </button>
              <button
                onClick={() => void createNewCalendar()}
                disabled={isCreatingCalendar || !newCalendarName.trim()}
                className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {isCreatingCalendar ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      <ModalOverlay
        isOpen={isLinkProjectModalOpen}
        onClose={() => setIsLinkProjectModalOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-xl rounded-2xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#E8DDD4] px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
              Link project
            </p>
            <p className="mt-1 text-base font-semibold text-gray-900">
              Attach this event to a project
            </p>
          </div>
          <ModalCloseButton
            onClick={() => setIsLinkProjectModalOpen(false)}
            ariaLabel="Close link project modal"
            className="shrink-0"
          />
        </div>
        <div className="space-y-3 p-5">
          <input
            type="text"
            value={linkProjectsSearch}
            onChange={(e) => setLinkProjectsSearch(e.target.value)}
            placeholder="Search projects"
            className="w-full rounded-lg border border-[#E2D4C4] bg-[#FFF8F2] px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-300"
          />
          <div className="max-h-80 overflow-auto rounded-lg border border-[#E2D4C4] bg-[#FFF8F2]">
            {isLoadingLinkProjects ? (
              <p className="p-3 text-sm text-gray-500">Loading projects…</p>
            ) : linkProjects.filter((p) =>
                p.name.toLowerCase().includes(linkProjectsSearch.toLowerCase())
              ).length === 0 ? (
              <p className="p-3 text-sm text-gray-500">No projects found.</p>
            ) : (
              linkProjects
                .filter((p) => p.name.toLowerCase().includes(linkProjectsSearch.toLowerCase()))
                .map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    disabled={isLinkingProject}
                    onClick={() => void linkEventToProject(project.id)}
                    className="w-full border-b border-[#E8DDD4] px-3 py-2 text-left last:border-b-0 hover:bg-[#FFF1E3] disabled:opacity-50"
                  >
                    <p className="truncate text-sm font-medium text-gray-900">{project.name}</p>
                  </button>
                ))
            )}
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-[#E8DDD4] px-5 py-3">
          <button
            type="button"
            onClick={() => setIsLinkProjectModalOpen(false)}
            className="rounded-lg border border-[#E2D4C4] px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-[#FFF1E3]"
          >
            Cancel
          </button>
        </div>
      </ModalOverlay>

      <ModalOverlay
        isOpen={isLinkNoteModalOpen}
        onClose={() => setIsLinkNoteModalOpen(false)}
        backdropBorderRadius="inherit"
        disablePortal
        manageWindowChrome={false}
        classNameContainer="w-full max-w-xl rounded-2xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#E8DDD4] px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
              Link note
            </p>
            <p className="mt-1 text-base font-semibold text-gray-900">
              Attach this event to a note
            </p>
          </div>
          <ModalCloseButton
            onClick={() => setIsLinkNoteModalOpen(false)}
            ariaLabel="Close link note modal"
            className="shrink-0"
          />
        </div>
        <div className="space-y-3 p-5">
          <input
            type="text"
            value={linkNotesSearch}
            onChange={(e) => setLinkNotesSearch(e.target.value)}
            placeholder="Search notes"
            className="w-full rounded-lg border border-[#E2D4C4] bg-[#FFF8F2] px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-300"
          />
          <div className="max-h-80 overflow-auto rounded-lg border border-[#E2D4C4] bg-[#FFF8F2]">
            {isLoadingLinkNotes ? (
              <p className="p-3 text-sm text-gray-500">Loading notes…</p>
            ) : linkNotes.filter((note) =>
                note.title.toLowerCase().includes(linkNotesSearch.toLowerCase())
              ).length === 0 ? (
              <p className="p-3 text-sm text-gray-500">No notes found.</p>
            ) : (
              linkNotes
                .filter((note) => note.title.toLowerCase().includes(linkNotesSearch.toLowerCase()))
                .map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    disabled={isLinkingNote}
                    onClick={() => void linkEventToNote(note.id)}
                    className="w-full border-b border-[#E8DDD4] px-3 py-2 text-left last:border-b-0 hover:bg-[#FFF1E3] disabled:opacity-50"
                  >
                    <p className="truncate text-sm font-medium text-gray-900">{note.title}</p>
                  </button>
                ))
            )}
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-[#E8DDD4] px-5 py-3">
          <button
            type="button"
            onClick={() => setIsLinkNoteModalOpen(false)}
            className="rounded-lg border border-[#E2D4C4] px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-[#FFF1E3]"
          >
            Cancel
          </button>
        </div>
      </ModalOverlay>

      {eventEditorEvent && (
        <ModalOverlay
          isOpen={Boolean(eventEditorEvent)}
          onClose={() => {
            setEventEditorEvent(null);
            setConfirmDelete(false);
          }}
          closeOnBackdropClick={!isSavingEdit && !isDeletingEvent}
          backdropBorderRadius="inherit"
          disablePortal
          manageWindowChrome={false}
          classNameContainer="w-full max-w-[440px] overflow-hidden rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"
        >
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Edit Event</h3>
              <ModalCloseButton
                onClick={() => {
                  setEventEditorEvent(null);
                  setConfirmDelete(false);
                }}
                ariaLabel="Close event editor"
                disabled={isSavingEdit || isDeletingEvent}
                className="shrink-0"
              />
            </div>

            <div className="space-y-2.5">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Event title"
                className="h-9 w-full rounded-md border border-[#E2D4C4] px-3 text-sm focus:border-gray-400 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="h-9 rounded-md border border-[#E2D4C4] px-2 text-sm focus:border-gray-400 focus:outline-none"
                />
                <input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  className="h-9 rounded-md border border-[#E2D4C4] px-2 text-sm focus:border-gray-400 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-[1fr_92px] gap-2">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={editDurationValue}
                  onChange={(e) => setEditDurationValue(Number(e.target.value) || 1)}
                  className="h-9 rounded-md border border-[#E2D4C4] px-2 text-sm focus:border-gray-400 focus:outline-none"
                />
                <div className="relative">
                  <select
                    value={editDurationUnit}
                    onChange={(e) => setEditDurationUnit(e.target.value as 'minutes' | 'hours')}
                    className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-8 text-sm focus:border-gray-400 focus:outline-none"
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                  />
                </div>
              </div>
              <div className="relative">
                <select
                  value={editStatus}
                  onChange={(e) =>
                    setEditStatus(e.target.value as 'planned' | 'done' | 'missed' | 'cancelled')
                  }
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                >
                  <option value="planned">Planned</option>
                  <option value="done">Done</option>
                  <option value="missed">Missed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
              <div className="relative">
                <select
                  value={editVisibility}
                  onChange={(e) => setEditVisibility(e.target.value as 'private' | 'workspace')}
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                >
                  <option value="private">Private</option>
                  <option value="workspace">Workspace</option>
                </select>
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
              <div className="relative">
                <select
                  value={editProjectId}
                  onChange={(e) => setEditProjectId(e.target.value)}
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                >
                  <option value="">None</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
              <div className="relative">
                <select
                  value={editNoteId}
                  onChange={(e) => setEditNoteId(e.target.value)}
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                >
                  <option value="">None</option>
                  {notes.map((note) => (
                    <option key={note.id} value={note.id}>
                      {note.title}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
              <div className="relative">
                <select
                  value={editRecurrence}
                  onChange={(e) =>
                    setEditRecurrence(
                      e.target.value as 'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays'
                    )
                  }
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="weekdays">Weekdays</option>
                </select>
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
              <div className="relative">
                <select
                  value={editCalendarId}
                  onChange={(e) => setEditCalendarId(e.target.value)}
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                >
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
                </select>
                <span
                  className="pointer-events-none absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border border-[#E2D4C4]"
                  style={{ backgroundColor: calendarById.get(editCalendarId)?.color ?? editColor }}
                />
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div>
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
                  >
                    Delete
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-md bg-[#FFF1E3] px-2.5 py-2 text-xs text-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void deleteEvent()}
                      disabled={isDeletingEvent}
                      className="rounded-md bg-red-600 px-2.5 py-2 text-xs text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {isDeletingEvent ? 'Deleting...' : 'Confirm'}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEventEditorEvent(null);
                    setConfirmDelete(false);
                  }}
                  className="rounded-md bg-[#FFF1E3] px-3 py-2 text-xs font-medium text-gray-700 hover:bg-[#EDE3D8]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveEventEdits()}
                  disabled={isSavingEdit || !editTitle.trim()}
                  className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                >
                  {isSavingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {selectedReminder && (
        <ModalOverlay
          isOpen={Boolean(selectedReminder)}
          onClose={() => setSelectedReminder(null)}
          closeOnBackdropClick={!isSavingEdit && !isDeletingReminder}
          backdropBorderRadius="inherit"
          disablePortal
          manageWindowChrome={false}
          classNameContainer="w-full max-w-[440px] overflow-hidden rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"
        >
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Edit Reminder</h3>
              <div className="flex items-center gap-1">
                <PinActionButton
                  objectType="reminder"
                  objectId={selectedReminder.id}
                  showLabel={false}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition hover:bg-[#FFF1E3] hover:text-gray-900"
                  iconSize={14}
                />
                <ModalCloseButton
                  onClick={() => setSelectedReminder(null)}
                  ariaLabel="Close reminder editor"
                  disabled={isSavingEdit || isDeletingReminder}
                  className="shrink-0"
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <input
                value={reminderEditTitle}
                onChange={(e) => setReminderEditTitle(e.target.value)}
                placeholder="Reminder title"
                className="h-9 w-full rounded-md border border-[#E2D4C4] px-3 text-sm focus:border-gray-400 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={reminderEditDate}
                  onChange={(e) => setReminderEditDate(e.target.value)}
                  className="h-9 rounded-md border border-[#E2D4C4] px-2 text-sm focus:border-gray-400 focus:outline-none"
                />
                <input
                  type="time"
                  value={reminderEditTime}
                  onChange={(e) => setReminderEditTime(e.target.value)}
                  className="h-9 rounded-md border border-[#E2D4C4] px-2 text-sm focus:border-gray-400 focus:outline-none"
                />
              </div>
              <label className="flex h-9 items-center justify-between rounded-md border border-[#E2D4C4] px-2.5">
                <span className="text-sm text-gray-700">Done</span>
                <input
                  type="checkbox"
                  checked={reminderEditDone}
                  onChange={(e) => setReminderEditDone(e.target.checked)}
                />
              </label>
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Snooze</p>
                <div className="flex flex-wrap gap-1.5">
                  {resolveReminderSnoozeOptions(calendarPreferences.reminderSnoozePreset).map(
                    (option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() =>
                          selectedReminder &&
                          void snoozeReminderByMinutes(selectedReminder, option.minutes)
                        }
                        className="rounded-md border border-[#E2D4C4] bg-[#FFF8F2] px-2.5 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-[#FFF1E3]"
                      >
                        {option.label}
                      </button>
                    )
                  )}
                </div>
              </div>
              <div className="relative">
                <select
                  value={reminderEditCalendarId}
                  onChange={(e) => setReminderEditCalendarId(e.target.value)}
                  className="h-9 w-full appearance-none rounded-md border border-[#E2D4C4] bg-[#FFF8F2] pl-2 pr-9 text-sm focus:border-gray-400 focus:outline-none"
                >
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
                </select>
                <span
                  className="pointer-events-none absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border border-[#E2D4C4]"
                  style={{
                    backgroundColor:
                      calendarById.get(reminderEditCalendarId)?.color ?? reminderEditColor,
                  }}
                />
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => void deleteReminderFromEditor()}
                disabled={isDeletingReminder}
                className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
              >
                {isDeletingReminder ? 'Deleting...' : 'Delete'}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedReminder(null)}
                  className="rounded-md bg-[#FFF1E3] px-3 py-2 text-xs font-medium text-gray-700 hover:bg-[#EDE3D8]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveReminderEdits()}
                  disabled={isSavingEdit || !reminderEditTitle.trim()}
                  className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                >
                  {isSavingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {overflowDayKey && (
        <ModalOverlay
          isOpen={Boolean(overflowDayKey)}
          onClose={() => setOverflowDayKey(null)}
          backdropBorderRadius="inherit"
          disablePortal
          manageWindowChrome={false}
          classNameContainer="w-full max-w-[520px] max-h-[72vh] overflow-hidden rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"
        >
          <div className="max-h-[72vh] overflow-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                {parseDateKey(overflowDayKey).toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </h3>
              <ModalCloseButton
                onClick={() => setOverflowDayKey(null)}
                ariaLabel="Close overflow day modal"
                className="shrink-0"
              />
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-medium text-gray-500">Reminders</p>
                <div className="space-y-1.5">
                  {overflowReminders.length === 0 && (
                    <p className="text-xs text-gray-500">No reminders.</p>
                  )}
                  {overflowReminders.map((reminder) => (
                    <button
                      key={reminder.id}
                      onClick={() => openReminderEditor(reminder)}
                      className="w-full rounded-md border border-amber-100 bg-amber-50 px-2.5 py-2 text-left text-xs text-gray-800"
                    >
                      <span className="font-medium">{reminder.title}</span>
                      <span className="ml-2 text-gray-600">
                        {formatCalendarTime(new Date(reminder.remind_at))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-gray-500">Events</p>
                <div className="space-y-1.5">
                  {overflowEvents.length === 0 && (
                    <p className="text-xs text-gray-500">No events.</p>
                  )}
                  {overflowEvents.map((event) => (
                    <button
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className={`w-full rounded-md border px-2.5 py-2 text-left text-xs text-gray-800 ${
                        selectedEventPreview?.id === event.id
                          ? 'border-gray-400 bg-[#FFF1E3]'
                          : 'border-[#E2D4C4] bg-[#FFF8F2]'
                      }`}
                    >
                      <span className="font-medium">{event.title}</span>
                      <span className="ml-2 text-gray-600">{formatEventTimeLabel(event)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] py-1 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 188)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 138)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              openComposerAtSlot(contextMenu.dateKey, contextMenu.hour);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <CalendarPlus size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
            <span className="text-[14px] font-medium tracking-tight">New Event</span>
          </button>
          <button
            onClick={() => {
              openComposerAtSlot(contextMenu.dateKey, contextMenu.hour, 'Reminder', 'reminder');
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <BellRing size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
            <span className="text-[14px] font-medium tracking-tight">New Reminder</span>
          </button>
          <button
            disabled
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm cursor-not-allowed text-[var(--ledger-text-muted)]/50"
          >
            <ClipboardPaste size={14} className="shrink-0 text-[var(--ledger-text-muted)]/50" />
            <span className="text-[14px] font-medium tracking-tight">Paste Event</span>
          </button>
        </div>
      )}

      {calendarRowContextMenu && (
        <div
          className="fixed z-50 min-w-48 overflow-hidden rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] py-1 shadow-xl"
          style={{
            left: Math.max(8, Math.min(calendarRowContextMenu.x, window.innerWidth - 192)),
            top: Math.max(8, Math.min(calendarRowContextMenu.y, window.innerHeight - 176)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const calendar = calendars.find(
                (item) => item.id === calendarRowContextMenu.calendarId
              );
              if (calendar) {
                setEditingCalendarId(calendar.id);
                setEditingCalendarName(calendar.name);
              }
              setCalendarRowContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-[#FFF1E3]"
          >
            <PencilLine size={14} className="shrink-0 text-gray-500" />
            <span className="text-[14px] font-medium tracking-tight">Rename</span>
          </button>
          <button
            onClick={() => {
              const calendar = calendars.find(
                (item) => item.id === calendarRowContextMenu.calendarId
              );
              if (calendar) {
                void toggleCalendarVisibility(calendar);
              }
              setCalendarRowContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-[#FFF1E3]"
          >
            {calendars.find((item) => item.id === calendarRowContextMenu.calendarId)?.is_visible ===
            false ? (
              <Eye size={14} className="shrink-0 text-gray-500" />
            ) : (
              <EyeOff size={14} className="shrink-0 text-gray-500" />
            )}
            <span className="text-[14px] font-medium tracking-tight">
              {calendars.find((item) => item.id === calendarRowContextMenu.calendarId)
                ?.is_visible === false
                ? 'Show'
                : 'Hide'}
            </span>
          </button>
          <button
            onClick={() => {
              const calendar = calendars.find(
                (item) => item.id === calendarRowContextMenu.calendarId
              );
              if (calendar) {
                setCalendarColorMenu({
                  x: Math.max(8, Math.min(calendarRowContextMenu.x, window.innerWidth - 264)),
                  y: Math.max(8, Math.min(calendarRowContextMenu.y + 12, window.innerHeight - 180)),
                  calendarId: calendar.id,
                });
              }
              setCalendarRowContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-[#FFF1E3]"
          >
            <Palette size={14} className="shrink-0 text-gray-500" />
            <span className="text-[14px] font-medium tracking-tight">Change color</span>
          </button>
          <button
            onClick={() => {
              const calendar = calendars.find(
                (item) => item.id === calendarRowContextMenu.calendarId
              );
              if (calendar) {
                const confirmed = window.confirm(
                  `Delete calendar “${calendar.name}”? Events and reminders in it will also be removed.`
                );
                if (confirmed) void deleteCalendar(calendar);
              }
              setCalendarRowContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} className="shrink-0 text-red-500" />
            <span className="text-[14px] font-medium tracking-tight">Delete</span>
          </button>
        </div>
      )}

      {calendarColorMenu && (
        <div
          className="fixed z-50 w-64 overflow-hidden rounded-xl border border-[#E2D4C4] bg-[#FFF8F2] p-3 shadow-xl"
          style={{
            left: Math.max(8, Math.min(calendarColorMenu.x, window.innerWidth - 264)),
            top: Math.max(8, Math.min(calendarColorMenu.y, window.innerHeight - 180)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">Calendar Color</p>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {[
              '#94A3B8',
              '#3B82F6',
              '#F97316',
              '#22C55E',
              '#A855F7',
              '#EC4899',
              '#EF4444',
              '#F59E0B',
              '#06B6D4',
              '#0EA5E9',
              '#14B8A6',
              '#8B5CF6',
            ].map((color) => {
              const calendar = calendars.find((item) => item.id === calendarColorMenu.calendarId);
              const isActive = (calendar?.color ?? '') === color;
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    const target = calendars.find(
                      (item) => item.id === calendarColorMenu.calendarId
                    );
                    if (target) void saveCalendarColor(target, color);
                    setCalendarColorMenu(null);
                  }}
                  className={`h-6 w-6 rounded-full border-2 transition ${
                    isActive ? 'border-gray-900' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              );
            })}
          </div>
        </div>
      )}

      {listContextMenu &&
        (() => {
          const menuWidth = 248;
          const menuHeight = listContextMenu.kind === 'event' ? 292 : 280;
          const viewportPadding = 8;
          const menuActualWidth = Math.min(menuWidth, window.innerWidth - viewportPadding * 2);
          const canOpenBelow =
            listContextMenu.y + menuHeight + viewportPadding <= window.innerHeight;
          const top = canOpenBelow
            ? listContextMenu.y + viewportPadding
            : Math.max(viewportPadding, listContextMenu.y - menuHeight - viewportPadding);
          const left = Math.max(
            viewportPadding,
            Math.min(listContextMenu.x, window.innerWidth - menuActualWidth - viewportPadding)
          );
          const menuTarget = getListContextMenuSlot();
          const menuTitle =
            menuTarget?.title ?? (listContextMenu.kind === 'event' ? 'Event' : 'Reminder');
          const menuTime = menuTarget?.timeLabel ?? null;
          const showPastCheck = Boolean(menuTarget?.isPast);

          return (
            <div
              className="fixed z-50 overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
              style={{
                left,
                top,
                width: `${menuActualWidth}px`,
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="border-b border-[color:var(--ledger-border-subtle)] px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ledger-text-muted)]">
                  {listContextMenu.kind === 'event' ? 'Event' : 'Reminder'}
                </p>
                <div className="mt-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {showPastCheck && (
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ledger-success)]">
                        <Check size={12} strokeWidth={2.5} />
                      </span>
                    )}
                    <p className="truncate text-[14px] font-semibold leading-5 text-[var(--ledger-text-primary)]">
                      {menuTitle}
                    </p>
                  </div>
                  {menuTime ? (
                    <p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">{menuTime}</p>
                  ) : null}
                </div>
              </div>
              <div className="px-1.5 py-1.5">
                {listContextMenu.kind === 'event' ? (
                  (() => {
                    const event = events.find(
                      (item) => item.id === baseEventId(listContextMenu.id)
                    );
                    const canEditMenuEvent = Boolean(event && canEditEvent(event));

                    return (
                      <button
                      onClick={() => {
                        if (!canEditMenuEvent || !event) return;
                        openEventEditor(event);
                        setListContextMenu(null);
                      }}
                      disabled={!canEditMenuEvent}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm ${
                        canEditMenuEvent
                            ? 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                            : 'cursor-not-allowed text-[var(--ledger-text-muted)]/60'
                        }`}
                      title={canEditMenuEvent ? 'Edit Event' : 'Past events are read-only here'}
                    >
                        <PencilLine size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
                        <span className="min-w-0 truncate text-[14px] font-medium tracking-tight">
                          Edit Event
                        </span>
                      </button>
                    );
                  })()
                ) : (
                  <button
                    onClick={() => {
                      const reminder = reminders.find((item) => item.id === listContextMenu.id);
                      if (reminder) openReminderEditor(reminder);
                      setListContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                  >
                    <PencilLine size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
                    <span className="min-w-0 truncate text-[14px] font-medium tracking-tight">
                      Edit Reminder
                    </span>
                  </button>
                )}

                <button
                  onClick={() => openNewItemFromListContextMenu('event')}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <CalendarPlus size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
                  <span className="min-w-0 truncate text-[14px] font-medium tracking-tight">
                    New Event Here
                  </span>
                </button>

                <button
                  onClick={() => openNewItemFromListContextMenu('reminder')}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                >
                  <BellRing size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
                  <span className="min-w-0 truncate text-[14px] font-medium tracking-tight">
                    New Reminder Here
                  </span>
                </button>

                {listContextMenu.kind === 'event' ? (
                  <button
                    onClick={() => {
                      const event = events.find(
                        (item) => item.id === baseEventId(listContextMenu.id)
                      );
                      if (event) {
                        const nextStatus = event.status === 'done' ? 'planned' : 'done';
                        void api.updateEvent(event.id, { status: nextStatus });
                        setEvents((prev) =>
                          prev.map((item) =>
                            item.id === event.id ? { ...item, status: nextStatus } : item
                          )
                        );
                        setSelectedEvent((current) =>
                          current && baseEventId(current.id) === event.id
                            ? { ...current, status: nextStatus }
                            : current
                        );
                      }
                      setListContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                  >
                    <BellRing size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
                    <span className="min-w-0 truncate text-[14px] font-medium tracking-tight">
                      Mark{' '}
                      {events.find((item) => item.id === baseEventId(listContextMenu.id))
                        ?.status === 'done'
                        ? 'Planned'
                        : 'Done'}
                    </span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const reminder = reminders.find((item) => item.id === listContextMenu.id);
                      if (reminder) void toggleReminderDone(reminder);
                      setListContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
                  >
                    <BellRing size={14} className="shrink-0 text-[var(--ledger-text-muted)]" />
                    <span className="min-w-0 truncate text-[14px] font-medium tracking-tight">
                      Toggle Done
                    </span>
                  </button>
                )}

                <div className="my-1.5 border-t border-[color:var(--ledger-border-subtle)]" />

                <button
                  onClick={() => {
                    if (listContextMenu.kind === 'event') {
                      void quickDeleteEvent(listContextMenu.id);
                    } else {
                      void quickDeleteReminder(listContextMenu.id);
                    }
                    setListContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[#D33C2D] hover:bg-[rgba(255,95,64,0.12)]"
                >
                  <Trash2 size={14} className="shrink-0 text-[#E0523E]" />
                  <span className="min-w-0 truncate text-[14px] font-medium tracking-tight">
                    Delete {listContextMenu.kind === 'event' ? 'Event' : 'Reminder'}
                  </span>
                </button>
              </div>
            </div>
          );
        })()}
    </div>
  );
};

export default CalendarWindow;
