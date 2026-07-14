import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, CalendarDays, CircleX } from 'lucide-react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalTextEntity } from '@lexical/react/useLexicalTextEntity';
import {
  $getNodeByKey,
  $getRoot,
  type Klass,
  type NodeKey,
  TextNode,
} from 'lexical';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import {
  createSmartDateComposerContext,
  encodeSmartDateComposerContext,
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

const SCAN_DEBOUNCE_MS = 220;
const SMART_DATE_SCAN_TAG = 'smart-date-scan';
const SMART_DATE_SYNC_TAG = 'smart-date-sync';
const SMART_DATE_LOAD_TAG = 'smart-date-load';

const isTextNodeEligible = (node: TextNode) => {
  if (!node.isSimpleText()) return false;
  if (node.hasFormat('code')) return false;

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
  onDismiss,
  onOpenEvent,
  onOpenReminder,
}: {
  target: SmartDateTarget;
  onClose: () => void;
  onCreateEvent: () => void;
  onCreateReminder: () => void;
  onDismiss: () => void;
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
      const width = 284;
      const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
      const top = Math.min(window.innerHeight - 12, rect.bottom + 10);
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
      className="fixed z-[9999] w-[284px] rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-2.5 shadow-[0_18px_44px_rgba(15,23,42,0.18)] backdrop-blur-sm"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ledger-text-muted)]">
            Detected phrase
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-[var(--ledger-text-primary)]">
            {target.text}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--ledger-text-muted)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
          aria-label="Close"
        >
          <CircleX size={14} />
        </button>
      </div>

      <div className="mb-2 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ledger-text-muted)]">
          Resolved value
        </p>
        <p className="mt-0.5 text-sm text-[var(--ledger-text-primary)]">
          {formatSmartDateResolution(target.resolvedDate, target.hasExplicitTime)}
        </p>
      </div>

      {showCreateActions ? (
        <div className="space-y-1">
          <button
            type="button"
            onClick={onCreateEvent}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--ledger-text-primary)] transition hover:bg-[var(--ledger-surface-hover)]"
          >
            <CalendarDays size={14} className="text-[var(--ledger-accent)]" />
            Create event
          </button>
          <button
            type="button"
            onClick={onCreateReminder}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--ledger-text-primary)] transition hover:bg-[var(--ledger-surface-hover)]"
          >
            <BellRing size={14} className="text-[var(--ledger-accent)]" />
            Create reminder
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {hasLinkedEvent ? (
            <button
              type="button"
              onClick={onOpenEvent}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--ledger-text-primary)] transition hover:bg-[var(--ledger-surface-hover)]"
            >
              <CalendarDays size={14} className="text-[var(--ledger-accent)]" />
              Open event
            </button>
          ) : null}
          {hasLinkedReminder ? (
            <button
              type="button"
              onClick={onOpenReminder}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--ledger-text-primary)] transition hover:bg-[var(--ledger-surface-hover)]"
            >
              <BellRing size={14} className="text-[var(--ledger-accent)]" />
              Open reminder
            </button>
          ) : null}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[color:var(--ledger-border-subtle)] pt-2">
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]"
        >
          Close
        </button>
      </div>
    </div>,
    document.body
  );
};

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
      const payload = (await api.getNoteSmartLinks(noteId)) as SmartLinkRow[] | { links?: SmartLinkRow[] };
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.links) ? payload.links : [];
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
      { tag: SMART_DATE_SYNC_TAG }
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

        editor.update(
          () => {
            scanRequestedRef.current = true;
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
          { tag: SMART_DATE_SCAN_TAG }
        );

        scanRequestedRef.current = false;
      }, SCAN_DEBOUNCE_MS);
    },
    [editor]
  );

  useEffect(() => {
    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags, editorState }) => {
      if (
        tags.has(SMART_DATE_SCAN_TAG) ||
        tags.has(SMART_DATE_SYNC_TAG) ||
        tags.has(SMART_DATE_LOAD_TAG)
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
      editor.update(
        () => {
          scanRequestedRef.current = true;
          for (const key of fullScanKeys) {
            const node = $getNodeByKey(key);
            if (node instanceof TextNode && isTextNodeEligible(node)) {
              node.markDirty();
            }
          }
        },
        { tag: SMART_DATE_LOAD_TAG }
      );
      scanRequestedRef.current = false;
    }, 80);

    return () => window.clearTimeout(timer);
  }, [editor, noteId, smartLinksByKey]);

  const closePopover = useCallback(() => setHoverTarget(null), []);

  const openCalendarWithContext = useCallback(
    (target: SmartDateTarget, mode: 'event' | 'reminder') => {
      const composerContext = createSmartDateComposerContext({
        sourceKey: target.key,
        sourceText: target.sourceText,
        sourceStartOffset: target.sourceStartOffset,
        sourceEndOffset: target.sourceEndOffset,
        noteId: target.noteId,
        noteTitle: target.noteTitle,
        noteProjectId: target.noteProjectId ?? null,
        resolvedDate: target.resolvedDate,
        hasExplicitTime: target.hasExplicitTime,
        suggestedTitle: target.title,
      });

      const focusDate = formatSmartDateKey(target.resolvedDate);
      const focusContext = encodeSmartDateComposerContext(composerContext);

      try {
        void window.desktopWindow?.openModule('calendar', {
          kind: 'calendar',
          focusDate,
          focusContext: `smart-date-create:${encodeURIComponent(focusContext)}:${mode}`,
        } as any);
      } catch (error) {
        console.error('[smart-dates] failed to open calendar module', error);
        toast.show(mode === 'event' ? 'Could not open event composer.' : 'Could not open reminder composer.', {
          variant: 'error',
        });
      }
    },
    [toast]
  );

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
        const node = $getNodeByKey(key);
        if (!node || !$isSmartDateNode(node as SmartDateNode)) return;
        const text = node.getTextContent().trim();
        const topLevelText = node.getTopLevelElementOrThrow().getTextContent();
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

    let hoverTimer: number | null = null;

    const handlePointerEnter = (event: PointerEvent) => {
      const element = (event.target as HTMLElement | null)?.closest?.(
        '[data-ledger-smart-date-key]'
      ) as HTMLElement | null;
      if (!element) return;
      if (hoverTimer) window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => {
        const target = getTargetFromElement(element);
        if (target) setHoverTarget(target);
      }, 80);
    };

    const handlePointerLeave = (event: PointerEvent) => {
      const related = event.relatedTarget as HTMLElement | null;
      if (related?.closest?.('[data-ledger-smart-date-key]')) return;
      hoverTimer = window.setTimeout(() => {
        setHoverTarget((current) => (current ? null : current));
      }, 100);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const element = (event.target as HTMLElement | null)?.closest?.(
        '[data-ledger-smart-date-key]'
      ) as HTMLElement | null;
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
      const element = (event.target as HTMLElement | null)?.closest?.(
        '[data-ledger-smart-date-key]'
      ) as HTMLElement | null;
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

    const handleFocusIn = (event: FocusEvent) => {
      const element = (event.target as HTMLElement | null)?.closest?.(
        '[data-ledger-smart-date-key]'
      ) as HTMLElement | null;
      if (!element) return;
      const target = getTargetFromElement(element);
      if (target) setHoverTarget(target);
    };

    const handleFocusOut = (event: FocusEvent) => {
      const related = event.relatedTarget as HTMLElement | null;
      if (related?.closest?.('[data-ledger-smart-date-key]')) return;
      setHoverTarget(null);
    };

    root.addEventListener('pointerenter', handlePointerEnter, true);
    root.addEventListener('pointerleave', handlePointerLeave, true);
    root.addEventListener('pointerdown', handlePointerDown, true);
    root.addEventListener('keydown', handleKeyDown, true);
    root.addEventListener('focusin', handleFocusIn, true);
    root.addEventListener('focusout', handleFocusOut, true);

    return () => {
      if (hoverTimer) window.clearTimeout(hoverTimer);
      root.removeEventListener('pointerenter', handlePointerEnter, true);
      root.removeEventListener('pointerleave', handlePointerLeave, true);
      root.removeEventListener('pointerdown', handlePointerDown, true);
      root.removeEventListener('keydown', handleKeyDown, true);
      root.removeEventListener('focusin', handleFocusIn, true);
      root.removeEventListener('focusout', handleFocusOut, true);
    };
  }, [editor, getTargetFromElement, openLinkedObject]);

  const dismissPhrase = useCallback(async () => {
    if (!hoverTarget || !noteId) return;
    try {
      await api.upsertNoteSmartLink(noteId, {
        source_key: hoverTarget.key,
        source_text: hoverTarget.sourceText,
        source_start_offset: hoverTarget.sourceStartOffset,
        source_end_offset: hoverTarget.sourceEndOffset,
        linked_event_id: null,
        linked_reminder_id: null,
        dismissed_at: new Date().toISOString(),
      });
      await refreshSmartLinks();
      window.ipcRenderer?.send('notes:smart-links-updated', { noteId });
      closePopover();
    } catch (error) {
      console.error('[smart-dates] failed to dismiss phrase', error);
      toast.show('Could not dismiss smart date.', { variant: 'error' });
    }
  }, [api, closePopover, hoverTarget, noteId, refreshSmartLinks, toast]);

  const openComposer = useCallback(
    (mode: 'event' | 'reminder') => {
      if (!hoverTarget) return;
      openCalendarWithContext(hoverTarget, mode);
      closePopover();
    },
    [closePopover, hoverTarget, openCalendarWithContext]
  );

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
        onCreateEvent={() => openComposer('event')}
        onCreateReminder={() => openComposer('reminder')}
        onDismiss={() => void dismissPhrase()}
        onOpenEvent={() => openLinkedObject(target)}
        onOpenReminder={() => openLinkedObject(target)}
      />
    );
  }, [closePopover, dismissPhrase, hoverTarget, openComposer, openLinkedObject, smartLinksByKey]);

  return (
    <>
      <SmartDateEntityMatcher
        noteId={noteId}
        scanRequestedRef={scanRequestedRef}
      />
      {popover}
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
      if (!scanRequestedRef.current) return null;
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
