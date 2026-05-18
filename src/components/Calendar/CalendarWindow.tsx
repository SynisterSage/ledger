import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
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
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ModalOverlay } from '../Common/ModalOverlay';
import * as rruleModule from 'rrule';
import { useAuthContext } from '../../context/AuthContext';
import {
  modulePaneSizing,
  clampPaneWidth,
  getPaneWidthForViewport,
} from '../../config/modulePaneSizes';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { ModuleWindowHeader } from '../Common/ModuleWindowHeader';
import { CloseGuardModal } from '../Common/CloseGuardModal';
import { useViewportWidth } from '../../hooks/useViewportWidth';

// Get RRule from the module - handles both ESM and CommonJS
const RRule = (rruleModule as any).RRule || (rruleModule as any).default?.RRule || rruleModule;

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
  recurrence_rule?: 'none' | 'daily' | 'weekly' | 'weekdays';
  all_day?: boolean;
  project_id?: string | null;
  note_id?: string | null;
  notes?: string | null;
};

type ReminderRow = {
  id: string;
  title: string;
  remind_at: string;
  calendar_id: string;
  color?: string;
  is_done: boolean;
  project_id?: string | null;
  note_id?: string | null;
  notes?: string | null;
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
const hours = Array.from({ length: 12 }, (_, i) => `${i + 8}:00`);
const NOTIFICATION_VISIBLE_MS = 4000;
const NOTIFICATION_FADE_MS = 350;
const SIDEBAR_MIN_WIDTH = modulePaneSizing.calendar.left.min;
const SIDEBAR_MAX_WIDTH = 460;
const INSPECTOR_MIN_WIDTH = modulePaneSizing.calendar.right.min;
const INSPECTOR_MAX_WIDTH = 420;

const startOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfWeek = (date: Date) => {
  const s = startOfWeek(date);
  const e = new Date(s);
  e.setDate(s.getDate() + 7);
  return e;
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
const endOfLocalDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};
const baseEventId = (id: string) => id.split('__')[0];
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
  const api = useApi();
  const viewportWidth = useViewportWidth();
  const centerScrollRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedDataRef = useRef(false);
  const hasAppliedInitialFocusContextRef = useRef(false);
  const initialFocusDate = new URLSearchParams(window.location.search).get('focusDate');
  const initialFocusContext =
    new URLSearchParams(window.location.search).get('focusContext')?.trim() ?? '';
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [viewAnchor, setViewAnchor] = useState(() => {
    if (initialFocusDate) {
      const date = new Date(initialFocusDate);
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDate, setNewEventDate] = useState(() => formatDateKey(new Date()));
  const [newEventTime, setNewEventTime] = useState('09:00');
  const [newEventDurationValue, setNewEventDurationValue] = useState(30);
  const [newEventDurationUnit, setNewEventDurationUnit] = useState<'minutes' | 'hours'>('minutes');
  const [newEventRecurrence, setNewEventRecurrence] = useState<
    'none' | 'daily' | 'weekly' | 'weekdays'
  >('none');
  const [composerMode, setComposerMode] = useState<'event' | 'reminder'>('event');
  const [composerCalendarId, setComposerCalendarId] = useState('');
  const [composerProjectId, setComposerProjectId] = useState('');
  const [composerNoteId, setComposerNoteId] = useState('');
  const [composerNotes, setComposerNotes] = useState('');
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
  const [editRecurrence, setEditRecurrence] = useState<'none' | 'daily' | 'weekly' | 'weekdays'>(
    'none'
  );
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
  const [defaultEventDurationMinutes, setDefaultEventDurationMinutes] = useState(30);
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);
  const [isNewCalendarModalOpen, setIsNewCalendarModalOpen] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [newCalendarColor, setNewCalendarColor] = useState('#3B82F6');
  const [isCreatingCalendar, setIsCreatingCalendar] = useState(false);
  const [leftPaneWidth, setLeftPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.calendar.left)
  );
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [rightPaneWidth, setRightPaneWidth] = useState(() =>
    getPaneWidthForViewport(viewportWidth, modulePaneSizing.calendar.right)
  );
  const [isResizingRightPane, setIsResizingRightPane] = useState(false);
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(false);
  const [isRightPaneCollapsed, setIsRightPaneCollapsed] = useState(false);
  const [overflowDayKey, setOverflowDayKey] = useState<string | null>(null);
  const areSidePanelsCollapsed = isLeftPaneCollapsed && isRightPaneCollapsed;
  const monthPreview = useMemo(() => {
    const start = startOfMonthGrid(viewAnchor);
    return {
      label: viewAnchor.toLocaleDateString([], { month: 'long', year: 'numeric' }),
      dates: Array.from({ length: 42 }, (_, i) => addDays(start, i)),
    };
  }, [viewAnchor]);
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

  const getEventStatusMeta = (status?: EventRow['status']) => {
    switch (status) {
      case 'done':
        return {
          label: 'Done',
          chipClass: 'border-green-200 bg-green-50 text-green-900',
          dotClass: 'bg-green-500',
          previewClass: 'bg-green-50 border-green-200 text-green-950',
        };
      case 'missed':
        return {
          label: 'Missed',
          chipClass: 'border-amber-200 bg-amber-50 text-amber-900',
          dotClass: 'bg-amber-500',
          previewClass: 'bg-amber-50 border-amber-200 text-amber-950',
        };
      case 'cancelled':
        return {
          label: 'Cancelled',
          chipClass: 'border-gray-200 bg-gray-100 text-gray-700',
          dotClass: 'bg-gray-400',
          previewClass: 'bg-gray-100 border-gray-200 text-gray-700',
        };
      default:
        return {
          label: 'Planned',
          chipClass: 'border-blue-200 bg-blue-50 text-blue-900',
          dotClass: 'bg-blue-500',
          previewClass: 'bg-blue-50 border-blue-200 text-blue-950',
        };
    }
  };
  useEffect(() => {
    const applyFocusDate = (focusDate: string) => {
      const date = new Date(focusDate);
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
  }, [initialFocusContext, events]);

  useEffect(() => {
    if (!pendingFocusEventId) return;
    focusEventById(pendingFocusEventId);
  }, [events, pendingFocusEventId]);

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

    const start = startOfWeek(viewAnchor);
    const end = endOfWeek(viewAnchor);
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
      dates: Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    };
  }, [viewAnchor, viewMode]);

  const visibleCalendarIdsMemo = useMemo(() => {
    return new Set(calendars.filter((calendar) => calendar.is_visible !== false).map((c) => c.id));
  }, [calendars]);

  const visibleEvents = useMemo(() => {
    const expanded: EventRow[] = [];
    // Use the precomputed visibleCalendarIds to filter events
    const visibleCalendarIds = visibleCalendarIdsMemo;
    for (const event of events) {
      if (!visibleCalendarIds.has(event.calendar_id)) continue;
      const recurrence = event.recurrence_rule ?? 'none';
      if (recurrence === 'none') {
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
        const isWeekday = cursor.getDay() >= 1 && cursor.getDay() <= 5;
        const matches =
          recurrence === 'daily' ||
          (recurrence === 'weekly' && sameWeekday) ||
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
  }, [events, viewConfig.start, viewConfig.end, visibleCalendarIdsMemo]);

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
          console.debug('[Calendar] past event at midnight', { id: evt.id, start_at: evt.start_at, end_at: evt.end_at });
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
            grouped[selectedKey].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
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

    for (const reminder of reminders) {
      // only include reminders from visible calendars
      if (!visibleCalendarIdsMemo.has(reminder.calendar_id)) continue;
      const key = formatDateKey(new Date(reminder.remind_at));
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(reminder);
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].sort(
        (a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime()
      );
    }

    return grouped;
  }, [reminders, viewConfig.dates, visibleCalendarIdsMemo]);

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
    selectedTimelineHour !== null && selectedTimelineHour >= 8 && selectedTimelineHour < 20;
  const hoursToRender = useMemo(() => {
    const hourSet = new Set<number>(hours.map((h) => Number.parseInt(h.split(':')[0], 10)));

    // Include hours present in visible events/reminders for the current view's dates
    const dateKeys = new Set(viewConfig.dates.map((d) => formatDateKey(d)));

    for (const evt of visibleEvents) {
      const key = formatDateKey(new Date(evt.start_at));
      if (!dateKeys.has(key)) continue;
      hourSet.add(new Date(evt.start_at).getHours());
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
    const startLabel = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (getEventDurationMinutes(event) > 60) {
      const endLabel = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
      const startLabel = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (getEventDurationMinutes(event) > 60) {
        const endLabel = new Date(event.end_at).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        });
        return `${base}, ${startLabel} – ${endLabel}`;
      }
      return `${base}, ${startLabel}`;
    })();
  const getEventDurationMinutes = (event: EventRow) =>
    Math.max(1, Math.round((new Date(event.end_at).getTime() - new Date(event.start_at).getTime()) / 60000));
  const getEventDurationRows = (event: EventRow) =>
    Math.max(1, Math.min(12, Math.ceil(getEventDurationMinutes(event) / 60)));
  const formatEventTimeRangeLabel = (event: EventRow) => {
    if (isAllDayEvent(event)) return 'All day';
    const start = new Date(event.start_at);
    const end = new Date(event.end_at);
    const startLabel = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const endLabel = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  const isPastEvent = (event: EventRow) => new Date(event.end_at).getTime() < Date.now();
  const canEditEvent = (event: EventRow) => !isPastEvent(event);
  const isPastReminder = (reminder: ReminderRow) => new Date(reminder.remind_at).getTime() < Date.now();

  useEffect(() => {
    let cancelled = false;

    const loadPreferenceDefaults = async () => {
      try {
        const payload = (await api.getUserSettings()) as {
          preferences?: { defaultEventMinutes?: number } | null;
        };
        if (cancelled) return;

        const minutes = Number(payload?.preferences?.defaultEventMinutes ?? 30);
        setDefaultEventDurationMinutes([30, 45, 60].includes(minutes) ? minutes : 30);
      } catch {
        if (!cancelled) setDefaultEventDurationMinutes(30);
      }
    };

    void loadPreferenceDefaults();

    return () => {
      cancelled = true;
    };
  }, [api, user?.id]);

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
  }, [selectedTimelineHour, selectedTimelineInVisibleHours, viewMode, selectedEventPreview, selectedReminder]);

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
          setIsRefreshing(false);
        }
        return;
      }

      const isInitialLoad = !hasLoadedDataRef.current;
      if (isInitialLoad) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError(null);

      try {
        const loadedCalendars = await api.getCalendars();

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
          api.getEvents(viewConfig.start.toISOString(), viewConfig.end.toISOString()),
          api.getReminders(),
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
        const reminderRowsById = new Set(((reminderRows ?? []) as ReminderRow[]).map((item) => item.id));
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
          setIsRefreshing(false);
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
    viewConfig.start.toISOString(),
    viewConfig.end.toISOString(),
    api,
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
    setNewEventTime(`${String(hour).padStart(2, '0')}:00`);
    const defaultDuration = getDurationDisplay(defaultEventDurationMinutes);
    setNewEventDurationValue(defaultDuration.value);
    setNewEventDurationUnit(defaultDuration.unit);
    setNewEventTitle(title);
    setNewEventRecurrence('none');
    setComposerCalendarId(
      calendars.find(
        (calendar) => calendar.is_visible !== false && (calendar.is_personal || calendar.is_default)
      )?.id ??
        calendars[0]?.id ??
        ''
    );
    setComposerProjectId('');
    setComposerNoteId('');
    setComposerNotes('');
    setComposerMode(mode);
    setIsComposerOpen(true);
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

  const createQuickEvent = async () => {
    if (!user || !newEventTitle.trim() || calendars.length === 0) return;

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
      const createdReminder = (await api.createReminder({
        title: newEventTitle.trim(),
        remind_at: start.toISOString(),
        calendar_id: selectedCalendar.id,
        color: selectedCalendar.color,
        is_done: false,
        project_id: composerProjectId || null,
        note_id: composerNoteId || null,
        notes: composerNotes.trim() || null,
      })) as ReminderRow;

      setIsSavingEvent(false);

      if (!createdReminder) {
        setError('Could not create reminder.');
        return;
      }

      setReminders((prev) =>
        [...prev, createdReminder].sort(
          (a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime()
        )
      );
      setSelectedEvent(null);
      setNewEventTitle('');
      setIsComposerOpen(false);
      setComposerMode('event');
      setNewEventRecurrence('none');
      setComposerCalendarId(getDefaultCalendar()?.id ?? '');
      setComposerProjectId('');
      setComposerNoteId('');
      setComposerNotes('');
      const defaultDuration = getDurationDisplay(defaultEventDurationMinutes);
      setNewEventDurationValue(defaultDuration.value);
      setNewEventDurationUnit(defaultDuration.unit);
      notifyCalendarItemsUpdated();
      return;
    }

    const createdEvent = (await api.createEvent({
      title: newEventTitle.trim(),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      calendar_id: selectedCalendar.id,
      color: selectedCalendar.color,
      recurrence_rule: newEventRecurrence,
      status: 'planned',
      project_id: composerProjectId || null,
      note_id: composerNoteId || null,
      notes: composerNotes.trim() || null,
    })) as EventRow;

    setIsSavingEvent(false);

    if (!createdEvent) {
      setError('Could not create event.');
      return;
    }

    setEvents((prev) =>
      [...prev, createdEvent].sort(
        (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      )
    );
    setSelectedEvent(createdEvent);
    setSelectedReminder(null);
    setNewEventTitle('');
    setIsComposerOpen(false);
    setComposerMode('event');
    setNewEventRecurrence('none');
    setComposerCalendarId(getDefaultCalendar()?.id ?? '');
    setComposerProjectId('');
    setComposerNoteId('');
    setComposerNotes('');
    const defaultDuration = getDurationDisplay(defaultEventDurationMinutes);
    setNewEventDurationValue(defaultDuration.value);
    setNewEventDurationUnit(defaultDuration.unit);
    notifyCalendarItemsUpdated();
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
      setNewCalendarColor('#3B82F6');
    } catch (error) {
      setError('Could not create calendar.');
    } finally {
      setIsCreatingCalendar(false);
    }
  };

  const toggleReminderDone = async (reminder: ReminderRow) => {
    try {
      const updated = (await api.updateReminder(reminder.id, {
        is_done: !reminder.is_done,
      })) as ReminderRow;

      if (!updated) {
        setError('Could not update reminder.');
        return;
      }

      setReminders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      setError('Could not update reminder.');
      return;
    }
  };

  const quickDeleteReminder = async (reminderId: string) => {
    try {
      await api.deleteReminder(reminderId);
      setReminders((prev) => prev.filter((item) => item.id !== reminderId));
    } catch (error) {
      setError('Could not delete reminder.');
      return;
    }
  };

  const openReminderEditor = (reminder: ReminderRow) => {
    const start = new Date(reminder.remind_at);
    setSelectedReminder(reminder);
    setReminderEditTitle(reminder.title);
    setReminderEditDate(formatDateKey(start));
    setReminderEditTime(
      `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
    );
    setReminderEditCalendarId(reminder.calendar_id);
    setReminderEditColor(reminder.color ?? '#F59E0B');
    setReminderEditDone(reminder.is_done);
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

    const updated = (await api.updateReminder(selectedReminder.id, {
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
        .map((item) => (item.id === updated.id ? updated : item))
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
  };

  const deleteReminderFromEditor = async () => {
    if (!selectedReminder) return;
    setIsDeletingReminder(true);
    setError(null);

    try {
      await api.deleteReminder(selectedReminder.id);
      setReminders((prev) => prev.filter((item) => item.id !== selectedReminder.id));
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
    setEditRecurrence(source.recurrence_rule ?? 'none');
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
        const updated = (await api.updateReminder(selectedReminder.id, {
          project_id: projectId,
        })) as ReminderRow;
        setReminders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setSelectedReminder((current) => (current?.id === updated.id ? updated : current));
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
        const updated = (await api.updateReminder(selectedReminder.id, {
          note_id: noteId,
        })) as ReminderRow;
        setReminders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setSelectedReminder((current) => (current?.id === updated.id ? updated : current));
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

    const selectedCalendar = getDefaultCalendar();
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
      status: 'planned',
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

      const selectedCalendar = getDefaultCalendar();
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
            status: item.status,
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
    <div className="h-full overflow-auto bg-white">
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-6 w-56 rounded bg-gray-200" />
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-gray-200">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="h-12 bg-gray-100" />
          ))}
          {Array.from({ length: 28 }).map((_, index) => (
            <div key={index} className="min-h-16 border-t border-gray-200 bg-gray-50 p-2">
              <div className="h-3 w-6 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-4/5 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-2/3 rounded bg-gray-200" />
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
      className="h-screen overflow-hidden rounded-[28px] border border-gray-200 bg-[#f5f7fb] flex flex-col shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
      style={{ scrollbarGutter: 'stable' }}
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
        icon={<CalendarDays size={18} className="text-blue-600" />}
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
        actions={
          <>
            {isRefreshing && !isInitialLoading && (
              <span className="text-[11px] text-gray-500 mr-1">Syncing...</span>
            )}
            <button
              onClick={() => {
                if (areSidePanelsCollapsed) {
                  setIsLeftPaneCollapsed(false);
                  setIsRightPaneCollapsed(false);
                } else {
                  setIsLeftPaneCollapsed(true);
                  setIsRightPaneCollapsed(true);
                }
              }}
              className="h-8 px-3 rounded-full border border-gray-200 bg-gray-50 text-xs font-medium text-gray-700 hover:bg-gray-100 transition"
              title={areSidePanelsCollapsed ? 'Show panels' : 'Hide panels'}
            >
              {areSidePanelsCollapsed ? 'Show panels' : 'Hide panels'}
            </button>
            <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-1 shadow-sm">
              <button
                onClick={() => moveView(-1)}
                onMouseDown={(e) => e.stopPropagation()}
                className="h-8 w-8 rounded-full hover:bg-white text-gray-600 flex items-center justify-center"
                title="Previous period"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={() => jumpToToday()}
                className="h-8 px-3 rounded-full bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-semibold inline-flex items-center justify-center leading-none"
              >
                Today
              </button>
              <button
                onClick={() => moveView(1)}
                className="h-8 w-8 rounded-full hover:bg-white text-gray-600 flex items-center justify-center"
                title="Next period"
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="flex items-center rounded-full border border-gray-200 bg-gray-50 p-0.5 shadow-sm">
              {(['day', 'week', 'month'] as CalendarViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                    viewMode === mode
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {mode}
                </button>
              ))}
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
          </>
        }
      />

      {appleSyncMessage && (
        <div
          className={`px-5 py-2 text-xs text-green-700 bg-green-50 border-b border-green-100 transition-opacity duration-300 ${
            isAppleSyncMessageVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {appleSyncMessage}
        </div>
      )}
      {importMessage && (
        <div
          className={`px-5 py-2 text-xs text-blue-700 bg-blue-50 border-b border-blue-100 transition-opacity duration-300 ${
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
              className="border-r border-gray-200 p-4 overflow-auto shrink-0 bg-white"
              style={{ width: `${leftPaneWidth}px` }}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Workspace
                </p>
                <button
                  onClick={() => setIsLeftPaneCollapsed(true)}
                  className="h-7 w-7 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
                  title="Hide left panel"
                >
                  <ChevronLeft size={13} strokeWidth={2.25} />
                </button>
              </div>
              <div className="mb-5 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      Month
                    </p>
                    <h2 className="text-sm font-semibold text-gray-900">{monthPreview.label}</h2>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveView(-1)}
                      className="h-7 w-7 rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 flex items-center justify-center shadow-sm"
                      title="Previous period"
                    >
                      <ChevronLeft size={13} strokeWidth={2.25} />
                    </button>
                    <button
                      onClick={() => jumpToToday()}
                      className="h-7 px-2 rounded-md border border-gray-200 bg-white text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Today
                    </button>
                    <button
                      onClick={() => moveView(1)}
                      className="h-7 w-7 rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 flex items-center justify-center shadow-sm"
                      title="Next period"
                    >
                      <ChevronRight size={13} strokeWidth={2.25} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-1 text-[10px] font-medium text-gray-400 mb-2">
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
                            ? 'bg-gray-900 text-white'
                            : isToday
                            ? 'bg-blue-50 text-blue-700'
                            : inMonth
                            ? 'text-gray-700 hover:bg-white'
                            : 'text-gray-300 hover:bg-white'
                        }`}
                      >
                        {dayDate.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mb-5">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Overview
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      Events
                    </p>
                    <p className="text-xl font-semibold text-gray-900 leading-tight">
                      {overviewEventCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      Reminders
                    </p>
                    <p className="text-xl font-semibold text-gray-900 leading-tight">
                      {overviewReminderCount}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mb-5 border-t border-gray-100 pt-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Calendars
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setNewCalendarName('');
                      setNewCalendarColor('#3B82F6');
                      setIsNewCalendarModalOpen(true);
                    }}
                    className="h-6 w-6 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
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
                          ? 'border-gray-100 bg-gray-50 text-gray-400'
                          : 'border-transparent text-gray-800 hover:bg-gray-50'
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
                            className="truncate font-medium bg-white border border-gray-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <span
                            className="truncate font-medium cursor-pointer hover:bg-gray-100 rounded px-1 py-0.5"
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
                    <p className="text-xs text-gray-500">No calendars yet.</p>
                  )}
                </div>
              </div>

              <div className="mb-5 border-t border-gray-100 pt-4">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Quick Actions
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      openComposerAtSlot(formatDateKey(viewAnchor), 9, '', 'event');
                    }}
                    className="h-9 rounded-md bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 transition"
                  >
                    New Event
                  </button>
                  <button
                    onClick={() => {
                      openComposerAtSlot(formatDateKey(viewAnchor), 9, '', 'reminder');
                    }}
                    className="h-9 rounded-md bg-gray-100 text-gray-800 text-xs font-medium hover:bg-gray-200 transition"
                  >
                    New Reminder
                  </button>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    disabled={isImportingIcs}
                    className="h-9 rounded-md border border-gray-200 bg-white text-gray-700 text-xs font-medium hover:bg-gray-50 transition disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
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
                    className="h-9 rounded-md border border-gray-200 bg-white text-gray-700 text-xs font-medium hover:bg-gray-50 transition"
                  >
                    Sync iCal
                  </button>
                </div>
              </div>

              {error && <p className="text-xs text-red-600 mt-4">{error}</p>}
            </aside>

            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={(event) => {
                event.preventDefault();
                setIsResizingSidebar(true);
              }}
              className={`w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-gray-200 transition-colors ${
                isResizingSidebar ? 'bg-gray-300' : ''
              }`}
              title="Drag to resize sidebar"
            />
          </>
        ) : (
          <div className="w-10 shrink-0 border-r border-gray-200 bg-white flex items-start justify-center pt-4">
            <button
              onClick={() => setIsLeftPaneCollapsed(false)}
              className="h-8 w-8 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
              title="Show left panel"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        <section className="flex-1 min-w-0 p-2.5">
          <div className="h-full rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
            <div
              ref={centerScrollRef}
              className="flex-1 min-w-0 overflow-auto"
                onWheel={(event) => {
                  const container = centerScrollRef.current;
                  if (!container) return;

                  const hasHorizontalOverflow = container.scrollWidth > container.clientWidth;
                  if (!hasHorizontalOverflow) return;

                  const delta =
                    Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
                  if (delta === 0) return;

                  // Avoid calling preventDefault here to prevent passive event listener warnings.
                  container.scrollLeft += delta;
                }}
            >
              {isInitialLoading ? (
                loadingSkeleton
              ) : viewMode === 'month' ? (
                <div className="min-w-210 p-3">
                  <div className="grid grid-cols-7 border-l border-t border-gray-200 rounded-t-lg overflow-hidden">
                    {days.map((day) => (
                      <div
                        key={day}
                        className="h-10 flex items-center justify-center bg-gray-50 border-r border-b border-gray-200 text-xs font-semibold text-gray-600"
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
                          className={`min-h-29 border-r border-b border-gray-200 text-left p-2 align-top hover:bg-blue-50/40 transition-colors ${
                            inMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <span
                              className={`text-xs font-semibold ${
                                inMonth ? 'text-gray-900' : 'text-gray-400'
                              }`}
                            >
                              {dayDate.getDate()}
                            </span>
                            {dayEvents.length + dayReminders.length > 0 && (
                              <span className="text-[10px] text-gray-500">
                                {dayEvents.length + dayReminders.length}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 space-y-1">
                            {visibleReminders.map((reminder) => (
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
                                        ? '#F3F4F6'
                                        : `${reminder.color ?? '#F59E0B'}33`,
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
                            ))}
                            {visibleEvents.map((event) =>
                              (() => {
                                const meta = getEventStatusMeta(event.status);
                                const calendarColor = getCalendarColor(event.calendar_id);
                                const pastEvent = isPastEvent(event);
                                return (
                                  <div
                                    key={event.id}
                                    className={`text-[10px] leading-tight rounded-md px-2 py-1 truncate border shadow-sm ${
                                      meta.previewClass
                                    } ${event.status === 'done' ? 'line-through opacity-80' : ''} ${
                                      event.status === 'cancelled' ? 'opacity-65' : ''
                                    } ${pastEvent ? 'opacity-75 grayscale-[0.15]' : ''}`}
                                    style={{
                                      backgroundColor: pastEvent ? '#F3F4F6' : `${calendarColor}18`,
                                      borderColor: pastEvent ? '#E5E7EB' : `${calendarColor}44`,
                                      color: pastEvent ? '#6B7280' : '#1F2937',
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
                                      <span className="text-green-600 mr-1 inline-block align-middle text-[12px]">
                                        ✓
                                      </span>
                                    )}
                                    {pastEvent && new Date(event.start_at).getHours() === 0 &&
                                      (() => {
                                        try {
                                          console.debug('[Calendar] month-preview-past-midnight', {
                                            id: event.id,
                                            start_at: event.start_at,
                                            parsed: new Date(event.start_at).toString(),
                                          });
                                        } catch (err) {}
                                        return null;
                                      })()
                                    }
                                    {event.project_id && (
                                      <Folder
                                        size={8}
                                        className="mr-1 inline-block align-middle text-gray-500"
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
                                className="text-[10px] text-gray-500 hover:text-gray-700"
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
                  <div className="sticky top-0 z-10 h-12 bg-white border-b border-gray-200" />
                  {viewConfig.dates.map((dayDate) => (
                    <div
                      key={dayDate.toISOString()}
                      className="sticky top-0 z-10 h-12 bg-white border-b border-l border-gray-200 flex flex-col items-center justify-center"
                    >
                      <span className="text-xs font-semibold text-gray-600">
                        {dayDate.toLocaleDateString([], { weekday: 'short' })}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {dayDate.getMonth() + 1}/{dayDate.getDate()}
                      </span>
                    </div>
                  ))}

                  <div className="h-10 border-b border-gray-100 pr-3 text-[11px] text-gray-400 flex items-start justify-end pt-1.5">
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
                        className="h-10 border-b border-l border-gray-100 relative px-1 py-1 bg-gray-50/30"
                      >
                        <div className="space-y-0.5">
                          {visibleAllDayItems.map((evt) => {
                            const eventColor = getCalendarColor(evt.calendar_id);
                            const pastEvent = isPastEvent(evt);
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
                                className="text-[10px] leading-tight rounded-md px-2 py-1 truncate w-full text-left border shadow-sm"
                                style={{
                                  backgroundColor: pastEvent ? '#F3F4F6' : `${eventColor}18`,
                                  borderColor: pastEvent ? '#E5E7EB' : `${eventColor}44`,
                                  color: pastEvent ? '#6B7280' : '#1F2937',
                                }}
                              >
                                <span
                                  className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                                  style={{ backgroundColor: eventColor }}
                                />
                                {evt.status === 'done' && (
                                  <span className="text-green-600 mr-1 inline-block align-middle text-[12px]">
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
                              className="text-[10px] text-gray-500 hover:text-gray-700"
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
                            const hiddenReminders = remindersForHour.length - visibleReminders.length;
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
                              className="border-b border-gray-100 pr-3 text-[11px] text-gray-400 flex items-start justify-end pt-1.5"
                              style={{ minHeight: `${rowHeight}px` }}
                            >
                              {hour}
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
                          return startTs >= hourStart.getTime() && startTs < hourEnd.getTime();
                        });
                        const dayReminders = remindersByDay[key] ?? [];
                        const visibleItems = startingEvents.slice(0, 2);
                        const hiddenCount = startingEvents.length - visibleItems.length;
                        const remindersForHour = dayReminders.filter(
                          (reminder) => new Date(reminder.remind_at).getHours() === hourInt
                        );
                        const visibleReminders = remindersForHour.slice(0, 2);
                        const hiddenReminders = remindersForHour.length - visibleReminders.length;
                        const reminderStackHeight =
                          visibleReminders.length > 0
                            ? visibleReminders.length * 24 + (hiddenReminders > 0 ? 16 : 6)
                            : 0;
                        const isQuickAddOpen =
                          gridQuickAdd?.dateKey === key && gridQuickAdd?.hour === hourInt;

                              return (
                                <div
                                  key={`${hour}-${key}`}
                                  className="border-b border-l border-gray-100 relative px-1 py-1 hover:bg-blue-50/40 cursor-pointer"
                                  style={{ minHeight: `${rowHeight}px` }}
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
                                className="absolute top-1 left-1 right-1 z-20 rounded-md border border-gray-200 bg-white shadow-lg p-1.5"
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
                                  className="w-full h-7 px-2 text-[11px] border border-gray-200 rounded focus:outline-none focus:border-gray-400"
                                />
                                <div className="mt-1 flex justify-end gap-1">
                                  <button
                                    onClick={() => {
                                      setGridQuickAdd(null);
                                      setGridQuickTitle('');
                                    }}
                                    className="px-1.5 py-0.5 text-[10px] text-gray-600 bg-gray-100 rounded"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => void createGridEvent()}
                                    disabled={!gridQuickTitle.trim() || isSavingEvent}
                                    className="px-1.5 py-0.5 text-[10px] text-white bg-gray-900 rounded disabled:opacity-60"
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
                                    className={`relative z-40 block w-full truncate rounded-md border px-2 py-1.5 text-left text-[10px] leading-tight shadow-sm ${
                                      reminder.is_done ? 'line-through opacity-60' : ''
                                    } ${isPastReminder(reminder) ? 'opacity-80' : ''}`}
                                    style={{
                                      backgroundColor: isPastReminder(reminder) ? '#F9FAFB' : '#FFFFFF',
                                      borderColor: isPastReminder(reminder)
                                        ? '#E5E7EB'
                                        : `${reminder.color ?? '#F59E0B'}55`,
                                      color: isPastReminder(reminder) ? '#6B7280' : '#1F2937',
                                    }}
                                    title={`${new Date(reminder.remind_at).toLocaleTimeString([], {
                                      hour: 'numeric',
                                      minute: '2-digit',
                                    })} • ${reminder.title}`}
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
                                    className="relative z-40 text-[10px] font-medium text-amber-700"
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
                              const durationRows = getEventDurationRows(evt);
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
                                  className="absolute inset-x-1 z-10 overflow-hidden rounded-md border px-2 py-1.5 text-left text-[10px] leading-tight shadow-sm"
                                  style={{
                                    top: `${Math.max(8, reminderStackHeight + 6)}px`,
                                    height: `${Math.max(40, durationRows * 64 - 12)}px`,
                                    backgroundColor: pastEvent ? '#F3F4F6' : '#FFFFFF',
                                    borderColor: pastEvent ? '#E5E7EB' : `${eventColor}55`,
                                    color: pastEvent ? '#6B7280' : '#1F2937',
                                    boxSizing: 'border-box',
                                    lineHeight: 1.2,
                                    boxShadow: pastEvent
                                      ? 'none'
                                      : `0 0 0 1px ${eventColor}12, 0 1px 2px rgba(15, 23, 42, 0.04)`,
                                  }}
                                >
                                  <div className="flex h-full items-start gap-1.5 min-w-0">
                                    <span
                                      className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                                      style={{ backgroundColor: eventColor }}
                                    />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-start gap-1 min-w-0">
                                        {evt.status === 'done' && (
                                          <span className="mt-0.5 text-green-600 shrink-0 text-[12px] leading-none">
                                            ✓
                                          </span>
                                        )}
                                        {evt.project_id && (
                                          <Folder
                                            size={8}
                                            className="mt-0.5 shrink-0 text-gray-500"
                                          />
                                        )}
                                        <span className="min-w-0 truncate font-medium">{evt.title}</span>
                                      </div>
                                      {durationRows > 1 && (
                                        <div className="mt-0.5 text-[9px] text-gray-500">
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
                                className="relative z-30 text-[10px] text-gray-600 hover:text-gray-800 px-1.5 py-0.5"
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
              className={`w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-gray-200 transition-colors ${
                isResizingRightPane ? 'bg-gray-300' : ''
              }`}
              title="Drag to resize inspector"
            />

            <aside
              className="border-l border-gray-200 bg-[#fbfcfe] overflow-auto px-5 py-6"
              style={{ width: `${rightPaneWidth}px` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Day context
                  </p>
                  <h2 className="mt-2 text-[15px] font-semibold leading-5 text-gray-900">
                    {selectedContextDate.toLocaleDateString([], {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </h2>
                  <p className="mt-1 text-[13px] text-gray-600">
                    {selectedContextDayEventCountLabel} · {selectedContextDayReminderCountLabel}
                  </p>
                </div>
                <button
                  onClick={() => setIsRightPaneCollapsed(true)}
                  className="h-7 w-7 shrink-0 rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-100 flex items-center justify-center"
                  title="Hide right panel"
                  aria-label="Hide right panel"
                >
                  <ChevronRight size={13} strokeWidth={2.25} />
                </button>
              </div>

              <div className="mt-6 space-y-6">
                <div className="space-y-2 border-t border-gray-100 pt-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
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
                            <div className="min-w-0">
                              <p className="text-[14px] font-semibold leading-5 text-gray-900">
                                {selectedEventPreview.title}
                              </p>
                              <p className="mt-1 text-[13px] text-gray-600">
                                {formatEventDateTimeLabel(selectedEventPreview)}
                              </p>
                              <p className="mt-1 text-[13px] text-gray-700">{meta.label}</p>
                              <div className="mt-3 space-y-2 text-[13px]">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-gray-500">Project</span>
                                  {selectedEventProject ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void window.desktopWindow?.toggleModule('projects', {
                                          focusProjectId: selectedEventProject.id,
                                        })
                                      }
                                      className="truncate font-medium text-gray-700 hover:text-[#FF5F40]"
                                    >
                                      {selectedEventProject.name} →
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void (selectedEventPreview ? openLinkProjectModal() : null)
                                      }
                                      className="font-medium text-gray-500 hover:text-[#FF5F40]"
                                    >
                                      + Link project
                                    </button>
                                  )}
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-gray-500">Linked note</span>
                                  {selectedEventNote ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void window.desktopWindow?.toggleModule('notes', {
                                          focusNoteId: selectedEventNote.id,
                                        })
                                      }
                                      className="max-w-36 truncate font-medium text-gray-700 hover:text-[#FF5F40]"
                                    >
                                      {selectedEventNote.title} →
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => void openLinkNoteModal()}
                                      className="font-medium text-gray-500 hover:text-[#FF5F40]"
                                    >
                                      + Link note
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="mt-1">
                            {canEditEvent(selectedEventPreview) && (
                              <button
                                onClick={() => openEventEditor(selectedEventPreview)}
                                className="w-full text-left text-[13px] font-medium text-gray-700 hover:text-[#FF5F40]"
                              >
                                Edit event
                              </button>
                            )}
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
                          <p className="text-[14px] font-semibold leading-5 text-gray-900">
                            {selectedReminder.title}
                          </p>
                          <p className="mt-1 text-[13px] text-gray-600">
                            {new Date(selectedReminder.remind_at).toLocaleString([], {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </p>
                          <p className="mt-1 text-[13px] text-gray-700">Reminder context</p>
                          <div className="mt-3 space-y-2 text-[13px]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-gray-500">Project</span>
                              {selectedReminderProject ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void window.desktopWindow?.toggleModule('projects', {
                                      focusProjectId: selectedReminderProject.id,
                                    })
                                  }
                                  className="truncate font-medium text-gray-700 hover:text-[#FF5F40]"
                                >
                                  {selectedReminderProject.name} →
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void openLinkProjectModal()}
                                  className="font-medium text-gray-500 hover:text-[#FF5F40]"
                                >
                                  + Link project
                                </button>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-gray-500">Linked note</span>
                              {selectedReminderNote ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void window.desktopWindow?.toggleModule('notes', {
                                      focusNoteId: selectedReminderNote.id,
                                    })
                                  }
                                  className="truncate font-medium text-gray-700 hover:text-[#FF5F40]"
                                >
                                  {selectedReminderNote.title} →
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void openLinkNoteModal()}
                                  className="font-medium text-gray-500 hover:text-[#FF5F40]"
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
                          className="w-full text-left text-[13px] font-medium text-gray-700 hover:text-[#FF5F40]"
                        >
                          Open reminder
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[14px] text-gray-500">
                      Select an event or reminder to view context.
                    </p>
                  )}
                </div>

                <div className="space-y-2 border-t border-gray-100 pt-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Event notes
                  </p>
                  <textarea
                    value={selectedEventPreview ? selectedEventNoteDraft : ''}
                    onChange={(e) => {
                      if (!selectedEventPreview) return;
                      const nextValue = e.target.value;
                      setEventNotesDrafts((prev) => ({
                        ...prev,
                        [selectedEventPreview.id]: nextValue,
                      }));
                    }}
                    disabled={!selectedEventPreview}
                    rows={2}
                    placeholder="Add notes for this event..."
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 outline-none focus:border-gray-300 disabled:cursor-not-allowed disabled:opacity-70"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] text-gray-500">Saved to the event.</p>
                    <button
                      type="button"
                      onClick={() => void saveSelectedEventNotes()}
                      disabled={!selectedEventPreview}
                      className={`text-[12px] font-medium ${
                        selectedEventPreview
                          ? 'text-gray-600 hover:text-gray-900'
                          : 'text-gray-300 cursor-not-allowed'
                      }`}
                    >
                      Save notes
                    </button>
                  </div>
                </div>

                <div className="space-y-2 border-t border-gray-100 pt-6">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      Follow-ups
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        selectedEventPreview &&
                        window.desktopWindow?.toggleModule('quick-task' as any, {
                          focusContext: selectedEventPreview
                            ? `ledger-followup|${baseEventId(
                                selectedEventPreview.id
                              )}|${encodeURIComponent(selectedEventPreview.title)}|${
                                selectedEventPreview.project_id ?? ''
                              }|${selectedEventPreview.note_id ?? ''}`
                            : 'Follow-up from Calendar',
                        })
                      }
                      disabled={!selectedEventPreview}
                      className={`inline-flex items-center gap-0.5 text-[12px] font-medium ${
                        selectedEventPreview
                          ? 'text-gray-600 hover:text-[#FF5F40]'
                          : 'cursor-not-allowed text-gray-300'
                      }`}
                    >
                      <span>+ </span>
                      <span>Add</span>
                    </button>
                  </div>
                  {selectedEventPreview ? (
                    selectedEventFollowUps.length > 0 ? (
                      <div className="space-y-1">
                        {selectedEventFollowUps.map((task) => (
                          <button
                            key={task.id}
                            onClick={() =>
                              void window.desktopWindow?.toggleModule('dashboard', {
                                focusTaskId: task.id,
                              })
                            }
                            className="flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-[13px] hover:bg-gray-50"
                            title={task.title}
                          >
                            <span className="min-w-0 truncate text-gray-800">{task.title}</span>
                            <span className="shrink-0 text-[12px] text-gray-500">
                              {task.status === 'done' ? 'Done' : 'Todo'}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[14px] text-gray-500">No follow-ups yet.</p>
                    )
                  ) : (
                    <p className="text-[14px] text-gray-500">Select an event to view follow-ups.</p>
                  )}
                </div>

                <div className="space-y-2 border-t border-gray-100 pt-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Agenda
                  </p>
                  <div className="space-y-1">
                    {selectedContextDayEvents.length === 0 ? (
                      <p className="text-[14px] text-gray-500">No events for this day.</p>
                    ) : (
                      selectedContextDayEvents.map((event) => {
                        const isSelected = selectedEventPreview?.id === event.id;
                        const eventColor = getCalendarColor(event.calendar_id);
                        return (
                          <button
                            key={event.id}
                            onClick={() => setSelectedEvent(event)}
                            className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition ${
                              isSelected ? 'bg-gray-50 ring-1 ring-gray-200' : 'hover:bg-gray-50'
                            }`}
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: isPastEvent(event) ? '#9CA3AF' : eventColor }}
                            />
                            <p className="w-28 shrink-0 whitespace-nowrap text-[12px] font-medium text-gray-900">
                              {formatEventTimeLabel(event)}
                            </p>
                            <p className={`min-w-0 flex-1 truncate text-[13px] ${isPastEvent(event) ? 'text-gray-500' : 'text-gray-700'}`}>
                              {event.title}
                            </p>
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
          <div className="w-10 shrink-0 border-l border-gray-200 bg-[#fbfcfe] flex items-start justify-center pt-4">
            <button
              onClick={() => setIsRightPaneCollapsed(false)}
              className="h-8 w-8 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center shadow-sm"
              title="Show right panel"
            >
              <ChevronLeft size={13} strokeWidth={2.25} />
            </button>
          </div>
        )}
      </div>

      {isComposerOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-100 bg-black/20 flex items-start justify-center pt-20"
            onClick={() => setIsComposerOpen(false)}
          >
          <div
            className="w-105 rounded-xl border border-gray-200 bg-white shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {composerMode === 'reminder' ? 'New Reminder' : 'New Event'}
              </h3>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setIsComposerOpen(false);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-1 rounded hover:bg-gray-100"
              >
                <X size={14} className="text-gray-600" />
              </button>
            </div>
            <div className="space-y-2.5">
              <input
                value={newEventTitle}
                onChange={(e) => setNewEventTitle(e.target.value)}
                placeholder={composerMode === 'reminder' ? 'Reminder title' : 'Event title'}
                className="w-full h-9 px-3 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={newEventDate}
                  onChange={(e) => setNewEventDate(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
                <input
                  type="time"
                  value={newEventTime}
                  onChange={(e) => setNewEventTime(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
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
                    className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                  />
                  <div className="relative">
                    <select
                      value={newEventDurationUnit}
                      onChange={(e) =>
                        setNewEventDurationUnit(e.target.value as 'minutes' | 'hours')
                      }
                      className="w-full h-9 pr-8 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
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
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
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
              <div className="relative">
                <select
                  value={composerProjectId}
                  onChange={(e) => setComposerProjectId(e.target.value)}
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
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
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
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
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:border-gray-400"
              />
              {composerMode === 'event' && (
                <div className="relative">
                  <select
                    value={newEventRecurrence}
                    onChange={(e) =>
                      setNewEventRecurrence(
                        e.target.value as 'none' | 'daily' | 'weekly' | 'weekdays'
                      )
                    }
                    className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
                  >
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="weekdays">Weekdays</option>
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                  />
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setIsComposerOpen(false)}
                className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={() => void createQuickEvent()}
                disabled={isSavingEvent || !newEventTitle.trim() || calendars.length === 0}
                className="px-3 py-2 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
              >
                {isSavingEvent
                  ? 'Saving...'
                  : composerMode === 'reminder'
                  ? 'Create Reminder'
                  : 'Create'}
              </button>
            </div>
          </div>
          </div>,
          document.body
        )}

      {isNewCalendarModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-105 bg-black/20 flex items-start justify-center pt-24"
            onClick={() => setIsNewCalendarModalOpen(false)}
          >
          <div
            className="w-96 rounded-xl border border-gray-200 bg-white shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">New Calendar</h3>
              <button
                onClick={() => setIsNewCalendarModalOpen(false)}
                className="p-1 rounded hover:bg-gray-100"
              >
                <X size={14} className="text-gray-600" />
              </button>
            </div>
            <div className="space-y-2.5">
              <input
                value={newCalendarName}
                onChange={(e) => setNewCalendarName(e.target.value)}
                placeholder="Calendar name"
                className="w-full h-9 px-3 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
              />
              <label className="flex items-center justify-between border border-gray-200 rounded-md px-2.5 h-9">
                <span className="text-sm text-gray-700">Color</span>
                <input
                  type="color"
                  value={newCalendarColor}
                  onChange={(e) => setNewCalendarColor(e.target.value)}
                  className="h-6 w-8 p-0 border-0 bg-transparent cursor-pointer"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setIsNewCalendarModalOpen(false)}
                className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={() => void createNewCalendar()}
                disabled={isCreatingCalendar || !newCalendarName.trim()}
                className="px-3 py-2 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
              >
                {isCreatingCalendar ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
          </div>,
          document.body
        )}

      <ModalOverlay
        isOpen={isLinkProjectModalOpen}
        onClose={() => setIsLinkProjectModalOpen(false)}
        classNameContainer="w-full max-w-xl rounded-2xl border border-gray-200 bg-white shadow-xl"
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
            Link project
          </p>
          <p className="mt-1 text-base font-semibold text-gray-900">
            Attach this event to a project
          </p>
        </div>
        <div className="space-y-3 p-5">
          <input
            type="text"
            value={linkProjectsSearch}
            onChange={(e) => setLinkProjectsSearch(e.target.value)}
            placeholder="Search projects"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-300"
          />
          <div className="max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white">
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
                    className="w-full border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <p className="truncate text-sm font-medium text-gray-900">{project.name}</p>
                  </button>
                ))
            )}
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={() => setIsLinkProjectModalOpen(false)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </ModalOverlay>

      <ModalOverlay
        isOpen={isLinkNoteModalOpen}
        onClose={() => setIsLinkNoteModalOpen(false)}
        classNameContainer="w-full max-w-xl rounded-2xl border border-gray-200 bg-white shadow-xl"
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
            Link note
          </p>
          <p className="mt-1 text-base font-semibold text-gray-900">
            Attach this event to a note
          </p>
        </div>
        <div className="space-y-3 p-5">
          <input
            type="text"
            value={linkNotesSearch}
            onChange={(e) => setLinkNotesSearch(e.target.value)}
            placeholder="Search notes"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-300"
          />
          <div className="max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white">
            {isLoadingLinkNotes ? (
              <p className="p-3 text-sm text-gray-500">Loading notes…</p>
            ) : linkNotes.filter((note) =>
                note.title.toLowerCase().includes(linkNotesSearch.toLowerCase())
              ).length === 0 ? (
              <p className="p-3 text-sm text-gray-500">No notes found.</p>
            ) : (
              linkNotes
                .filter((note) =>
                  note.title.toLowerCase().includes(linkNotesSearch.toLowerCase())
                )
                .map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    disabled={isLinkingNote}
                    onClick={() => void linkEventToNote(note.id)}
                    className="w-full border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <p className="truncate text-sm font-medium text-gray-900">{note.title}</p>
                  </button>
                ))
            )}
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={() => setIsLinkNoteModalOpen(false)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </ModalOverlay>

      {eventEditorEvent &&
        createPortal(
          <div
            className="fixed inset-0 z-110 bg-black/20 flex items-start justify-center pt-20"
            onClick={() => {
              setEventEditorEvent(null);
              setConfirmDelete(false);
            }}
          >
          <div
            className="w-110 rounded-xl border border-gray-200 bg-white shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Edit Event</h3>
              <button
                onClick={() => {
                  setEventEditorEvent(null);
                  setConfirmDelete(false);
                }}
                className="p-1 rounded hover:bg-gray-100"
              >
                <X size={14} className="text-gray-600" />
              </button>
            </div>

            <div className="space-y-2.5">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Event title"
                className="w-full h-9 px-3 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
                <input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
              </div>
              <div className="grid grid-cols-[1fr_92px] gap-2">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={editDurationValue}
                  onChange={(e) => setEditDurationValue(Number(e.target.value) || 1)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
                <div className="relative">
                  <select
                    value={editDurationUnit}
                    onChange={(e) => setEditDurationUnit(e.target.value as 'minutes' | 'hours')}
                    className="w-full h-9 pr-8 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
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
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
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
                  value={editProjectId}
                  onChange={(e) => setEditProjectId(e.target.value)}
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
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
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
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
                    setEditRecurrence(e.target.value as 'none' | 'daily' | 'weekly' | 'weekdays')
                  }
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
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
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
                >
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
                </select>
                <span
                  className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border border-gray-200"
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
                    className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md"
                  >
                    Delete
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-2 text-xs text-gray-700 bg-gray-100 rounded-md"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void deleteEvent()}
                      disabled={isDeletingEvent}
                      className="px-2.5 py-2 text-xs text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-60"
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
                  className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Close
                </button>
                <button
                  onClick={() => void saveEventEdits()}
                  disabled={isSavingEdit || !editTitle.trim()}
                  className="px-3 py-2 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
                >
                  {isSavingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
          </div>,
          document.body
        )}

      {selectedReminder &&
        createPortal(
          <div
            className="fixed inset-0 z-112 bg-black/20 flex items-start justify-center pt-20"
            onClick={() => setSelectedReminder(null)}
          >
          <div
            className="w-110 rounded-xl border border-gray-200 bg-white shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Edit Reminder</h3>
              <button
                onClick={() => setSelectedReminder(null)}
                className="p-1 rounded hover:bg-gray-100"
              >
                <X size={14} className="text-gray-600" />
              </button>
            </div>

            <div className="space-y-2.5">
              <input
                value={reminderEditTitle}
                onChange={(e) => setReminderEditTitle(e.target.value)}
                placeholder="Reminder title"
                className="w-full h-9 px-3 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={reminderEditDate}
                  onChange={(e) => setReminderEditDate(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
                <input
                  type="time"
                  value={reminderEditTime}
                  onChange={(e) => setReminderEditTime(e.target.value)}
                  className="h-9 px-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
                />
              </div>
              <label className="flex items-center justify-between border border-gray-200 rounded-md px-2.5 h-9">
                <span className="text-sm text-gray-700">Done</span>
                <input
                  type="checkbox"
                  checked={reminderEditDone}
                  onChange={(e) => setReminderEditDone(e.target.checked)}
                />
              </label>
              <div className="relative">
                <select
                  value={reminderEditCalendarId}
                  onChange={(e) => setReminderEditCalendarId(e.target.value)}
                  className="w-full h-9 pr-9 pl-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white appearance-none"
                >
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
                </select>
                <span
                  className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border border-gray-200"
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
                className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md disabled:opacity-60"
              >
                {isDeletingReminder ? 'Deleting...' : 'Delete'}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedReminder(null)}
                  className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Close
                </button>
                <button
                  onClick={() => void saveReminderEdits()}
                  disabled={isSavingEdit || !reminderEditTitle.trim()}
                  className="px-3 py-2 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md disabled:opacity-60"
                >
                  {isSavingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
          </div>,
          document.body
        )}

      {overflowDayKey &&
        createPortal(
          <div
            className="fixed inset-0 z-111 bg-black/20 flex items-start justify-center pt-20"
            onClick={() => setOverflowDayKey(null)}
          >
          <div
            className="w-130 max-h-[72vh] rounded-xl border border-gray-200 bg-white shadow-xl p-4 overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {parseDateKey(overflowDayKey).toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </h3>
              <button
                onClick={() => setOverflowDayKey(null)}
                className="p-1 rounded hover:bg-gray-100"
              >
                <X size={14} className="text-gray-600" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                  Reminders
                </p>
                <div className="space-y-1.5">
                  {overflowReminders.length === 0 && (
                    <p className="text-xs text-gray-500">No reminders.</p>
                  )}
                  {overflowReminders.map((reminder) => (
                    <button
                      key={reminder.id}
                      onClick={() => openReminderEditor(reminder)}
                      className="w-full text-left rounded-md border border-amber-100 bg-amber-50 px-2.5 py-2 text-xs text-gray-800"
                    >
                      <span className="font-medium">{reminder.title}</span>
                      <span className="ml-2 text-gray-600">
                        {new Date(reminder.remind_at).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                  Events
                </p>
                <div className="space-y-1.5">
                  {overflowEvents.length === 0 && (
                    <p className="text-xs text-gray-500">No events.</p>
                  )}
                  {overflowEvents.map((event) => (
                    <button
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className={`w-full text-left rounded-md border px-2.5 py-2 text-xs text-gray-800 ${
                        selectedEventPreview?.id === event.id
                          ? 'border-gray-400 bg-gray-100'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                      >
                      <span className="font-medium">{event.title}</span>
                      <span className="ml-2 text-gray-600">
                        {formatEventTimeLabel(event)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </div>,
          document.body
        )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
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
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <CalendarPlus size={14} className="shrink-0 text-gray-500" />
            <span className="text-[14px] font-medium tracking-tight">New Event</span>
          </button>
          <button
            onClick={() => {
              openComposerAtSlot(contextMenu.dateKey, contextMenu.hour, 'Reminder', 'reminder');
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <BellRing size={14} className="shrink-0 text-gray-500" />
            <span className="text-[14px] font-medium tracking-tight">New Reminder</span>
          </button>
          <button
            disabled
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-400 cursor-not-allowed"
          >
            <ClipboardPaste size={14} className="shrink-0 text-gray-400" />
            <span className="text-[14px] font-medium tracking-tight">Paste Event</span>
          </button>
        </div>
      )}

      {calendarRowContextMenu && (
        <div
          className="fixed z-50 min-w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          style={{
            left: Math.max(8, Math.min(calendarRowContextMenu.x, window.innerWidth - 192)),
            top: Math.max(8, Math.min(calendarRowContextMenu.y, window.innerHeight - 176)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const calendar = calendars.find((item) => item.id === calendarRowContextMenu.calendarId);
              if (calendar) {
                setEditingCalendarId(calendar.id);
                setEditingCalendarName(calendar.name);
              }
              setCalendarRowContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <PencilLine size={14} className="shrink-0 text-gray-500" />
            <span className="text-[14px] font-medium tracking-tight">Rename</span>
          </button>
          <button
            onClick={() => {
              const calendar = calendars.find((item) => item.id === calendarRowContextMenu.calendarId);
              if (calendar) {
                void toggleCalendarVisibility(calendar);
              }
              setCalendarRowContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            {calendars.find((item) => item.id === calendarRowContextMenu.calendarId)?.is_visible ===
            false ? (
              <Eye size={14} className="shrink-0 text-gray-500" />
            ) : (
              <EyeOff size={14} className="shrink-0 text-gray-500" />
            )}
            <span className="text-[14px] font-medium tracking-tight">
              {calendars.find((item) => item.id === calendarRowContextMenu.calendarId)?.is_visible ===
              false
                ? 'Show'
                : 'Hide'}
            </span>
          </button>
          <button
            onClick={() => {
              const calendar = calendars.find((item) => item.id === calendarRowContextMenu.calendarId);
              if (calendar) {
                setCalendarColorMenu({
                    x: Math.max(
                      8,
                      Math.min(calendarRowContextMenu.x, window.innerWidth - 264)
                    ),
                    y: Math.max(8, Math.min(calendarRowContextMenu.y + 12, window.innerHeight - 180)),
                  calendarId: calendar.id,
                });
              }
              setCalendarRowContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            <Palette size={14} className="shrink-0 text-gray-500" />
            <span className="text-[14px] font-medium tracking-tight">Change color</span>
          </button>
          <button
            onClick={() => {
              const calendar = calendars.find((item) => item.id === calendarRowContextMenu.calendarId);
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
          className="fixed z-50 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white p-3 shadow-xl"
          style={{
            left: Math.max(8, Math.min(calendarColorMenu.x, window.innerWidth - 264)),
            top: Math.max(8, Math.min(calendarColorMenu.y, window.innerHeight - 180)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Calendar Color
            </p>
            <button
              type="button"
              onClick={() => setCalendarColorMenu(null)}
              className="h-6 w-6 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center"
              title="Close"
            >
              <X size={12} />
            </button>
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
                    const target = calendars.find((item) => item.id === calendarColorMenu.calendarId);
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

      {listContextMenu && (
        <div
          className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          style={{
            left: Math.max(8, Math.min(listContextMenu.x, window.innerWidth - 168)),
            top: Math.max(8, Math.min(listContextMenu.y, window.innerHeight - 74)),
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {listContextMenu.kind === 'event' ? (
            (() => {
              const event = events.find((item) => item.id === baseEventId(listContextMenu.id));
              const canEditMenuEvent = Boolean(event && canEditEvent(event));

              return (
                <button
                  onClick={() => {
                    if (!canEditMenuEvent || !event) return;
                    openEventEditor(event);
                    setListContextMenu(null);
                  }}
                  disabled={!canEditMenuEvent}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                    canEditMenuEvent
                      ? 'text-gray-700 hover:bg-gray-50'
                      : 'cursor-not-allowed text-gray-300'
                  }`}
                  title={canEditMenuEvent ? 'Edit Event' : 'Past events are read-only here'}
                >
                  <CalendarPlus size={14} className="shrink-0 text-gray-500" />
                  <span className="text-[14px] font-medium tracking-tight">Edit Event</span>
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
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <CalendarPlus size={14} className="shrink-0 text-gray-500" />
              <span className="text-[14px] font-medium tracking-tight">Edit Reminder</span>
            </button>
          )}
          {listContextMenu.kind === 'event' ? (
            <button
              onClick={() => {
                const event = events.find((item) => item.id === baseEventId(listContextMenu.id));
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
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <BellRing size={14} className="shrink-0 text-gray-500" />
              <span className="text-[14px] font-medium tracking-tight">
                Mark{' '}
                {events.find((item) => item.id === baseEventId(listContextMenu.id))?.status ===
                'done'
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
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <BellRing size={14} className="shrink-0 text-gray-500" />
              <span className="text-[14px] font-medium tracking-tight">Toggle Done</span>
            </button>
          )}
          <button
            onClick={() => {
              if (listContextMenu.kind === 'event') {
                void quickDeleteEvent(listContextMenu.id);
              } else {
                void quickDeleteReminder(listContextMenu.id);
              }
              setListContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} className="shrink-0 text-red-500" />
            <span className="text-[14px] font-medium tracking-tight">
              Delete {listContextMenu.kind === 'event' ? 'Event' : 'Reminder'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

export default CalendarWindow;
