import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, CalendarDays, CircleX } from 'lucide-react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalTextEntity } from '@lexical/react/useLexicalTextEntity';
import { $getNodeByKey, $getRoot, HISTORIC_TAG, type Klass, type NodeKey, TextNode } from 'lexical';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';
import { ModalOverlay } from '../Common/ModalOverlay';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import {
  findSentenceContainingRange,
  findSmartDateMatch,
  formatSmartDateKey,
  formatSmartDateResolution,
  stripPhraseFromSentence,
} from './smartDateUtils';
import {
  $createSmartDateNode,
  $isSmartDateNode,
  type SmartDateNodeState,
  SmartDateNode,
} from './nodes/SmartDateNode';
import { $isSmartPersonNode } from './nodes/SmartPersonNode';

type SmartLinkRow = {
  id: string;
  source_key: string;
  source_text: string;
  source_start_offset?: number | null;
  source_end_offset?: number | null;
  linked_event_id?: string | null;
  linked_reminder_id?: string | null;
  dismissed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SmartDateTarget = {
  key: string;
  text: string;
  resolvedDate: Date;
  hasExplicitTime: boolean;
  sourceText: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  title: string;
  noteId: string;
  noteTitle: string;
  noteProjectId?: string | null;
  linkedEventId?: string | null;
  linkedReminderId?: string | null;
  state: SmartDateNodeState;
};

type SmartDateCalendar = {
  id: string;
  name: string;
  color?: string | null;
};

const SCAN_DEBOUNCE_MS = 220;
const SMART_DATE_SCAN_TAG = 'smart-date-scan';
const SMART_DATE_SYNC_TAG = 'smart-date-sync';
const SMART_DATE_LOAD_TAG = 'smart-date-load';
const DEFAULT_REMINDER_TIME = '09:00';

const isTextNodeEligible = (node: TextNode) => {
  if (!node.isSimpleText()) return false;
  if (node.hasFormat('code')) return false;
  if (node instanceof SmartDateNode || $isSmartPersonNode(node)) return false;

  let current = node.getParent();
  while (current) {
    if (current instanceof LinkNode || current instanceof CodeNode) return false;
    current = current.getParent();
  }
  return true;
};

const getSmartDateStateFromRow = (row: SmartLinkRow | null | undefined): SmartDateNodeState => {
  if (!row) return 'detected';
  if (row.dismissed_at) return 'dismissed';
  if (row.linked_event_id) return 'linked-event';
  if (row.linked_reminder_id) return 'linked-reminder';
  return 'detected';
};

const makeSourceKey = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `smart-date-${Math.random().toString(36).slice(2)}-${Date.now()}`;
};

const getSmartDateElementFromEvent = (event: Event) => {
  const target = event.target as Node | null;
  if (!target) return null;

  if (target instanceof Element) {
    return target.closest?.('[data-ledger-smart-date-key]') as HTMLElement | null;
  }

  if (target.parentElement) {
    return target.parentElement.closest?.('[data-ledger-smart-date-key]') as HTMLElement | null;
  }

  const path = event.composedPath?.() ?? [];
  for (const item of path) {
    if (item instanceof HTMLElement) {
      const match = item.closest?.('[data-ledger-smart-date-key]') as HTMLElement | null;
      if (match) return match;
    }
  }

  return null;
};

const collectEligibleTextKeys = () => {
  const keys = new Set<NodeKey>();
  const root = $getRoot();

  const visit = (node: any) => {
    if (!node) return;
    if (node instanceof TextNode) {
      if (isTextNodeEligible(node)) keys.add(node.getKey());
      return;
    }
    if (node.getChildren) {
      for (const child of node.getChildren()) {
        visit(child);
      }
    }
  };

  for (const child of root.getChildren()) {
    visit(child);
  }

  return keys;
};

const SmartDatePopover = ({
  target,
  onClose,
  onCreateEvent,
  onCreateReminder,
  onOpenEvent,
  onOpenReminder,
}: {
  target: SmartDateTarget;
  onClose: () => void;
  onCreateEvent: () => void;
  onCreateReminder: () => void;
  onOpenEvent: () => void;
  onOpenReminder: () => void;
}) => {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const updatePosition = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-ledger-smart-date-key="${target.key}"]`
      );
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = 264;
      const estimatedHeight = 190;
      const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
      const belowTop = rect.bottom + 10;
      const aboveTop = rect.top - estimatedHeight - 10;
      const top =
        belowTop + estimatedHeight <= window.innerHeight - 12 ? belowTop : Math.max(12, aboveTop);
      setPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [target.key]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!position) return null;

  const hasLinkedEvent = Boolean(target.linkedEventId);
  const hasLinkedReminder = Boolean(target.linkedReminderId);
  const showCreateActions = !hasLinkedEvent && !hasLinkedReminder;

  return createPortal(
    <div
      role="dialog"
      aria-label={`Date detected: ${target.text}`}
      data-ledger-smart-date-popover="true"
      className="fixed z-[9999] max-h-[calc(100vh-24px)] w-[264px] overflow-y-auto rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1.5 text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)] backdrop-blur-sm"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2 px-2 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-[11px] text-[var(--ledger-text-muted)]">Date detected</p>
          <p className="mt-0.5 truncate text-[13px] font-medium leading-5 text-[var(--ledger-text-primary)]">
            {target.text}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          aria-label="Close"
        >
          <CircleX size={13} />
        </button>
      </div>

      <div className="mb-1 flex items-center justify-between gap-3 border-y border-[color:var(--ledger-border-subtle)] px-2 py-1.5">
        <span className="text-[11px] text-[var(--ledger-text-muted)]">When</span>
        <span className="truncate text-right text-[12px] font-medium text-[var(--ledger-text-secondary)]">
          {formatSmartDateResolution(target.resolvedDate, target.hasExplicitTime)}
        </span>
      </div>

      {showCreateActions ? (
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={onCreateEvent}
            className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <CalendarDays size={13} className="text-[var(--ledger-accent)]" />
            Create event
          </button>
          <button
            type="button"
            onClick={onCreateReminder}
            className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          >
            <BellRing size={13} className="text-[var(--ledger-accent)]" />
            Create reminder
          </button>
        </div>
      ) : (
        <div className="space-y-0.5">
          {hasLinkedEvent ? (
            <button
              type="button"
              onClick={onOpenEvent}
              className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              <CalendarDays size={13} className="text-[var(--ledger-accent)]" />
              Open event
            </button>
          ) : null}
          {hasLinkedReminder ? (
            <button
              type="button"
              onClick={onOpenReminder}
              className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
            >
              <BellRing size={13} className="text-[var(--ledger-accent)]" />
              Open reminder
            </button>
          ) : null}
        </div>
      )}
    </div>,
    document.body
  );
};

type SmartDateComposerValues = {
  title: string;
  date: string;
  time: string;
  allDay: boolean;
  calendarId: string;
};

const SmartDateComposer = ({
  mode,
  target,
  calendars,
  values,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  mode: 'event' | 'reminder';
  target: SmartDateTarget;
  calendars: SmartDateCalendar[];
  values: SmartDateComposerValues;
  isSaving: boolean;
  onChange: (update: Partial<SmartDateComposerValues>) => void;
  onClose: () => void;
  onSave: () => void;
}) => (
  <ModalOverlay
    isOpen
    onClose={onClose}
    closeOnBackdropClick={!isSaving}
    backdropBorderRadius="inherit"
    disablePortal
    manageWindowChrome={false}
    classNameContainer="w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-[var(--ledger-shadow)]"
  >
    <div className="border-b border-[color:var(--ledger-border-subtle)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--ledger-text-primary)]">
            {mode === 'event' ? 'New event' : 'New reminder'}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--ledger-text-muted)]">
            From “{target.text}”
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          aria-label="Close composer"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-50"
        >
          <CircleX size={14} />
        </button>
      </div>
    </div>

    <div className="space-y-2.5 p-4">
      <input
        autoFocus
        value={values.title}
        onChange={(event) => onChange({ title: event.target.value })}
        placeholder={mode === 'event' ? 'Event title' : 'Reminder title'}
        className="h-9 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none placeholder:text-[var(--ledger-text-muted)] focus:border-[color:var(--ledger-border-strong)]"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={values.date}
          onChange={(event) => onChange({ date: event.target.value })}
          className="h-9 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"
        />
        <input
          type="time"
          value={values.time}
          onChange={(event) => onChange({ time: event.target.value, allDay: false })}
          disabled={mode === 'event' && values.allDay}
          className="h-9 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)] disabled:opacity-50"
        />
      </div>
      {mode === 'event' ? (
        <label className="flex items-center gap-2 text-xs text-[var(--ledger-text-secondary)]">
          <input
            type="checkbox"
            checked={values.allDay}
            onChange={(event) => onChange({ allDay: event.target.checked })}
            className="h-3.5 w-3.5 rounded border-[color:var(--ledger-border-subtle)] text-[var(--ledger-accent)] focus:ring-[var(--ledger-accent)]"
          />
          All day
        </label>
      ) : null}
      <select
        value={values.calendarId}
        onChange={(event) => onChange({ calendarId: event.target.value })}
        disabled={calendars.length === 0}
        className="h-9 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] px-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)] disabled:opacity-50"
      >
        {calendars.length === 0 ? <option value="">No calendar available</option> : null}
        {calendars.map((calendar) => (
          <option key={calendar.id} value={calendar.id}>
            {calendar.name}
          </option>
        ))}
      </select>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="h-8 rounded-lg px-3 text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !values.title.trim() || !values.date || !values.calendarId}
          className="h-8 rounded-lg bg-[var(--ledger-accent)] px-3 text-xs font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : mode === 'event' ? 'Create event' : 'Create reminder'}
        </button>
      </div>
    </div>
  </ModalOverlay>
);

export function SmartDatePlugin({
  noteId,
  noteTitle,
  noteProjectId,
}: {
  noteId?: string | null;
  noteTitle?: string | null;
  noteProjectId?: string | null;
}) {
  const [editor] = useLexicalComposerContext();
  const api = useApi();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspaceContext();
  const [smartLinks, setSmartLinks] = useState<SmartLinkRow[]>([]);
  const [hoverTarget, setHoverTarget] = useState<SmartDateTarget | null>(null);
  const [composerTarget, setComposerTarget] = useState<SmartDateTarget | null>(null);
  const [composerMode, setComposerMode] = useState<'event' | 'reminder'>('event');
  const [composerCalendars, setComposerCalendars] = useState<SmartDateCalendar[]>([]);
  const [composerValues, setComposerValues] = useState<SmartDateComposerValues>({
    title: '',
    date: '',
    time: '',
    allDay: false,
    calendarId: '',
  });
  const [isComposerSaving, setIsComposerSaving] = useState(false);
  const pendingTopLevelKeysRef = useRef<Set<NodeKey>>(new Set());
  const scanTimerRef = useRef<number | null>(null);
  const scanRequestedRef = useRef(false);
  const smartLinksByKey = useMemo(
    () => new Map(smartLinks.map((row) => [row.source_key, row])),
    [smartLinks]
  );

  const refreshSmartLinks = useCallback(async () => {
    if (!noteId) {
      setSmartLinks([]);
      return;
    }

    try {
      const payload = (await api.getNoteSmartLinks(noteId)) as
        | SmartLinkRow[]
        | { links?: SmartLinkRow[] };
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.links)
        ? payload.links
        : [];
      setSmartLinks(rows);
    } catch (error) {
      console.error('[smart-dates] failed to load smart links', error);
      setSmartLinks([]);
    }
  }, [api, noteId]);

  useEffect(() => {
    void refreshSmartLinks();
  }, [activeWorkspaceId, noteId, refreshSmartLinks]);

  useEffect(() => {
    let cancelled = false;
    const loadCalendars = async () => {
      try {
        const payload = await api.getCalendars({ scope: 'current_workspace' });
        const rows = Array.isArray(payload) ? payload : [];
        if (!cancelled) {
          setComposerCalendars(rows as SmartDateCalendar[]);
        }
      } catch (error) {
        console.error('[smart-dates] failed to load calendars', error);
        if (!cancelled) setComposerCalendars([]);
      }
    };
    void loadCalendars();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    const listener = (_event: unknown, payload: { noteId?: string | null } | null) => {
      if (payload?.noteId && payload.noteId !== noteId) return;
      void refreshSmartLinks();
    };
    window.ipcRenderer?.on('notes:smart-links-updated', listener);
    return () => {
      window.ipcRenderer?.off('notes:smart-links-updated', listener);
    };
  }, [noteId, refreshSmartLinks]);

  const syncNodeStates = useCallback(() => {
    editor.update(
      () => {
        const root = $getRoot();
        const visit = (node: any) => {
          if ($isSmartDateNode(node)) {
            const nextState = getSmartDateStateFromRow(smartLinksByKey.get(node.getSmartDateKey()));
            if (node.getSmartDateState() !== nextState) {
              node.setSmartDateState(nextState);
            }
            return;
          }
          const getChildren = (node as { getChildren?: () => Array<unknown> }).getChildren;
          if (typeof getChildren === 'function') {
            for (const child of getChildren.call(node)) {
              visit(child);
            }
          }
        };
        visit(root);
      },
      { tag: [SMART_DATE_SYNC_TAG, HISTORIC_TAG] }
    );
  }, [editor, smartLinksByKey]);

  useEffect(() => {
    syncNodeStates();
  }, [syncNodeStates]);

  const queueScan = useCallback(
    (keys: Set<NodeKey>) => {
      for (const key of keys) {
        pendingTopLevelKeysRef.current.add(key);
      }
      if (scanTimerRef.current) {
        window.clearTimeout(scanTimerRef.current);
      }

      scanTimerRef.current = window.setTimeout(() => {
        const keysToScan = new Set(pendingTopLevelKeysRef.current);
        pendingTopLevelKeysRef.current.clear();
        if (keysToScan.size === 0) return;

        scanRequestedRef.current = true;
        editor.update(
          () => {
            for (const key of keysToScan) {
              const node = $getNodeByKey(key);
              if (!node) continue;
              const visit = (current: any) => {
                if (current instanceof TextNode) {
                  if (isTextNodeEligible(current)) current.markDirty();
                  return;
                }
                if (current?.getChildren) {
                  for (const child of current.getChildren()) {
                    visit(child);
                  }
                }
              };
              visit(node);
            }
          },
          { tag: [SMART_DATE_SCAN_TAG, HISTORIC_TAG] }
        );

        queueMicrotask(() => {
          scanRequestedRef.current = false;
        });
      }, SCAN_DEBOUNCE_MS);
    },
    [editor]
  );

  useEffect(() => {
    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags, editorState }) => {
      if (tags.has(SMART_DATE_LOAD_TAG)) {
        if (!noteId) return;
        const loadedTextKeys = new Set<NodeKey>();
        editorState.read(() => {
          for (const key of collectEligibleTextKeys()) loadedTextKeys.add(key);
        });
        queueScan(loadedTextKeys);
        return;
      }
      if (
        tags.has(HISTORIC_TAG) ||
        tags.has(SMART_DATE_SCAN_TAG) ||
        tags.has(SMART_DATE_SYNC_TAG) ||
        tags.has('smart-person-scan') ||
        tags.has('smart-person-sync') ||
        tags.has('smart-person-load')
      ) {
        return;
      }
      if (editor.isComposing()) return;
      if (!noteId) return;

      const changedTopLevelKeys = new Set<NodeKey>();
      editorState.read(() => {
        for (const key of dirtyLeaves) {
          const node = $getNodeByKey(key);
          if (!(node instanceof TextNode)) continue;
          if (!isTextNodeEligible(node)) continue;
          changedTopLevelKeys.add(node.getTopLevelElementOrThrow().getKey());
        }

        for (const key of dirtyElements.keys()) {
          const node = $getNodeByKey(key);
          if (!node) continue;
          if (node instanceof TextNode) {
            if (isTextNodeEligible(node)) {
              changedTopLevelKeys.add(node.getTopLevelElementOrThrow().getKey());
            }
            continue;
          }
          const getChildren = (node as { getChildren?: () => Array<unknown> }).getChildren;
          if (typeof getChildren === 'function') {
            changedTopLevelKeys.add(node.getKey());
          }
        }
      });

      if (changedTopLevelKeys.size > 0) {
        queueScan(changedTopLevelKeys);
      }
    });
  }, [editor, noteId, queueScan]);

  useEffect(() => {
    if (!noteId) return;
    const timer = window.setTimeout(() => {
      const fullScanKeys = collectEligibleTextKeys();
      if (fullScanKeys.size === 0) return;
      scanRequestedRef.current = true;
      editor.update(
        () => {
          for (const key of fullScanKeys) {
            const node = $getNodeByKey(key);
            if (node instanceof TextNode && isTextNodeEligible(node)) {
              node.markDirty();
            }
          }
        },
        { tag: [SMART_DATE_LOAD_TAG, HISTORIC_TAG] }
      );
      queueMicrotask(() => {
        scanRequestedRef.current = false;
      });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [editor, noteId, smartLinksByKey]);

  const closePopover = useCallback(() => setHoverTarget(null), []);

  const closeComposer = useCallback(() => {
    if (!isComposerSaving) setComposerTarget(null);
  }, [isComposerSaving]);

  const openComposer = useCallback(
    (target: SmartDateTarget, mode: 'event' | 'reminder') => {
      const resolvedDate = target.resolvedDate;
      setComposerMode(mode);
      setComposerValues({
        title: target.title,
        date: formatSmartDateKey(resolvedDate),
        time: target.hasExplicitTime
          ? `${String(resolvedDate.getHours()).padStart(2, '0')}:${String(
              resolvedDate.getMinutes()
            ).padStart(2, '0')}`
          : mode === 'reminder'
          ? DEFAULT_REMINDER_TIME
          : '',
        allDay: mode === 'event' && !target.hasExplicitTime,
        calendarId: composerCalendars[0]?.id ?? '',
      });
      setComposerTarget(target);
      setHoverTarget(null);
    },
    [composerCalendars]
  );

  const saveComposer = useCallback(async () => {
    if (!composerTarget || !composerValues.title.trim() || !composerValues.calendarId) return;

    const startTime =
      composerMode === 'reminder'
        ? composerValues.time || DEFAULT_REMINDER_TIME
        : composerValues.time || '00:00';
    const start = new Date(`${composerValues.date}T${startTime}:00`);
    if (Number.isNaN(start.getTime())) {
      toast.show(
        composerMode === 'event' ? 'Could not create event.' : 'Could not create reminder.',
        {
          variant: 'error',
        }
      );
      return;
    }

    const calendar = composerCalendars.find((item) => item.id === composerValues.calendarId);
    setIsComposerSaving(true);

    try {
      let linkedObjectId: string | null = null;
      if (composerMode === 'reminder') {
        const response = await api.createReminder({
          title: composerValues.title.trim(),
          remind_at: start.toISOString(),
          calendar_id: composerValues.calendarId,
          color: calendar?.color ?? undefined,
          is_done: false,
          project_id: composerTarget.noteProjectId ?? null,
          note_id: composerTarget.noteId,
        });
        const created = Array.isArray((response as { created?: Array<{ id: string }> })?.created)
          ? (response as { created: Array<{ id: string }> }).created
          : response
          ? [response as { id: string }]
          : [];
        linkedObjectId = created[0]?.id ?? null;
      } else {
        const end = composerValues.allDay
          ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
          : new Date(start.getTime() + 30 * 60 * 1000);
        const response = await api.createEvent({
          title: composerValues.title.trim(),
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          calendar_id: composerValues.calendarId,
          color: calendar?.color ?? undefined,
          all_day: composerValues.allDay,
          project_id: composerTarget.noteProjectId ?? null,
          note_id: composerTarget.noteId,
          status: 'planned',
          visibility: 'private',
        });
        const created = Array.isArray((response as { created?: Array<{ id: string }> })?.created)
          ? (response as { created: Array<{ id: string }> }).created
          : response
          ? [response as { id: string }]
          : [];
        linkedObjectId = created[0]?.id ?? null;
      }

      if (!linkedObjectId) throw new Error('creation_failed');

      await api.upsertNoteSmartLink(composerTarget.noteId, {
        source_key: composerTarget.key,
        source_text: composerTarget.sourceText,
        source_start_offset: composerTarget.sourceStartOffset,
        source_end_offset: composerTarget.sourceEndOffset,
        linked_event_id: composerMode === 'event' ? linkedObjectId : null,
        linked_reminder_id: composerMode === 'reminder' ? linkedObjectId : null,
        dismissed_at: null,
      });
      await refreshSmartLinks();
      window.ipcRenderer?.send('notes:smart-links-updated', { noteId: composerTarget.noteId });
      toast.show(composerMode === 'event' ? 'Event created' : 'Reminder created', {
        detail: composerValues.title.trim(),
        variant: 'success',
        icon: 'ledger',
      });
      setComposerTarget(null);
    } catch (error) {
      console.error('[smart-dates] failed to create linked item', error);
      toast.show(
        composerMode === 'event' ? 'Could not create event.' : 'Could not create reminder.',
        {
          variant: 'error',
        }
      );
    } finally {
      setIsComposerSaving(false);
    }
  }, [
    api,
    composerCalendars,
    composerMode,
    composerTarget,
    composerValues,
    refreshSmartLinks,
    toast,
  ]);

  const openLinkedObject = useCallback(
    (target: SmartDateTarget) => {
      if (target.linkedEventId && !target.linkedReminderId) {
        void window.desktopWindow?.openModule('calendar', {
          kind: 'calendar',
          focusContext: `focus-event:${target.linkedEventId}`,
        } as any);
        closePopover();
        return;
      }

      if (target.linkedReminderId && !target.linkedEventId) {
        void window.desktopWindow?.openModule('calendar', {
          kind: 'calendar',
          focusContext: `focus-reminder:${target.linkedReminderId}`,
        } as any);
        closePopover();
      }
    },
    [closePopover]
  );

  const getTargetFromElement = useCallback(
    (element: HTMLElement | null): SmartDateTarget | null => {
      if (!element) return null;
      const key = element.getAttribute('data-ledger-smart-date-key') ?? '';
      if (!key) return null;

      const row = smartLinksByKey.get(key) ?? null;
      const state = getSmartDateStateFromRow(row);
      if (state === 'dismissed') return null;

      let target: SmartDateTarget | null = null;
      editor.getEditorState().read(() => {
        let node: SmartDateNode | null = null;
        const visit = (current: any) => {
          if (node || !current) return;
          if ($isSmartDateNode(current) && current.getSmartDateKey() === key) {
            node = current;
            return;
          }
          const getChildren = (current as { getChildren?: () => Array<unknown> }).getChildren;
          if (typeof getChildren === 'function') {
            for (const child of getChildren.call(current)) visit(child);
          }
        };
        visit($getRoot());
        const smartDateNode = node as SmartDateNode | null;
        if (!smartDateNode) return;
        const text = smartDateNode.getTextContent().trim();
        const topLevelText = smartDateNode.getTopLevelElementOrThrow().getTextContent();
        const match = findSmartDateMatch(text);
        if (!match) return;
        const sourceSentence = findSentenceContainingRange(topLevelText, 0, topLevelText.length);
        const cleanedSentence = stripPhraseFromSentence(sourceSentence, match.phrase);
        const title = cleanedSentence || noteTitle?.trim() || 'Untitled event';
        target = {
          key,
          text: match.phrase,
          resolvedDate: match.resolvedDate,
          hasExplicitTime: match.hasExplicitTime,
          sourceText: match.phrase,
          sourceStartOffset: match.startOffset,
          sourceEndOffset: match.endOffset,
          title,
          noteId: noteId ?? '',
          noteTitle: noteTitle?.trim() || 'Untitled note',
          noteProjectId: noteProjectId ?? null,
          linkedEventId: row?.linked_event_id ?? null,
          linkedReminderId: row?.linked_reminder_id ?? null,
          state,
        };
      });

      return target;
    },
    [editor, noteId, noteProjectId, noteTitle, smartLinksByKey]
  );

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    const handlePointerDown = (event: PointerEvent) => {
      const element = getSmartDateElementFromEvent(event);
      if (!element) return;

      const target: SmartDateTarget | null = getTargetFromElement(element);
      if (!target) return;

      if (target.linkedEventId && !target.linkedReminderId) {
        event.preventDefault();
        openLinkedObject(target);
        return;
      }

      if (target.linkedReminderId && !target.linkedEventId) {
        event.preventDefault();
        openLinkedObject(target);
        return;
      }

      event.preventDefault();
      setHoverTarget(target);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const element = getSmartDateElementFromEvent(event);
      if (!element) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;

      const target: SmartDateTarget | null = getTargetFromElement(element);
      if (!target) return;

      event.preventDefault();
      if (target.linkedEventId && !target.linkedReminderId) {
        openLinkedObject(target);
        return;
      }
      if (target.linkedReminderId && !target.linkedEventId) {
        openLinkedObject(target);
        return;
      }
      setHoverTarget(target);
    };

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-ledger-smart-date-key]')) return;
      if (target?.closest?.('[data-ledger-smart-date-popover]')) return;
      setHoverTarget(null);
    };

    root.addEventListener('pointerdown', handlePointerDown, true);
    root.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handleDocumentPointerDown);

    return () => {
      root.removeEventListener('pointerdown', handlePointerDown, true);
      root.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
    };
  }, [editor, getTargetFromElement, openLinkedObject]);

  useEffect(() => {
    if (!hoverTarget) return;
    const currentRow = smartLinksByKey.get(hoverTarget.key) ?? null;
    const nextState = getSmartDateStateFromRow(currentRow);
    if (nextState === 'dismissed') {
      setHoverTarget(null);
    }
  }, [hoverTarget, smartLinksByKey]);

  const popover = useMemo(() => {
    if (!hoverTarget) return null;
    const row = smartLinksByKey.get(hoverTarget.key) ?? null;
    const target = {
      ...hoverTarget,
      linkedEventId: row?.linked_event_id ?? hoverTarget.linkedEventId ?? null,
      linkedReminderId: row?.linked_reminder_id ?? hoverTarget.linkedReminderId ?? null,
      state: getSmartDateStateFromRow(row),
    };

    return (
      <SmartDatePopover
        target={target}
        onClose={closePopover}
        onCreateEvent={() => openComposer(target, 'event')}
        onCreateReminder={() => openComposer(target, 'reminder')}
        onOpenEvent={() => openLinkedObject(target)}
        onOpenReminder={() => openLinkedObject(target)}
      />
    );
  }, [closePopover, hoverTarget, openComposer, openLinkedObject, smartLinksByKey]);

  return (
    <>
      <SmartDateEntityMatcher noteId={noteId} scanRequestedRef={scanRequestedRef} />
      {popover}
      {composerTarget ? (
        <SmartDateComposer
          mode={composerMode}
          target={composerTarget}
          calendars={composerCalendars}
          values={composerValues}
          isSaving={isComposerSaving}
          onChange={(update) => setComposerValues((current) => ({ ...current, ...update }))}
          onClose={closeComposer}
          onSave={() => void saveComposer()}
        />
      ) : null}
    </>
  );
}

function SmartDateEntityMatcher({
  noteId,
  scanRequestedRef,
}: {
  noteId?: string | null;
  scanRequestedRef: React.MutableRefObject<boolean>;
}) {
  const getMatch = useCallback(
    (text: string) => {
      if (!noteId) return null;
      const match = findSmartDateMatch(text);
      if (!match) return null;
      return {
        start: match.startOffset,
        end: match.endOffset,
      };
    },
    [noteId, scanRequestedRef]
  );

  const createNode = useCallback((textNode: TextNode) => {
    const smartDateKey = makeSourceKey();
    const node = $createSmartDateNode(textNode.getTextContent(), smartDateKey, 'detected');
    node.setFormat(textNode.getFormat());
    node.setStyle(textNode.getStyle());
    node.setDetail(textNode.getDetail());
    node.setMode(textNode.getMode());
    return node;
  }, []);

  useLexicalTextEntity(
    getMatch,
    SmartDateNode as unknown as Klass<TextNode>,
    createNode as unknown as (textNode: TextNode) => TextNode
  );
  return null;
}
