import {
  BookOpen,
  Briefcase,
  CalendarDays,
  ChevronDown,
  Copy,
  Eye,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  FolderKanban,
  Link2,
  Lightbulb,
  MoreHorizontal,
  Plus,
  Search,
  Pin,
  PinOff,
  StickyNote,
  Trash2,
  Users,
  FilePlus2,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { ContextMenu, type ContextMenuGroup } from '../Common/ContextMenu';
import { useToast } from '../Common/ToastProvider';
import type { PinRecord } from '../../utils/pins';

export type NotesHomeNote = {
  id: string;
  title: string;
  content: string;
  section_id?: string | null;
  parent_id?: string | null;
  updated_at: string;
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
  onOpenNote: (note: NotesHomeNote) => void;
  onNewNote: (sectionId?: string | null) => void;
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

const relativeTime = (value: string) => {
  const age = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(age / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const uncheckedActions = (content: string) => {
  const html = String(content ?? '');
  const matches = html.match(/(?:\[ \]|☐|data-checked=["']false["'])/gi);
  return matches?.length ?? 0;
};

const HomeSection = ({
  id,
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) => (
  <section className="overflow-hidden">
    <div
      role="button"
      tabIndex={0}
      onClick={() => onToggle(id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle(id);
        }
      }}
      className="flex h-8 cursor-pointer select-none items-center justify-between rounded-lg bg-[var(--ledger-surface-muted)] px-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ChevronDown
          size={14}
          className={`shrink-0 text-[var(--ledger-text-muted)] transition ${
            collapsed ? '-rotate-90' : ''
          }`}
        />
        <span className="truncate text-[12px] font-medium text-[var(--ledger-text-secondary)]">
          {title}
        </span>
        <span className="rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--ledger-text-muted)]">
          {count}
        </span>
      </div>
    </div>
    {!collapsed && <div className="space-y-0.5 pb-1 pt-1">{children}</div>}
  </section>
);

const ResourceRow = ({
  icon,
  title,
  meta,
  end,
  tone = 'default',
  onClick,
  onContextMenu,
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
  end?: string;
  tone?: 'default' | 'attention' | 'pinned';
  onClick?: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    onContextMenu={onContextMenu}
    className="group grid min-h-10 w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-3 py-1.5 text-left transition hover:bg-[var(--ledger-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)]"
  >
    <span
      className={`relative flex h-6 w-6 items-center justify-center rounded-md border bg-[var(--ledger-surface-card)] text-[13px] ${
        tone === 'attention'
          ? 'border-[color:var(--ledger-accent)] text-[var(--ledger-accent)]'
          : tone === 'pinned'
          ? 'border-[color:var(--ledger-border-strong)] text-[var(--ledger-accent)]'
          : 'border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-secondary)]'
      }`}
    >
      {icon}
      {tone === 'attention' && (
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[color:var(--ledger-surface-card)] bg-[var(--ledger-accent)] text-[8px] font-semibold leading-none text-white">
          !
        </span>
      )}
    </span>
    <span className="min-w-0 truncate text-[13px] font-medium text-[var(--ledger-text-primary)]">
      {title}
    </span>
    <span className="flex min-w-0 items-center gap-2">
      {meta && (
        <span className="hidden max-w-52 truncate text-[11px] leading-4 text-[var(--ledger-text-muted)] sm:inline">
          {meta}
        </span>
      )}
      {end && (
        <span className="shrink-0 text-[11px] leading-4 text-[var(--ledger-text-muted)]">
          {end}
        </span>
      )}
    </span>
  </button>
);

const TemplateTypeIcon = ({ template }: { template: NotesHomeTemplate }) => {
  const category = String(template.category ?? 'personal').toLowerCase();
  if (category === 'meeting') return <CalendarDays size={13} />;
  if (category === 'internship') return <Briefcase size={13} />;
  if (category === 'team') return <Users size={13} />;
  if (category === 'project') return <FolderKanban size={13} />;
  if (category === 'reading') return <BookOpen size={13} />;
  if (template.name.toLowerCase().includes('reflection')) return <Lightbulb size={13} />;
  return <FileText size={13} />;
};

const TemplateLauncher = ({
  templates,
  onNewNote,
  onBrowseTemplates,
  onOpenTemplate,
  onNewNoteContextMenu,
  onTemplateContextMenu,
}: {
  templates: NotesHomeTemplate[];
  onNewNote: () => void;
  onBrowseTemplates: () => void;
  onOpenTemplate: (templateId: string) => void;
  onNewNoteContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onTemplateContextMenu: (template: NotesHomeTemplate, event: ReactMouseEvent<HTMLButtonElement>) => void;
}) => (
  <div className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-2">
    <div className="flex gap-1.5 overflow-x-auto pb-2">
      <button
        type="button"
        onClick={onNewNote}
        onContextMenu={onNewNoteContextMenu}
        className="group flex h-[76px] min-w-[124px] flex-1 basis-0 flex-col justify-between rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-2.5 text-left transition hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-accent)]">
          <Plus size={14} />
        </span>
        <span className="mt-auto block w-full truncate text-[12px] font-medium text-[var(--ledger-text-primary)]">
          New note
        </span>
      </button>
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => onOpenTemplate(template.id)}
          onContextMenu={(event) => onTemplateContextMenu(template, event)}
          className="group flex h-[76px] min-w-[124px] flex-1 basis-0 flex-col justify-between rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-2.5 text-left transition hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)]"
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] ${
              template.pinned
                ? 'text-[var(--ledger-accent)]'
                : 'text-[var(--ledger-text-secondary)]'
            }`}
          >
            <TemplateTypeIcon template={template} />
          </span>
          <span className="mt-auto block w-full min-w-0">
            <span className="block max-w-full truncate text-[12px] font-medium text-[var(--ledger-text-primary)]">
              {template.name}
            </span>
            {!template.is_system && (
              <span className="block truncate text-[10px] text-[var(--ledger-text-muted)]">
                {template.pinned ? 'Pinned' : 'Recent'}
              </span>
            )}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onBrowseTemplates}
        className="group flex h-[76px] min-w-[124px] flex-1 basis-0 flex-col justify-between rounded-lg border border-dashed border-[color:var(--ledger-border-subtle)] bg-transparent p-2.5 text-left transition hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-secondary)]">
          <Search size={13} />
        </span>
        <span className="mt-auto block w-full truncate text-[12px] font-medium text-[var(--ledger-text-primary)]">
          View all templates
        </span>
      </button>
    </div>
  </div>
);

export const NotesHome = ({
  notes,
  sections,
  templates,
  pins,
  workspaceId,
  userId,
  currentSectionId,
  onOpenNote,
  onNewNote,
  onBrowseTemplates,
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
  const recent = useMemo(
    () => [...notes].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)).slice(0, 7),
    [notes]
  );
  const pinned = useMemo(() => {
    const ids = new Set(
      pins.filter((pin) => pin.object_type === 'note').map((pin) => pin.object_id)
    );
    return notes
      .filter((note) => ids.has(note.id))
      .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
  }, [notes, pins]);
  const attention = useMemo(
    () =>
      notes
        .map((note) => ({ note, count: uncheckedActions(note.content) }))
        .filter((item) => item.count > 0)
        .slice(0, 7),
    [notes]
  );
  const recentFolders = useMemo(() => {
    const groups = new Map<string, NotesHomeNote[]>();
    recent.forEach((note) => {
      const id = note.section_id ?? '__unsorted__';
      groups.set(id, [...(groups.get(id) ?? []), note]);
    });
    return [...groups.entries()].slice(0, 5).map(([id, folderNotes]) => ({
      id,
      name: id === '__unsorted__' ? 'Unsorted' : sectionName.get(id) ?? 'Folder',
      section: id === '__unsorted__' ? null : sections.find((section) => section.id === id) ?? null,
      notes: folderNotes.slice(0, 3),
    }));
  }, [recent, sectionName, sections]);

  useEffect(() => {
    const key = storageKey(workspaceId, userId);
    if (
      hasStoredCollapsedStateRef.current ||
      folderDefaultsAppliedRef.current === key ||
      recentFolders.length === 0
    ) {
      return;
    }

    folderDefaultsAppliedRef.current = key;
    setCollapsed((current) => {
      const next = new Set(current);
      recentFolders.forEach((folder) => next.add(`folder:${folder.id}`));
      return next;
    });
  }, [recentFolders, userId, workspaceId]);
  const templateShortcuts = useMemo(() => {
    const ranked = [...templates].sort((a, b) => {
      const rank = (template: NotesHomeTemplate) => {
        if (template.pinned) return 0;
        if (template.last_used_at || (template.usage_count ?? 0) > 0) return 1;
        if (template.is_system && template.category?.toLowerCase() === 'team') return 2;
        if (template.is_system) return 3;
        return 4;
      };
      return (
        rank(a) - rank(b) ||
        +new Date(b.last_used_at ?? 0) - +new Date(a.last_used_at ?? 0) ||
        (b.usage_count ?? 0) - (a.usage_count ?? 0) ||
        a.name.localeCompare(b.name)
      );
    });
    const seen = new Set<string>();
    return ranked
      .filter((template) => {
        const key = template.name.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
  }, [templates]);
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
  const [menuState, setMenuState] = useState<
    | null
    | {
        kind: 'note' | 'folder' | 'template' | 'blank' | 'recent';
        x: number;
        y: number;
        note?: NotesHomeNote;
        folder?: NotesHomeRecentFolder;
        template?: NotesHomeTemplate;
      }
  >(null);
  const [moveMenuState, setMoveMenuState] = useState<
    | null
    | {
        kind: 'note' | 'folder';
        x: number;
        y: number;
        note?: NotesHomeNote;
        folder?: NotesHomeRecentFolder;
      }
  >(null);
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
  const copyText = async (text: string, success = 'Link copied.', failure = 'Could not copy link.') => {
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
  const row = (
    note: NotesHomeNote,
    end?: string,
    tone: 'default' | 'attention' | 'pinned' = 'default'
  ) => (
    <ResourceRow
      key={note.id}
      icon={<FileText size={14} />}
      title={note.title || 'Untitled note'}
      meta={sectionName.get(note.section_id ?? '') ?? 'Unsorted'}
      end={end ?? relativeTime(note.updated_at)}
      tone={tone}
      onClick={() => onOpenNote(note)}
      onContextMenu={(event) => openMenuAt({ kind: 'note', note }, event)}
    />
  );
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
    const options = sectionMoveTargets.filter((section) => !invalidSectionIds.has(section.id ?? ''));
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

  if (notes.length === 0) {
    return (
      <div className="flex-1 overflow-auto bg-[var(--ledger-surface-card)] p-6">
        <div className="border-b border-[color:var(--ledger-border-subtle)] pb-4">
          <h1 className="text-lg font-semibold text-[var(--ledger-text-primary)]">Notes Home</h1>
          <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
            Start writing in this workspace.
          </p>
        </div>
        <div className="mt-4 space-y-2">
          <p className="text-[12px] font-medium text-[var(--ledger-text-secondary)]">
            Start a note
          </p>
          <TemplateLauncher
            templates={templateShortcuts}
            onNewNote={() => onNewNote(currentSectionId)}
            onBrowseTemplates={onBrowseTemplates}
            onOpenTemplate={onOpenTemplate}
            onNewNoteContextMenu={(event) => openMenuAt({ kind: 'blank' }, event)}
            onTemplateContextMenu={(template, event) =>
              openMenuAt({ kind: 'template', template }, event)
            }
          />
        </div>
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
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-[var(--ledger-surface-card)]">
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="border-b border-[color:var(--ledger-border-subtle)] pb-4">
          <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
            Everything happening across your notes in the active workspace.
          </p>
          <p className="mt-3 text-xs text-[var(--ledger-text-muted)]">
            {notes.length} notes ·{' '}
            {notes.filter((note) => Date.now() - +new Date(note.updated_at) < 604800000).length}{' '}
            updated this week · {pinned.length} pinned
          </p>
        </div>
        <div className="space-y-2">
          <TemplateLauncher
            templates={templateShortcuts}
            onNewNote={() => onNewNote(currentSectionId)}
            onBrowseTemplates={onBrowseTemplates}
            onOpenTemplate={onOpenTemplate}
            onNewNoteContextMenu={(event) => openMenuAt({ kind: 'blank' }, event)}
            onTemplateContextMenu={(template, event) =>
              openMenuAt({ kind: 'template', template }, event)
            }
          />
        </div>
        <div className="space-y-1.5">
          <HomeSection
            id="continue"
            title="Continue writing"
            count={recent.length}
            collapsed={collapsed.has('continue')}
            onToggle={toggle}
          >
            {recent.map((note) => row(note))}
            {notes.length > recent.length && (
              <ResourceRow
                icon={<Search size={14} />}
                title="View all recent notes"
                onClick={onViewAllRecent}
                onContextMenu={(event) => openMenuAt({ kind: 'recent' }, event)}
              />
            )}
          </HomeSection>
          {attention.length > 0 && (
            <HomeSection
              id="attention"
              title="Needs attention"
              count={attention.length}
              collapsed={collapsed.has('attention')}
              onToggle={toggle}
            >
              {attention.map(({ note, count }) =>
                row(note, `${count} unchecked action${count === 1 ? '' : 's'}`, 'attention')
              )}
            </HomeSection>
          )}
          {pinned.length > 0 && (
            <HomeSection
              id="pinned"
              title="Pinned notes"
              count={pinned.length}
              collapsed={collapsed.has('pinned')}
              onToggle={toggle}
            >
              {pinned.slice(0, 7).map((note) => row(note, undefined, 'pinned'))}
            </HomeSection>
          )}
          {recentFolders.length > 0 && (
            <HomeSection
              id="folders"
              title="Recent by folder"
              count={recentFolders.length}
              collapsed={collapsed.has('folders')}
              onToggle={toggle}
            >
              {recentFolders.map((folder) => (
                <div key={folder.id} className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => toggle(`folder:${folder.id}`)}
                    onContextMenu={(event) => openMenuAt({ kind: 'folder', folder }, event)}
                    className={`flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-muted)] focus:outline-none ${
                      collapsed.has(`folder:${folder.id}`) ? '' : 'bg-[var(--ledger-surface-muted)]'
                    }`}
                    aria-expanded={!collapsed.has(`folder:${folder.id}`)}
                  >
                    <ChevronDown
                      size={13}
                      className={`shrink-0 text-[var(--ledger-text-muted)] transition ${
                        collapsed.has(`folder:${folder.id}`) ? '-rotate-90' : ''
                      }`}
                    />
                    <Folder size={13} className="text-[var(--ledger-text-muted)]" />
                    {folder.name}
                    <span className="text-[var(--ledger-text-muted)]">{folder.notes.length}</span>
                  </button>
                  {!collapsed.has(`folder:${folder.id}`) && (
                    <div className="space-y-0.5">{folder.notes.map((note) => row(note))}</div>
                  )}
                </div>
              ))}
            </HomeSection>
          )}
        </div>
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
