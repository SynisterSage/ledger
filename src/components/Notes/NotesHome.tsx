import {
  Copy,
  ChevronRight,
  Eye,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Link2,
  Mic,
  MoreHorizontal,
  Plus,
  Search,
  Pin,
  PinOff,
  StickyNote,
  Trash2,
  FilePlus2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ContextMenu, type ContextMenuGroup } from '../Common/ContextMenu';
import { useToast } from '../Common/ToastProvider';
import type { PinRecord } from '../../utils/pins';

export const notesAskSuggestions = [
  'What did I miss?',
  'What decisions have we made?',
  'What are the action items?',
  'What should I follow up on?',
  'What remains unresolved?',
  'Who owns the next steps?',
  'What concerns came up?',
  'What changed during this meeting?',
  'What should I remember from this?',
  'Can you summarize the key points?',
  'What needs to happen next?',
  'Which parts need my attention?',
];

export const notesHomeAskSuggestions = [
  'What changed in my notes recently?',
  'Summarize my last three notes.',
  'Make me a meeting brief for my next workday using my notes.',
  'Summarize my latest notes.',
  'Which notes need my attention?',
  'What decisions have I recorded?',
  'What follow-ups are still open?',
  'Find unresolved items across my notes.',
  'What themes are coming up in my notes?',
  'Which notes are related to this?',
  'What should I revisit this week?',
  'Show me my recent workday notes.',
];

export type NotesHomeNote = {
  id: string;
  title: string;
  content: string;
  section_id?: string | null;
  parent_id?: string | null;
  updated_at: string;
  mode?: 'text' | 'mind_map' | 'meeting_note';
};

export type NotesHomeSection = { id: string; name: string; parent_id?: string | null };
export type NotesHomeTemplate = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  pinned?: boolean;
  visibility?: 'mine' | 'workspace';
  usage_count?: number;
  last_used_at?: string | null;
  is_system?: boolean;
};
export type NotesHomeUpcomingMeeting = {
  id: string;
  title: string;
  start_at: string;
  end_at?: string | null;
  note_id?: string | null;
  note_title?: string | null;
  status?: string | null;
  all_day?: boolean;
};

type NotesHomeRecentFolder = {
  id: string;
  name: string;
  section: NotesHomeSection | null;
  notes: NotesHomeNote[];
};

type Props = {
  notes: NotesHomeNote[];
  sections: NotesHomeSection[];
  templates: NotesHomeTemplate[];
  pins: PinRecord[];
  workspaceId?: string | null;
  userId?: string | null;
  currentSectionId?: string | null;
  activeMeetingNoteId?: string | null;
  activeMeetingStatus?:
    | 'idle'
    | 'recording'
    | 'paused'
    | 'processing'
    | 'complete'
    | 'failed'
    | null;
  onOpenNote: (note: NotesHomeNote) => void;
  onNewNote: (sectionId?: string | null) => void;
  onAskLedger: (question: string) => void;
  askLedgerOpen?: boolean;
  onStartMeetingNotes: (sectionId?: string | null) => void;
  upcomingMeetings?: NotesHomeUpcomingMeeting[];
  onStartMeetingFromEvent?: (event: NotesHomeUpcomingMeeting) => void;
  onOpenCalendarEvent?: (event: NotesHomeUpcomingMeeting) => void;
  onBrowseTemplates: () => void;
  onOpenTemplate: (templateId: string) => void;
  onUseTemplate: (templateId: string) => void;
  onViewAllRecent: () => void;
  onToggleNotePin: (noteId: string) => Promise<void> | void;
  onMoveNoteToSection: (noteId: string, sectionId: string | null) => Promise<void> | void;
  onRenameNote: (noteId: string) => void;
  onCreateChildNote: (noteId: string) => void;
  onLinkNoteToProject: (noteId: string) => void;
  onMoveNoteToRoot: (noteId: string) => void;
  onDuplicateNote: (noteId: string) => void;
  onSaveNoteAsTemplate: (noteId: string, name?: string) => void;
  onDeleteNote: (noteId: string) => void;
  onRenameFolder: (sectionId: string) => void;
  onCreateChildFolder: (sectionId: string) => void;
  onMoveFolder: (sectionId: string, parentSectionId: string | null) => Promise<void> | void;
  onDeleteFolder: (sectionId: string) => void;
  onToggleTemplatePin: (template: NotesHomeTemplate) => Promise<void> | void;
  onDuplicateTemplate: (template: NotesHomeTemplate) => Promise<void> | void;
};

const storageKey = (workspaceId: string | null | undefined, userId?: string | null) =>
  `notes-home-collapsed:v2:${userId ?? 'anonymous'}:${workspaceId ?? 'none'}`;

const homeDateKey = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toDateString() : 'unknown';
};

const homeDateLabel = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Earlier';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const daysAgo = Math.floor((today.getTime() - date.getTime()) / 86400000);
  if (daysAgo >= 0 && daysAgo < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
};

const homeTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';
};

const NotesHomeListRow = ({
  note,
  sectionName,
  active,
  onClick,
  onContextMenu,
}: {
  note: NotesHomeNote;
  sectionName?: string;
  active?: boolean;
  onClick: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    onContextMenu={onContextMenu}
    className="group grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[var(--ledger-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)]"
  >
    <span className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ledger-text-muted)]">
      {note.mode === 'meeting_note' ? (
        <Mic size={15} strokeWidth={1.8} />
      ) : (
        <FileText size={15} strokeWidth={1.8} />
      )}
      {active && (
        <span className="absolute ml-5 mt-[-18px] h-1.5 w-1.5 rounded-full bg-[var(--ledger-accent)]" />
      )}
    </span>
    <span className="min-w-0">
      <span className="block truncate text-[13px] font-semibold text-[var(--ledger-text-primary)]">
        {note.title || 'Untitled note'}
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-[var(--ledger-text-muted)]">
        {note.mode === 'meeting_note' ? 'Meeting note' : sectionName ?? 'Unsorted'}
      </span>
    </span>
    <span className="shrink-0 self-start pt-0.5 text-[11px] tabular-nums text-[var(--ledger-text-muted)]">
      {homeTime(note.updated_at)}
    </span>
  </button>
);

export const NotesHome = ({
  notes,
  sections,
  templates,
  pins,
  workspaceId,
  userId,
  currentSectionId,
  activeMeetingNoteId,
  onOpenNote,
  onNewNote,
  onAskLedger,
  askLedgerOpen = false,
  onOpenTemplate,
  onUseTemplate,
  onViewAllRecent,
  onToggleNotePin,
  onMoveNoteToSection,
  onRenameNote,
  onCreateChildNote,
  onLinkNoteToProject,
  onMoveNoteToRoot,
  onDuplicateNote,
  onSaveNoteAsTemplate,
  onDeleteNote,
  onRenameFolder,
  onCreateChildFolder,
  onMoveFolder,
  onDeleteFolder,
  onToggleTemplatePin,
  onDuplicateTemplate,
}: Props) => {
  const toast = useToast();
  const [askSuggestionIndex, setAskSuggestionIndex] = useState(0);
  const askSuggestion = notesHomeAskSuggestions[askSuggestionIndex % notesHomeAskSuggestions.length];

  useEffect(() => {
    if (askLedgerOpen) return;
    const timer = window.setInterval(() => {
      setAskSuggestionIndex((current) => (current + 1) % notesHomeAskSuggestions.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [askLedgerOpen]);
  const [askQuestion, setAskQuestion] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey(workspaceId, userId)) ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const hasStoredCollapsedStateRef = useRef(false);
  const folderDefaultsAppliedRef = useRef<string | null>(null);

  useEffect(() => {
    const key = storageKey(workspaceId, userId);
    folderDefaultsAppliedRef.current = null;
    try {
      const stored = localStorage.getItem(key);
      hasStoredCollapsedStateRef.current = stored !== null;
      setCollapsed(new Set(JSON.parse(stored ?? '[]')));
    } catch {
      hasStoredCollapsedStateRef.current = false;
      setCollapsed(new Set());
    }
  }, [userId, workspaceId]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(workspaceId, userId), JSON.stringify([...collapsed]));
    } catch {}
  }, [collapsed, userId, workspaceId]);

  const sectionName = useMemo(
    () => new Map(sections.map((section) => [section.id, section.name])),
    [sections]
  );
  const sectionById = useMemo(
    () => new Map(sections.map((section) => [section.id, section])),
    [sections]
  );
  const sectionPathById = useMemo(() => {
    const cache = new Map<string, string>();
    const build = (sectionId: string) => {
      const cached = cache.get(sectionId);
      if (cached) return cached;
      const section = sectionById.get(sectionId);
      if (!section) return 'Folder';
      const lineage: string[] = [section.name || 'Untitled folder'];
      const seen = new Set<string>([section.id]);
      let cursor = section.parent_id ? sectionById.get(section.parent_id) ?? null : null;
      while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        lineage.unshift(cursor.name || 'Untitled folder');
        cursor = cursor.parent_id ? sectionById.get(cursor.parent_id) ?? null : null;
      }
      const label = lineage.join(' / ');
      cache.set(sectionId, label);
      return label;
    };
    sections.forEach((section) => {
      build(section.id);
    });
    return cache;
  }, [sectionById, sections]);
  const descendantSectionIds = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    sections.forEach((section) => {
      const key = section.parent_id ?? '__root__';
      childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), section.id]);
    });
    const descendants = new Map<string, Set<string>>();
    const walk = (sectionId: string): Set<string> => {
      const cached = descendants.get(sectionId);
      if (cached) return cached;
      const next = new Set<string>();
      for (const childId of childrenByParent.get(sectionId) ?? []) {
        next.add(childId);
        walk(childId).forEach((id) => next.add(id));
      }
      descendants.set(sectionId, next);
      return next;
    };
    sections.forEach((section) => {
      walk(section.id);
    });
    return descendants;
  }, [sections]);
  const sectionMoveTargets = useMemo(
    () => [
      { id: null as string | null, label: 'Unsorted' },
      ...sections.map((section) => ({
        id: section.id,
        label: sectionPathById.get(section.id) ?? section.name,
      })),
    ],
    [sectionPathById, sections]
  );
  const notePinById = useMemo(
    () => new Set(pins.filter((pin) => pin.object_type === 'note').map((pin) => pin.object_id)),
    [pins]
  );
  const templatePinById = useMemo(
    () => new Set(templates.filter((template) => template.pinned).map((template) => template.id)),
    [templates]
  );
  const [menuState, setMenuState] = useState<null | {
    kind: 'note' | 'folder' | 'template' | 'blank' | 'recent';
    x: number;
    y: number;
    note?: NotesHomeNote;
    folder?: NotesHomeRecentFolder;
    template?: NotesHomeTemplate;
  }>(null);
  const [moveMenuState, setMoveMenuState] = useState<null | {
    kind: 'note' | 'folder';
    x: number;
    y: number;
    note?: NotesHomeNote;
    folder?: NotesHomeRecentFolder;
  }>(null);
  const closeMenus = () => {
    setMenuState(null);
    setMoveMenuState(null);
  };
  const openMenuAt = (
    next:
      | { kind: 'note'; note: NotesHomeNote }
      | { kind: 'folder'; folder: NotesHomeRecentFolder }
      | { kind: 'template'; template: NotesHomeTemplate }
      | { kind: 'blank' }
      | { kind: 'recent' },
    event: ReactMouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenus();
    setMenuState({ ...next, x: event.clientX, y: event.clientY } as typeof menuState);
  };
  const copyText = async (
    text: string,
    success = 'Link copied.',
    failure = 'Could not copy link.'
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(success, { variant: 'success' });
    } catch {
      toast.show(failure, { variant: 'error' });
    }
  };
  const noteActions = (note: NotesHomeNote): ContextMenuGroup[] => {
    const pinned = notePinById.has(note.id);
    return [
      {
        items: [
          {
            id: 'open',
            label: 'Open',
            icon: <StickyNote size={14} />,
            onClick: () => onOpenNote(note),
          },
          {
            id: 'pin',
            label: pinned ? 'Unpin note' : 'Pin note',
            icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
            onClick: () => void onToggleNotePin(note.id),
          },
          {
            id: 'move-folder',
            label: 'Move to folder',
            icon: <FolderInput size={14} />,
            onClick: () =>
              window.setTimeout(
                () =>
                  setMoveMenuState({
                    kind: 'note',
                    note,
                    x: (menuState?.x ?? 0) + 240,
                    y: menuState?.y ?? 0,
                  }),
                0
              ),
          },
          {
            id: 'link-project',
            label: 'Link to project',
            icon: <Link2 size={14} />,
            onClick: () => onLinkNoteToProject(note.id),
          },
          {
            id: 'duplicate',
            label: 'Duplicate',
            icon: <Copy size={14} />,
            onClick: () => onDuplicateNote(note.id),
          },
          {
            id: 'save-template',
            label: 'Save as template',
            icon: <FilePlus2 size={14} />,
            onClick: () => onSaveNoteAsTemplate(note.id, note.title || 'Untitled note'),
          },
          {
            id: 'copy-link',
            label: 'Copy note link',
            icon: <Link2 size={14} />,
            onClick: () =>
              void copyText(
                `ledger://notes?focusNoteId=${note.id}`,
                'Link copied.',
                'Could not copy note link.'
              ),
          },
        ],
      },
      {
        label: 'More actions',
        items: [
          {
            id: 'rename',
            label: 'Rename',
            icon: <MoreHorizontal size={14} />,
            onClick: () => onRenameNote(note.id),
          },
          {
            id: 'create-child',
            label: 'Create child',
            icon: <FolderPlus size={14} />,
            onClick: () => onCreateChildNote(note.id),
          },
          {
            id: 'move-root',
            label: 'Move to root',
            icon: <FolderInput size={14} />,
            onClick: () => onMoveNoteToRoot(note.id),
          },
          {
            id: 'delete',
            label: 'Delete',
            icon: <Trash2 size={14} />,
            destructive: true,
            onClick: () => onDeleteNote(note.id),
          },
        ],
      },
    ];
  };
  const templateActions = (template: NotesHomeTemplate): ContextMenuGroup[] => {
    const pinned = templatePinById.has(template.id);
    return [
      {
        items: [
          {
            id: 'use',
            label: 'Use template',
            icon: <StickyNote size={14} />,
            onClick: () => onUseTemplate(template.id),
          },
          {
            id: 'preview',
            label: 'Preview',
            icon: <Eye size={14} />,
            onClick: () => onOpenTemplate(template.id),
          },
          {
            id: 'pin',
            label: pinned ? 'Unpin template' : 'Pin template',
            icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
            onClick: () => void onToggleTemplatePin(template),
          },
          {
            id: 'duplicate',
            label: template.is_system ? 'Duplicate to My templates' : 'Duplicate',
            icon: <Copy size={14} />,
            onClick: () => void onDuplicateTemplate(template),
          },
        ],
      },
    ];
  };
  const folderActions = (folder: NotesHomeRecentFolder): ContextMenuGroup[] => {
    const section = folder.section;
    const collapsedFolder = collapsed.has(`folder:${folder.id}`);
    const canCreateChild = Boolean(section);
    const canMove = Boolean(section);
    return [
      {
        items: [
          {
            id: 'open-folder',
            label: collapsedFolder ? 'Expand folder' : 'Collapse folder',
            icon: <Folder size={14} />,
            onClick: () => toggle(`folder:${folder.id}`),
          },
          {
            id: 'new-note',
            label: 'New note here',
            icon: <StickyNote size={14} />,
            onClick: () => onNewNote(section?.id ?? null),
          },
          {
            id: 'create-child-folder',
            label: 'Create child folder',
            icon: <FolderPlus size={14} />,
            hidden: !canCreateChild,
            onClick: () => {
              if (!section) return;
              onCreateChildFolder(section.id);
            },
          },
          {
            id: 'move-folder',
            label: 'Move folder',
            icon: <FolderInput size={14} />,
            hidden: !canMove,
            onClick: () => {
              if (!section) return;
              window.setTimeout(
                () =>
                  setMoveMenuState({
                    kind: 'folder',
                    folder,
                    x: (menuState?.x ?? 0) + 240,
                    y: menuState?.y ?? 0,
                  }),
                0
              );
            },
          },
          {
            id: 'rename-folder',
            label: 'Rename',
            icon: <MoreHorizontal size={14} />,
            hidden: !section,
            onClick: () => {
              if (!section) return;
              onRenameFolder(section.id);
            },
          },
        ],
      },
      {
        items: [
          {
            id: 'delete-folder',
            label: 'Delete',
            icon: <Trash2 size={14} />,
            destructive: true,
            hidden: !section,
            onClick: () => {
              if (!section) return;
              onDeleteFolder(section.id);
            },
          },
        ],
      },
    ];
  };
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const activeMenuGroups =
    menuState?.kind === 'note'
      ? noteActions(menuState.note!)
      : menuState?.kind === 'folder'
      ? folderActions(menuState.folder!)
      : menuState?.kind === 'template'
      ? templateActions(menuState.template!)
      : menuState?.kind === 'blank'
      ? [
          {
            items: [
              {
                id: 'create-blank',
                label: 'Create blank note',
                icon: <StickyNote size={14} />,
                onClick: () => onNewNote(null),
              },
              {
                id: 'create-selected-folder',
                label: 'Create in selected folder',
                icon: <FolderInput size={14} />,
                hidden: !currentSectionId,
                onClick: () => onNewNote(currentSectionId ?? null),
              },
            ],
          },
        ]
      : menuState?.kind === 'recent'
      ? [
          {
            items: [
              {
                id: 'open-recent',
                label: 'Open recent notes',
                icon: <Search size={14} />,
                onClick: () => onViewAllRecent(),
              },
            ],
          },
        ]
      : null;
  const activeMoveGroups = (() => {
    if (!moveMenuState) return null;
    const targetSectionId =
      moveMenuState.kind === 'folder' ? moveMenuState.folder?.section?.id ?? null : null;
    const invalidSectionIds =
      moveMenuState.kind === 'folder' && targetSectionId
        ? new Set([targetSectionId, ...Array.from(descendantSectionIds.get(targetSectionId) ?? [])])
        : new Set<string>();
    const options = sectionMoveTargets.filter(
      (section) => !invalidSectionIds.has(section.id ?? '')
    );
    return options.length
      ? [
          {
            items: options.map((section) => ({
              id: `move-${section.id ?? 'root'}`,
              label: section.label,
              icon: <Folder size={14} />,
              onClick: () => {
                if (moveMenuState.kind === 'note' && moveMenuState.note) {
                  void onMoveNoteToSection(moveMenuState.note.id, section.id);
                } else if (moveMenuState.kind === 'folder' && moveMenuState.folder?.section) {
                  void onMoveFolder(moveMenuState.folder.section.id, section.id);
                }
              },
            })),
          },
        ]
      : null;
  })();

  const dateGroups = useMemo(() => {
    const groups = new Map<string, { label: string; notes: NotesHomeNote[]; timestamp: number }>();
    [...notes]
      .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))
      .forEach((note) => {
        const key = homeDateKey(note.updated_at);
        const existing = groups.get(key);
        if (existing) existing.notes.push(note);
        else
          groups.set(key, {
            label: homeDateLabel(note.updated_at),
            notes: [note],
            timestamp: +new Date(note.updated_at),
          });
      });
    return [...groups.values()].sort((a, b) => b.timestamp - a.timestamp);
  }, [notes]);

  return (
    <div className="relative flex-1 overflow-auto bg-[var(--ledger-surface-card)]">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-8 pb-28 pt-7 sm:px-12">
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => onNewNote(currentSectionId)}
            onContextMenu={(event) => openMenuAt({ kind: 'blank' }, event)}
            className="text-[12px] font-medium text-[var(--ledger-text-secondary)] transition-colors hover:text-[var(--ledger-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)]"
          >
            <Plus size={13} className="mr-1 inline-block" /> New note
          </button>
        </div>
        <div className="mt-9 space-y-8">
          {dateGroups.length ? (
            dateGroups.map((group) => (
              <section key={`${group.label}-${group.timestamp}`}>
                <h2 className="mb-2 px-2 text-[11px] font-medium text-[var(--ledger-text-muted)]">
                  {group.label}
                </h2>
                <div className="space-y-0.5">
                  {group.notes.map((note) => (
                    <NotesHomeListRow
                      key={note.id}
                      note={note}
                      sectionName={sectionName.get(note.section_id ?? '')}
                      active={note.id === activeMeetingNoteId}
                      onClick={() => onOpenNote(note)}
                      onContextMenu={(event) => openMenuAt({ kind: 'note', note }, event)}
                    />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="px-2 py-12 text-[13px] text-[var(--ledger-text-muted)]">
              No notes yet. Create one when you are ready.
            </div>
          )}
        </div>
        {!askLedgerOpen && (
          <div className="relative sticky bottom-5 z-10 mt-auto flex h-28 w-full items-end">
            <form
              className="relative mx-auto flex h-12 w-[min(520px,calc(100%-32px))] items-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] pl-4 pr-1.5 shadow-[var(--ledger-shadow)]"
              onSubmit={(event) => {
                event.preventDefault();
                const question = askQuestion.trim();
                if (!question) return;
                onAskLedger(question);
                setAskQuestion('');
              }}
            >
              <input
                value={askQuestion}
                onChange={(event) => setAskQuestion(event.target.value)}
                className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-[12px] text-[var(--ledger-text-primary)] outline-none ring-0 placeholder:text-[var(--ledger-text-muted)] focus:border-0 focus:outline-none focus:ring-0"
                placeholder="Ask anything…"
                aria-label="Ask Ledger about Notes"
              />
              <button
                type="button"
                onClick={() => setAskQuestion(askSuggestion)}
                className="hidden max-w-[45%] shrink-0 overflow-hidden rounded-full bg-[var(--ledger-surface-hover)] px-3 py-2 text-[11px] text-[var(--ledger-text-secondary)] transition hover:text-[var(--ledger-text-primary)] sm:block"
              >
                <span key={askSuggestion} className="ledger-meeting-suggestion block truncate">
                  {askSuggestion}
                </span>
              </button>
              <button
                type="submit"
                disabled={!askQuestion.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ledger-accent)] text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Ask Ledger"
              >
                <ChevronRight size={15} />
              </button>
            </form>
          </div>
        )}
        {activeMenuGroups && menuState && (
          <ContextMenu
            open
            x={menuState.x}
            y={menuState.y}
            width={244}
            groups={activeMenuGroups}
            onClose={closeMenus}
            ariaLabel="Notes home actions"
          />
        )}
        {activeMoveGroups && moveMenuState && (
          <ContextMenu
            open
            x={moveMenuState.x}
            y={moveMenuState.y}
            width={272}
            groups={activeMoveGroups}
            onClose={closeMenus}
            ariaLabel="Move to folder"
          />
        )}
      </div>
    </div>
  );
};

export default NotesHome;
