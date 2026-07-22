import { Check, CalendarDays, Folder, StickyNote, FileImage, ListChecks, Loader2, Search } from 'lucide-react';
import { ModalOverlay } from '../Common/ModalOverlay';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { FigmaMark } from '../Common/FigmaMark';
import { IntegrationProviderMark } from '../Common/IntegrationProviderMark';

export type LinkedContextSource = 'notes' | 'projects' | 'calendar' | 'tasks' | 'figma' | 'github' | 'slack';
export type LinkedContextMode = 'paste' | 'existing';

export type LinkedContextNote = {
  id: string;
  title: string;
  preview: string;
};

export type LinkedCalendarItem = {
  id: string;
  title: string;
  kind: 'event' | 'reminder';
  startsAt: string;
  endsAt?: string | null;
  status?: string | null;
  calendarName?: string | null;
  projectName?: string | null;
};

export type LinkedTask = {
  id: string;
  title: string;
  status?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  assignee?: string | null;
  projectName?: string | null;
};

export type LinkedContextReference = {
  id: string;
  provider?: string;
  external_type?: string;
  metadata?: Record<string, unknown>;
};

export type LinkedSlackContext = {
  id: string;
  slack_channel_name?: string | null;
  message_text?: string | null;
  message_author_name?: string | null;
  permalink?: string | null;
  message_created_at?: string | null;
  captured_at?: string | null;
};

const SlackSourceIcon = ({ size = 14 }: { size?: number }) => <IntegrationProviderMark provider="slack" size={size} />;

type Repository = {
  github_repository_id: string;
  full_name: string;
  owner_login: string;
  name: string;
  is_private?: boolean;
  is_archived?: boolean;
  default_branch?: string | null;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  source: LinkedContextSource;
  onSourceChange: (source: LinkedContextSource) => void;
  hiddenSources?: LinkedContextSource[];
  notes?: LinkedContextNote[];
  isLoadingNotes?: boolean;
  selectedNoteIds?: string[];
  onToggleNote?: (noteId: string) => void;
  onLinkNotes?: (noteIds: string[]) => void | Promise<void>;
  projects?: Array<{ id: string; name: string; status?: string | null; completeness?: number | null; end_date?: string | null }>;
  isLoadingProjects?: boolean;
  selectedProjectIds?: string[];
  onToggleProject?: (projectId: string) => void;
  onLinkProjects?: (projectIds: string[]) => void | Promise<void>;
  calendarItems?: LinkedCalendarItem[];
  selectedCalendarItemIds?: string[];
  onToggleCalendarItem?: (itemId: string) => void;
  onLinkCalendarItems?: (itemIds: string[]) => void | Promise<void>;
  tasks?: LinkedTask[];
  isLoadingTasks?: boolean;
  selectedTaskIds?: string[];
  onToggleTask?: (taskId: string) => void;
  onLinkTasks?: (taskIds: string[]) => void | Promise<void>;
  slackContexts?: LinkedSlackContext[];
  isLoadingSlackContexts?: boolean;
  selectedSlackContextIds?: string[];
  onToggleSlackContext?: (contextId: string) => void;
  onLinkSlackContexts?: (contextIds: string[]) => void | Promise<void>;
  onOpenSlackContext?: (context: LinkedSlackContext) => void;
  query: string;
  onQueryChange: (value: string) => void;
  mode: LinkedContextMode;
  onModeChange: (mode: LinkedContextMode) => void;
  url: string;
  onUrlChange: (value: string) => void;
  existing: LinkedContextReference[];
  githubRepositories: Repository[];
  githubRepositoryId: string;
  onGithubRepositoryChange: (value: string) => void;
  busyId: string | null;
  onPasteLink: () => void | Promise<void>;
  onLinkReference: (reference: LinkedContextReference) => void | Promise<void>;
  selectedReferenceId?: string | null;
  onLinkSelectedReference?: (reference: LinkedContextReference) => void | Promise<void>;
  onLinkRepository: (repository: Repository) => void | Promise<void>;
  resourceTitle: (reference: LinkedContextReference) => string;
  resourceMeta: (reference: LinkedContextReference) => string;
};

const sourceGroups = [
  { label: 'Ledger', items: [{ id: 'notes' as const, label: 'Notes', icon: StickyNote }, { id: 'projects' as const, label: 'Projects', icon: Folder }, { id: 'calendar' as const, label: 'Calendar', icon: CalendarDays }, { id: 'tasks' as const, label: 'Tasks', icon: ListChecks }] },
  {
    label: 'Integrations',
    items: [
      { id: 'figma' as const, label: 'Figma', icon: FigmaMark },
      { id: 'github' as const, label: 'GitHub', icon: null },
      { id: 'slack' as const, label: 'Slack', icon: SlackSourceIcon },
    ],
  },
];

export function AddLinkedContextModal({
  isOpen,
  onClose,
  source,
  onSourceChange,
  hiddenSources = [],
  notes = [],
  isLoadingNotes = false,
  selectedNoteIds = [],
  onToggleNote,
  onLinkNotes,
  projects = [],
  isLoadingProjects = false,
  selectedProjectIds = [],
  onToggleProject,
  onLinkProjects,
  calendarItems = [],
  selectedCalendarItemIds = [],
  onToggleCalendarItem,
  onLinkCalendarItems,
  tasks = [],
  isLoadingTasks = false,
  selectedTaskIds = [],
  onToggleTask,
  onLinkTasks,
  slackContexts = [],
  isLoadingSlackContexts = false,
  selectedSlackContextIds = [],
  onToggleSlackContext,
  onLinkSlackContexts,
  onOpenSlackContext,
  query,
  onQueryChange,
  mode,
  onModeChange,
  url,
  onUrlChange,
  existing,
  githubRepositories,
  githubRepositoryId,
  onGithubRepositoryChange,
  busyId,
  onPasteLink,
  onLinkReference,
  selectedReferenceId = null,
  onLinkSelectedReference,
  onLinkRepository,
  resourceTitle,
  resourceMeta,
}: Props) {
  const visibleSourceGroups = sourceGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => !hiddenSources.includes(item.id)) }))
    .filter((group) => group.items.length > 0);
  const selectedCount = source === 'notes' ? selectedNoteIds.length : source === 'projects' ? selectedProjectIds.length : source === 'calendar' ? selectedCalendarItemIds.length : source === 'tasks' ? selectedTaskIds.length : source === 'slack' ? selectedSlackContextIds.length : 0;
  const primaryLabel =
    source === 'notes'
      ? selectedCount === 0
        ? 'Link selected'
        : `Link ${selectedCount} note${selectedCount === 1 ? '' : 's'}`
      : source === 'projects'
        ? selectedCount === 0 ? 'Link selected' : `Link ${selectedCount} project${selectedCount === 1 ? '' : 's'}`
      : source === 'calendar'
        ? selectedCount === 0
          ? 'Link selected'
          : selectedCount === 1
            ? `Link ${calendarItems.find((item) => selectedCalendarItemIds.includes(item.id))?.kind ?? 'calendar item'}`
            : `Link ${selectedCount} calendar items`
      : source === 'tasks'
        ? selectedCount === 0 ? 'Link selected' : `Link ${selectedCount} task${selectedCount === 1 ? '' : 's'}`
      : source === 'slack'
        ? selectedCount === 0 ? 'Link selected' : `Link ${selectedCount} Slack context${selectedCount === 1 ? '' : 's'}`
      : source === 'figma'
        ? mode === 'paste'
          ? 'Add Figma link'
          : 'Link selected'
        : githubRepositoryId
          ? 'Link repository'
          : 'Link selected';

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      backdropBorderRadius="inherit"
      disablePortal
      manageWindowChrome={false}
      classNameContainer="w-full max-w-[760px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
    >
      <div className="flex h-[min(620px,calc(100vh-48px))] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--ledger-text-primary)]">Add linked context</h2>
            <p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Connect Ledger content and external resources.</p>
          </div>
          <ModalCloseButton onClick={onClose} ariaLabel="Close add linked context modal" />
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="hidden w-44 shrink-0 border-r border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] p-3 sm:block" aria-label="Linked context sources">
            {visibleSourceGroups.map((group) => (
              <div key={group.label} className="mb-5 last:mb-0">
                <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ledger-text-muted)]">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button key={item.id} type="button" onClick={() => onSourceChange(item.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition ${source === item.id ? 'bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-sm' : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]'}`}>
                        {Icon ? <Icon size={14} /> : <img src="/github-mark.svg" alt="" className="h-3.5 w-3.5" />}
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-[color:var(--ledger-border-subtle)] p-4 sm:hidden">
              <label className="sr-only" htmlFor="linked-context-source">Source</label>
              <select id="linked-context-source" value={source} onChange={(event) => onSourceChange(event.target.value as LinkedContextSource)} className="h-9 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-sm text-[var(--ledger-text-primary)]">
                {!hiddenSources.includes('notes') && <option value="notes">Ledger · Notes</option>}
                {!hiddenSources.includes('projects') && <option value="projects">Ledger · Projects</option>}
                {!hiddenSources.includes('calendar') && <option value="calendar">Ledger · Calendar</option>}
                {!hiddenSources.includes('tasks') && <option value="tasks">Ledger · Tasks</option>}
                <option value="figma">Integrations · Figma</option>
                <option value="github">Integrations · GitHub</option>
                <option value="slack">Integrations · Slack</option>
              </select>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {source === 'slack' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-lg border border-[color:var(--ledger-border-subtle)] px-3"><Search size={14} className="text-[var(--ledger-text-muted)]" /><input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search captured Slack messages" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>
                  <div className="overflow-hidden rounded-lg bg-[var(--ledger-surface-muted)]">
                    {isLoadingSlackContexts ? <p className="p-4 text-sm text-[var(--ledger-text-muted)]">Loading Slack context…</p> : slackContexts.filter((context) => `${context.message_text ?? ''} ${context.message_author_name ?? ''} ${context.slack_channel_name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())).map((context) => {
                      const selected = selectedSlackContextIds.includes(context.id);
                      return <div key={context.id} className={`flex w-full items-start gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 last:border-b-0 hover:bg-[var(--ledger-surface-hover)] ${selected ? 'bg-[color:rgba(255,95,64,0.06)]' : ''}`}><button type="button" onClick={() => onToggleSlackContext?.(context.id)} disabled={Boolean(busyId)} className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--ledger-border-subtle)]">{selected && <Check size={11} className="text-[var(--ledger-accent)]" />}</button><button type="button" onClick={() => onOpenSlackContext?.(context)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">{context.message_author_name || 'Slack member'}{context.slack_channel_name ? ` · #${context.slack_channel_name}` : ''}</span><span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ledger-text-muted)]">{context.message_text || 'Slack message'}</span></button></div>;
                    })}
                    {!isLoadingSlackContexts && slackContexts.length === 0 && <p className="p-4 text-sm text-[var(--ledger-text-muted)]">No captured Slack context yet.</p>}
                  </div>
                </div>
              ) : source === 'tasks' ? (
                <div className="space-y-3">
                  <input autoFocus type="search" value={query.replace(/^__task_filter__:[^ ]* ?/, '')} onChange={(event) => { const filter = query.match(/^__task_filter__:(all|open|completed)/)?.[1] ?? 'all'; onQueryChange(filter === 'all' ? event.target.value : `__task_filter__:${filter} ${event.target.value}`); }} placeholder="Search tasks" className="h-10 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[var(--ledger-border-strong)]" />
                  <div className="flex gap-1 rounded-lg bg-[var(--ledger-surface-muted)] p-1">{(['all', 'open', 'completed'] as const).map((filter) => <button key={filter} type="button" onClick={() => onQueryChange(filter === 'all' ? query.replace(/^__task_filter__:[^ ]* ?/, '') : `__task_filter__:${filter} ${query.replace(/^__task_filter__:[^ ]* ?/, '')}`)} className="flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">{filter === 'all' ? 'All' : filter === 'open' ? 'Open' : 'Completed'}</button>)}</div>
                  <div className="overflow-hidden rounded-lg bg-[var(--ledger-surface-muted)]">
                    {isLoadingTasks ? <p className="p-4 text-sm text-[var(--ledger-text-muted)]">Loading tasks…</p> : tasks.filter((task) => { const filter = query.match(/^__task_filter__:(all|open|completed)/)?.[1] ?? 'all'; const text = `${task.title} ${task.assignee ?? ''} ${task.projectName ?? ''}`.toLowerCase(); return (filter === 'all' || (filter === 'completed' ? task.status === 'completed' : task.status !== 'completed')) && text.includes(query.replace(/^__task_filter__:[^ ]* ?/, '').trim().toLowerCase()); }).map((task) => { const selected = selectedTaskIds.includes(task.id); const completed = task.status === 'completed'; return <button key={task.id} type="button" onClick={() => onToggleTask?.(task.id)} disabled={Boolean(busyId)} className={`flex w-full items-start gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 text-left last:border-b-0 hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50 ${completed ? 'opacity-70' : ''}`}><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-[var(--ledger-accent)] bg-[color:rgba(255,95,64,0.14)]' : 'border-[var(--ledger-border-subtle)]'}`}>{selected && <Check size={11} className="text-[var(--ledger-accent)]" />}</span><span className="min-w-0 flex-1"><span className={`block truncate text-sm font-medium text-[var(--ledger-text-primary)] ${completed ? 'line-through' : ''}`}>{task.title}</span><span className="block truncate text-xs text-[var(--ledger-text-muted)]">{completed ? 'Completed' : 'Open'}{task.dueDate ? ` · Due ${task.dueDate}` : ''}{task.assignee ? ` · ${task.assignee}` : ''}{task.projectName ? ` · ${task.projectName}` : ''}</span></span></button>; })}
                    {!isLoadingTasks && tasks.length === 0 && <p className="p-4 text-sm text-[var(--ledger-text-muted)]">No matching tasks.</p>}
                  </div>
                </div>
              ) : source === 'calendar' ? (
                <div className="space-y-3">
                  <input autoFocus type="search" value={query.replace(/^__calendar_filter__:[^ ]* ?/, '')} onChange={(event) => { const filter = query.match(/^__calendar_filter__:(all|event|reminder)/)?.[1] ?? 'all'; onQueryChange(filter === 'all' ? event.target.value : `__calendar_filter__:${filter} ${event.target.value}`); }} placeholder="Search events and reminders" className="h-10 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[var(--ledger-border-strong)]" />
                  <div className="flex gap-1 rounded-lg bg-[var(--ledger-surface-muted)] p-1">
                    {(['all', 'event', 'reminder'] as const).map((filter) => <button key={filter} type="button" onClick={() => onQueryChange(filter === 'all' ? query.replace(/^__calendar_filter__:[^ ]* ?/, '') : `__calendar_filter__:${filter} ${query.replace(/^__calendar_filter__:[^ ]* ?/, '')}`)} className="flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">{filter === 'all' ? 'All' : filter === 'event' ? 'Events' : 'Reminders'}</button>)}
                  </div>
                  <div className="overflow-hidden rounded-lg bg-[var(--ledger-surface-muted)]">
                    {calendarItems.filter((item) => {
                      const normalized = query.replace(/^__calendar_filter__:[^ ]* ?/, '').trim().toLowerCase();
                      const filter = query.match(/^__calendar_filter__:(all|event|reminder)/)?.[1] ?? 'all';
                      return (filter === 'all' || item.kind === filter) && `${item.title} ${item.calendarName ?? ''} ${item.projectName ?? ''}`.toLowerCase().includes(normalized);
                    }).map((item) => {
                      const selected = selectedCalendarItemIds.includes(item.id);
                      return <button key={item.id} type="button" onClick={() => onToggleCalendarItem?.(item.id)} disabled={Boolean(busyId)} className="flex w-full items-start gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 text-left last:border-b-0 hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-[var(--ledger-accent)] bg-[color:rgba(255,95,64,0.14)]' : 'border-[var(--ledger-border-subtle)]'}`}>{selected && <Check size={11} className="text-[var(--ledger-accent)]" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">{item.title}</span><span className="block truncate text-xs text-[var(--ledger-text-muted)]">{new Date(item.startsAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {item.kind === 'event' ? 'Event' : 'Reminder'}{item.calendarName ? ` · ${item.calendarName}` : ''}{item.projectName ? ` · ${item.projectName}` : ''}</span></span></button>;
                    })}
                    {calendarItems.length === 0 && <p className="p-4 text-sm text-[var(--ledger-text-muted)]">No matching events or reminders.</p>}
                  </div>
                </div>
              ) : source === 'projects' ? (
                <div className="space-y-3">
                  <input autoFocus type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search projects" className="h-10 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[var(--ledger-border-strong)]" />
                  <p className="text-xs text-[var(--ledger-text-muted)]">Select one or more active projects to link to this note.</p>
                  <div className="overflow-hidden rounded-lg bg-[var(--ledger-surface-muted)]">
                    {isLoadingProjects ? <p className="p-4 text-sm text-[var(--ledger-text-muted)]">Loading projects…</p> : projects.filter((project) => `${project.name} ${project.status ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())).map((project) => {
                      const selected = selectedProjectIds.includes(project.id);
                      return <button key={project.id} type="button" onClick={() => onToggleProject?.(project.id)} disabled={Boolean(busyId)} className="flex w-full items-center gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 text-left last:border-b-0 hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-[var(--ledger-accent)] bg-[color:rgba(255,95,64,0.14)]' : 'border-[var(--ledger-border-subtle)]'}`}>{selected && <Check size={11} className="text-[var(--ledger-accent)]" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">{project.name}</span><span className="block truncate text-xs capitalize text-[var(--ledger-text-muted)]">{String(project.status ?? 'active').split('_').join(' ')}{typeof project.completeness === 'number' ? ` · ${Math.round(project.completeness)}%` : ''}{project.end_date ? ` · Due ${project.end_date}` : ''}</span></span></button>;
                    })}
                    {!isLoadingProjects && projects.length === 0 && <p className="p-4 text-sm text-[var(--ledger-text-muted)]">No active projects found.</p>}
                  </div>
                </div>
              ) : source === 'notes' ? (
                <div className="space-y-3">
                  <input autoFocus type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search notes" className="h-10 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[var(--ledger-border-strong)]" />
                  <p className="text-xs text-[var(--ledger-text-muted)]">Select one or more notes to link here.</p>
                  <div className="overflow-hidden rounded-lg bg-[var(--ledger-surface-muted)]">
                    {isLoadingNotes ? <p className="p-4 text-sm text-[var(--ledger-text-muted)]">Loading notes…</p> : notes.length === 0 ? <p className="p-4 text-sm text-[var(--ledger-text-muted)]">No available notes to link.</p> : notes.filter((note) => `${note.title} ${note.preview}`.toLowerCase().includes(query.trim().toLowerCase())).map((note) => {
                      const selected = selectedNoteIds.includes(note.id);
                      return <button key={note.id} type="button" onClick={() => onToggleNote?.(note.id)} disabled={Boolean(busyId)} className="flex w-full items-start gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 text-left last:border-b-0 hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-[var(--ledger-accent)] bg-[color:rgba(255,95,64,0.14)]' : 'border-[var(--ledger-border-subtle)]'}`}>{selected && <Check size={11} className="text-[var(--ledger-accent)]" />}</span><span className="min-w-0"><span className="block truncate text-sm font-medium text-[var(--ledger-text-primary)]">{note.title}</span><span className="block truncate text-xs text-[var(--ledger-text-muted)]">{note.preview || 'No content'}</span></span></button>;
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {source === 'figma' && <div className="flex rounded-lg bg-[var(--ledger-surface-muted)] p-1">
                    <button type="button" onClick={() => onModeChange('paste')} className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${mode === 'paste' ? 'bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-sm' : 'text-[var(--ledger-text-muted)]'}`}>Paste link</button>
                    <button type="button" onClick={() => onModeChange('existing')} className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${mode === 'existing' ? 'bg-[var(--ledger-surface-card)] text-[var(--ledger-text-primary)] shadow-sm' : 'text-[var(--ledger-text-muted)]'}`}>Search</button>
                  </div>}
                  {source === 'figma' && mode === 'paste' ? <div className="space-y-2"><label className="text-xs text-[var(--ledger-text-muted)]" htmlFor="external-link-input">Paste a Figma link</label><input id="external-link-input" value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder="https://figma.com/design/..." className="h-10 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-transparent px-3 text-sm outline-none focus:border-[var(--ledger-border-strong)]" /></div> : <div className="space-y-3">
                    {source === 'github' ? <><input autoFocus type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search approved repositories" className="h-10 w-full rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 text-sm outline-none focus:border-[var(--ledger-border-strong)]" /><div className="overflow-hidden rounded-lg bg-[var(--ledger-surface-muted)]">{githubRepositories.filter((repo) => `${repo.full_name} ${repo.owner_login}`.toLowerCase().includes(query.trim().toLowerCase())).map((repo) => <button key={repo.github_repository_id} type="button" onClick={() => onGithubRepositoryChange(repo.github_repository_id)} className={`flex w-full items-center gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 text-left last:border-b-0 hover:bg-[var(--ledger-surface-hover)] ${githubRepositoryId === repo.github_repository_id ? 'bg-[color:rgba(255,95,64,0.08)]' : ''}`}><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--ledger-surface-card)]"><img src="/github-mark.svg" alt="" className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{repo.full_name}</span><span className="block text-xs text-[var(--ledger-text-muted)]">{repo.is_private ? 'Private' : 'Approved repository'}{repo.default_branch ? ` · ${repo.default_branch}` : ''}</span></span><span className={`h-4 w-4 rounded-full border ${githubRepositoryId === repo.github_repository_id ? 'border-[var(--ledger-accent)] bg-[var(--ledger-accent)]' : 'border-[var(--ledger-border-subtle)]'}`} /></button>)}</div></> : <><div className="flex items-center gap-2 rounded-lg border border-[color:var(--ledger-border-subtle)] px-3"><Search size={14} className="text-[var(--ledger-text-muted)]" /><input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search files or nodes" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></div><div className="rounded-lg bg-[var(--ledger-surface-muted)]">{existing.map((reference) => <button key={reference.id} type="button" onClick={() => void onLinkReference(reference)} className="flex w-full items-center gap-3 border-b border-[color:var(--ledger-border-subtle)] px-3 py-3 text-left last:border-b-0 hover:bg-[var(--ledger-surface-hover)]"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--ledger-surface-card)]"><FileImage size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{resourceTitle(reference)}</span><span className="block truncate text-xs text-[var(--ledger-text-muted)]">{resourceMeta(reference)}</span></span><span className="text-xs text-[var(--ledger-text-muted)]">Select</span></button>)}</div></>}
                  </div>}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
              <p className="text-xs text-[var(--ledger-text-muted)]">{['notes', 'projects', 'calendar', 'tasks', 'slack'].includes(source) ? `${selectedCount} selected` : source === 'github' && githubRepositoryId ? '1 selected' : ''}</p>
              <div className="flex items-center gap-2"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">Cancel</button><button type="button" onClick={() => void (source === 'notes' ? onLinkNotes?.(selectedNoteIds) : source === 'projects' ? onLinkProjects?.(selectedProjectIds) : source === 'calendar' ? onLinkCalendarItems?.(selectedCalendarItemIds) : source === 'tasks' ? onLinkTasks?.(selectedTaskIds) : source === 'slack' ? onLinkSlackContexts?.(selectedSlackContextIds) : source === 'github' && githubRepositoryId ? onLinkRepository(githubRepositories.find((repo) => repo.github_repository_id === githubRepositoryId)!) : mode === 'existing' ? onLinkSelectedReference?.(existing.find((reference) => reference.id === selectedReferenceId)!) : onPasteLink())} disabled={Boolean(busyId) || (['notes', 'projects', 'calendar', 'tasks', 'slack'].includes(source) ? selectedCount === 0 : source === 'github' ? !githubRepositoryId : mode === 'paste' ? !url.trim() : !selectedReferenceId)} className="inline-flex items-center gap-2 rounded-lg bg-[var(--ledger-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busyId && <Loader2 size={14} className="animate-spin" />}{primaryLabel}</button></div>
            </div>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
