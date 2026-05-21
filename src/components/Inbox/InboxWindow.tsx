import {
  Bell,
  CalendarDays,
  CheckSquare,
  X,
  FileText,
  Inbox as InboxIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { ModuleWindowHeader } from '../Common/ModuleWindowHeader';
import { useToast } from '../Common/ToastProvider';
import { createPortal } from 'react-dom';

type InboxStatus = 'unprocessed' | 'converted' | 'archived';
type SourceFilter = 'all' | 'slack';
type ConversionType = 'task' | 'note' | 'reminder' | 'event';

type InboxItem = {
  id: string;
  source: string;
  source_id?: string | null;
  source_url?: string | null;
  title: string;
  body?: string | null;
  status: InboxStatus;
  suggested_type?: string | null;
  converted_type?: string | null;
  channel_name?: string | null;
  author_name?: string | null;
  source_label?: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectOption = {
  id: string;
  name?: string | null;
  title?: string | null;
};

type CalendarOption = {
  id: string;
  name?: string | null;
};

type NoteOption = {
  id: string;
  title?: string | null;
};

const conversionTypes: Array<{
  value: ConversionType;
  label: string;
  icon: typeof CheckSquare;
}> = [
  { value: 'task', label: 'Task', icon: CheckSquare },
  { value: 'note', label: 'Note', icon: FileText },
  { value: 'reminder', label: 'Reminder', icon: Bell },
  { value: 'event', label: 'Event', icon: CalendarDays },
];

const statusLabels: Array<{ value: InboxStatus; label: string }> = [
  { value: 'unprocessed', label: 'Unprocessed' },
  { value: 'converted', label: 'Converted' },
  { value: 'archived', label: 'Archived' },
];

const upcomingSources = ['Email', 'Browser', 'Calendar', 'GitHub', 'Linear'];

const formatDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatTimeOnly = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const getDomain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || url;
  }
};

const getSlackLinkLabels = (text?: string | null) => {
  if (!text) return [];
  const labels: string[] = [];
  const pattern = /<([^>|]+)(?:\|([^>]+))?>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const url = match[1]?.trim() ?? '';
    const label = match[2]?.trim() || getDomain(url);
    if (label) labels.push(label);
  }
  return labels;
};

const cleanSlackText = (text?: string | null) => {
  if (!text) return '';
  return text
    .replace(/<([^>|]+)\|([^>]+)>/g, (_match, _url, label) => label)
    .replace(/<([^>|]+)>/g, (_match, url) => getDomain(String(url)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();
};

const stripTrailingSlackLinkLabel = (cleanText: string, rawText?: string | null) => {
  const labels = getSlackLinkLabels(rawText);
  if (labels.length === 0) return cleanText;
  const last = labels[labels.length - 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleanText
    .replace(new RegExp(`\\s*[·-]?\\s*${last}\\s*$`, 'i'), '')
    .trim() || cleanText;
};

const summarizeSlackText = (rawText?: string | null) => {
  const clean = cleanSlackText(rawText);
  const labels = getSlackLinkLabels(rawText);
  if (labels.length === 0) return clean;
  const base = stripTrailingSlackLinkLabel(clean, rawText);
  return `${base} · ${labels[labels.length - 1]}`;
};

const getDisplayTitle = (item: InboxItem) => {
  const raw = item.title || item.body || '';
  if (item.source === 'slack') {
    return stripTrailingSlackLinkLabel(cleanSlackText(raw), raw) || 'Slack message';
  }
  return cleanSlackText(raw) || 'Inbox capture';
};

const getDisplayPreview = (item: InboxItem) => {
  const raw = item.body || item.title || '';
  if (item.source === 'slack') return summarizeSlackText(raw);
  return cleanSlackText(raw);
};

const getSourceLabel = (item: InboxItem) => {
  if (item.source === 'slack') return 'Slack';
  return item.source_label || item.source.replace(/_/g, ' ');
};

const getSourceContext = (item: InboxItem) => {
  if (item.source === 'slack' && item.channel_name) return `#${item.channel_name}`;
  return item.source_id || '';
};

const defaultReminderAt = (seedText?: string) => {
  const parsed = parseLooseTime(seedText);
  const date = parsed ?? new Date();
  if (!parsed) {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  }
  return {
    date: date.toISOString().slice(0, 10),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  };
};

const defaultEventStart = (seedText?: string) => {
  const parsed = parseLooseTime(seedText);
  const date = parsed ?? new Date();
  if (!parsed) {
    date.setHours(date.getHours() + 1, 0, 0, 0);
  }
  return {
    date: date.toISOString().slice(0, 10),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  };
};

const parseLooseTime = (text?: string | null) => {
  if (!text) return null;
  const match = text.match(/(?:@|\bat\s+)(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date;
};

const buildDefaultBody = (item: InboxItem) => {
  const title = getDisplayTitle(item);
  const preview = getDisplayPreview(item);
  const parts = [preview || title];
  const sourceParts = [getSourceLabel(item), getSourceContext(item), item.author_name].filter(Boolean);
  if (sourceParts.length > 0) parts.push(`Source: ${sourceParts.join(' · ')}`);
  const linkLabels = getSlackLinkLabels(item.body || item.title);
  if (linkLabels.length > 0) parts.push(`Link: ${linkLabels[linkLabels.length - 1]}`);
  return parts.join('\n');
};

export default function InboxWindow() {
  const { user } = useAuthContext();
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const api = useApi();
  const toast = useToast();

  const [items, setItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeStatus, setActiveStatus] = useState<InboxStatus>('unprocessed');
  const [activeSource, setActiveSource] = useState<SourceFilter>('all');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [conversionType, setConversionType] = useState<ConversionType>('task');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [selectedCalendarId, setSelectedCalendarId] = useState('');
  const [showInToday, setShowInToday] = useState(false);
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('09:00');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('10:00');
  const [eventDuration, setEventDuration] = useState('30');
  const [isConverting, setIsConverting] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [notes, setNotes] = useState<NoteOption[]>([]);

  const loadInbox = async (showSpinner = false) => {
    if (!activeWorkspaceId) {
      setItems([]);
      setIsLoading(false);
      setError('Select a workspace to view Inbox items.');
      return;
    }

    if (showSpinner) setRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const [unprocessed, converted, archived] = await Promise.all([
        api.getInboxItems({ status: 'unprocessed' }),
        api.getInboxItems({ status: 'converted' }),
        api.getInboxItems({ status: 'archived' }),
      ]);
      setItems(
        [...(Array.isArray(unprocessed) ? unprocessed : []),
          ...(Array.isArray(converted) ? converted : []),
          ...(Array.isArray(archived) ? archived : [])] as InboxItem[]
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn\'t load Inbox.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void loadInbox();
  }, [activeWorkspaceId, user]);

  useEffect(() => {
    if (!activeWorkspaceId || !user) return;
    let cancelled = false;

    const loadContext = async () => {
      try {
        const [projectPayload, calendarPayload, notePayload] = await Promise.allSettled([
          api.getProjects({ includeCompleted: false }),
          api.getCalendars(),
          api.getNotes(),
        ]);
        if (cancelled) return;
        setProjects(projectPayload.status === 'fulfilled' && Array.isArray(projectPayload.value) ? projectPayload.value : []);
        setCalendars(calendarPayload.status === 'fulfilled' && Array.isArray(calendarPayload.value) ? calendarPayload.value : []);
        setNotes(notePayload.status === 'fulfilled' && Array.isArray(notePayload.value) ? notePayload.value : []);
      } catch {
        if (!cancelled) {
          setProjects([]);
          setCalendars([]);
          setNotes([]);
        }
      }
    };

    void loadContext();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, user]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!activeWorkspaceId) return;
      void loadInbox(true);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activeWorkspaceId]);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (item.status !== activeStatus) return false;
      if (activeSource !== 'all' && item.source !== activeSource) return false;
      return true;
    });
  }, [activeSource, activeStatus, items]);

  const selectedCapture = useMemo(() => {
    if (selectedItemId) {
      const byId = items.find((item) => item.id === selectedItemId);
      if (byId) return byId;
    }
    return visibleItems[0] ?? null;
  }, [items, selectedItemId, visibleItems]);

  const counts = useMemo(() => {
    const statusCounts = statusLabels.reduce<Record<InboxStatus, number>>((acc, status) => {
      acc[status.value] = items.filter((item) => {
        if (item.status !== status.value) return false;
        if (activeSource !== 'all' && item.source !== activeSource) return false;
        return true;
      }).length;
      return acc;
    }, { unprocessed: 0, converted: 0, archived: 0 });
    const sourceCounts = {
      all: items.filter((item) => item.status === activeStatus).length,
      slack: items.filter((item) => item.status === activeStatus && item.source === 'slack').length,
    };
    return { statusCounts, sourceCounts };
  }, [activeSource, activeStatus, items]);

  const headerSubtitle = useMemo(() => {
    const count = counts.statusCounts.unprocessed;
    return `${count} ${count === 1 ? 'capture' : 'captures'} waiting`;
  }, [counts.statusCounts.unprocessed]);

  const openConversion = (item: InboxItem, type: ConversionType) => {
    const seed = `${item.title}\n${item.body ?? ''}`;
    setSelectedItem(item);
    setSelectedItemId(item.id);
    setConversionType(type);
    setDraftTitle(getDisplayTitle(item));
    setDraftBody(buildDefaultBody(item));
    setSelectedProjectId('');
    setSelectedNoteId('');
    setSelectedCalendarId('');
    setShowInToday(false);
    const reminderDefaults = defaultReminderAt(seed);
    const eventDefaults = defaultEventStart(seed);
    setReminderDate(reminderDefaults.date);
    setReminderTime(reminderDefaults.time);
    setEventDate(eventDefaults.date);
    setEventTime(eventDefaults.time);
    setEventDuration('30');
  };

  const closeConversion = () => {
    setSelectedItem(null);
    setSelectedItemId(null);
  };

  const archiveItem = async (itemId: string) => {
    setActiveItemId(itemId);
    try {
      const updated = (await api.archiveInboxItem(itemId)) as InboxItem;
      setItems((current) => current.map((item) => (item.id === itemId ? updated : item)));
      window.ipcRenderer?.send('inbox:items-updated');
      toast.show('Archived capture.', { variant: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not archive inbox item.';
      setError(message);
      toast.show(message, { variant: 'error' });
    } finally {
      setActiveItemId(null);
    }
  };

  const submitConversion = async () => {
    if (!selectedItem) return;
    setIsConverting(true);
    try {
      const body = draftBody.trim();
      const title = draftTitle.trim() || getDisplayTitle(selectedItem);
      const basePayload = {
        type: conversionType,
        title,
        body,
        project_id: selectedProjectId || null,
      };

      if (conversionType === 'task') {
        await api.convertInboxItem(selectedItem.id, {
          ...basePayload,
          type: 'task',
          notes: body,
          show_in_today: showInToday,
        });
      } else if (conversionType === 'note') {
        await api.convertInboxItem(selectedItem.id, {
          ...basePayload,
          type: 'note',
          body,
        });
      } else if (conversionType === 'reminder') {
        if (!reminderDate || !reminderTime) throw new Error('Choose when to be reminded.');
        const remindAt = new Date(`${reminderDate}T${reminderTime}:00`).toISOString();
        await api.convertInboxItem(selectedItem.id, {
          ...basePayload,
          type: 'reminder',
          remind_at: remindAt,
          calendar_id: selectedCalendarId || null,
          note_id: selectedNoteId || null,
          notes: body,
        });
      } else {
        if (!eventDate || !eventTime) throw new Error('Choose when the event starts.');
        const startAt = new Date(`${eventDate}T${eventTime}:00`).toISOString();
        const durationMinutes = Math.max(15, Number(eventDuration) || 30);
        const endAt = new Date(
          new Date(startAt).getTime() + durationMinutes * 60 * 1000
        ).toISOString();
        await api.convertInboxItem(selectedItem.id, {
          ...basePayload,
          type: 'event',
          start_at: startAt,
          end_at: endAt,
          calendar_id: selectedCalendarId || null,
          note_id: selectedNoteId || null,
          notes: body,
        });
      }

      await loadInbox(true);
      setSelectedItem(null);
      window.ipcRenderer?.send('inbox:items-updated');
      toast.show(`Created ${conversionType} from ${getSourceLabel(selectedItem)} capture.`, {
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not convert inbox item.';
      setError(message);
      toast.show(message, { variant: 'error' });
    } finally {
      setIsConverting(false);
    }
  };

  const renderCaptureRow = (item: InboxItem) => {
    const isSelected = selectedCapture?.id === item.id;
    const sourceLabel = getSourceLabel(item);
    const sourceContext = getSourceContext(item);
    const title = getDisplayTitle(item);
    const preview = getDisplayPreview(item);

    return (
      <article
        key={item.id}
        onClick={() => setSelectedItemId(item.id)}
        className={`group border-b border-gray-100 px-1 py-4 transition ${
          isSelected ? 'bg-gray-50/70' : 'hover:bg-gray-50/50'
        }`}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
            <span className="font-medium">{sourceLabel}</span>
            {sourceContext && (
              <>
                <span className="text-gray-300">·</span>
                <span>{sourceContext}</span>
              </>
            )}
            {item.status !== 'unprocessed' && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-gray-400">{item.status}</span>
              </>
            )}
          </div>
          <h3 className="mt-1 truncate text-sm font-semibold text-gray-950">{title}</h3>
          {preview && <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-600">{preview}</p>}
          <p className="mt-2 text-xs text-gray-500">
            {item.author_name || 'Unknown sender'} · {formatDateTime(item.created_at)}
          </p>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {conversionTypes.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openConversion(item, value);
              }}
              disabled={item.status !== 'unprocessed'}
              className="text-xs font-medium text-gray-600 transition hover:text-[#FF5F40] disabled:cursor-not-allowed disabled:text-gray-300"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void archiveItem(item.id);
            }}
            disabled={activeItemId === item.id || item.status === 'archived'}
            className="text-xs font-medium text-gray-500 transition hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300"
          >
            {activeItemId === item.id ? <Loader2 size={12} className="animate-spin" /> : 'Archive'}
          </button>
        </div>
      </article>
    );
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white text-gray-950 shadow-none">
      <ModuleWindowHeader
        eyebrow="Ledger"
        title="Inbox"
        subtitle={headerSubtitle}
        icon={<InboxIcon size={20} className="text-[#FF5F40]" />}
        onClose={() => window.desktopWindow?.closeModule('inbox')}
        onMinimize={() => window.desktopWindow?.minimizeModule('inbox')}
        onToggleFullscreen={() => window.desktopWindow?.toggleModuleFullscreen('inbox')}
        actions={
          <button
            type="button"
            onClick={() => void loadInbox(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
            title="Refresh inbox"
            aria-label="Refresh inbox"
          >
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] overflow-hidden bg-white">
        <section className="min-h-0 overflow-hidden px-7 py-6">
          <div className="border-b border-gray-100 pb-4">
            <p className="text-sm font-semibold text-gray-900">Queue</p>
            <p className="mt-1 text-sm text-gray-600">
              Turn saved messages into tasks, notes, reminders, or events.
            </p>
          </div>

          <div className="min-h-0 h-[calc(100%-65px)] overflow-y-auto">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Loader2 size={20} className="mx-auto mb-2 animate-spin text-gray-400" />
                  <p className="text-sm text-gray-500">Loading captures...</p>
                </div>
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <p className="text-sm text-gray-600">{error}</p>
                  <button
                    onClick={() => void loadInbox()}
                    className="mt-2 text-xs font-medium text-[#FF5F40] transition hover:text-[#e65338]"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-xs text-center">
                  <p className="text-sm font-semibold text-gray-800">
                    {activeStatus === 'unprocessed'
                      ? activeSource === 'slack'
                        ? 'No Slack captures waiting.'
                        : 'Inbox is clear.'
                      : `No ${activeStatus} captures.`}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Saved messages and captures will appear here when they need review.
                  </p>
                </div>
              </div>
            ) : (
              <div>{visibleItems.map(renderCaptureRow)}</div>
            )}
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-gray-100 px-6 py-6">
          <div className="space-y-7">
            <section>
              <p className="text-sm font-semibold text-gray-900">Sources</p>
              <div className="mt-2 space-y-1">
                <FilterButton
                  label="All"
                  count={counts.sourceCounts.all}
                  active={activeSource === 'all'}
                  onClick={() => setActiveSource('all')}
                />
                <FilterButton
                  label="Slack"
                  count={counts.sourceCounts.slack}
                  active={activeSource === 'slack'}
                  onClick={() => setActiveSource('slack')}
                />
              </div>
            </section>

            <section>
              <p className="text-sm font-semibold text-gray-900">Coming soon</p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                {upcomingSources.map((source) => (
                  <div
                    key={source}
                    className="text-xs font-medium text-gray-400"
                  >
                    {source}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <p className="text-sm font-semibold text-gray-900">Status</p>
              <div className="mt-2 space-y-1">
                {statusLabels.map((status) => (
                  <FilterButton
                    key={status.value}
                    label={status.label}
                    count={counts.statusCounts[status.value]}
                    active={activeStatus === status.value}
                    onClick={() => setActiveStatus(status.value)}
                  />
                ))}
              </div>
            </section>

            <section className="border-t border-gray-100 pt-5">
              <p className="text-sm font-semibold text-gray-900">Selected</p>
              {selectedCapture ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="line-clamp-2 text-sm font-semibold text-gray-950">
                      {getDisplayTitle(selectedCapture)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {[getSourceLabel(selectedCapture), getSourceContext(selectedCapture), selectedCapture.author_name]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{formatTimeOnly(selectedCapture.created_at)}</p>
                  </div>
                  {selectedCapture.status === 'unprocessed' && (
                    <div>
                      <p className="mb-2 text-xs font-medium text-gray-500">Save as</p>
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        {conversionTypes.map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => openConversion(selectedCapture, value)}
                            className="text-xs font-medium text-gray-600 transition hover:text-[#FF5F40]"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm leading-5 text-gray-500">Select a capture to inspect it.</p>
              )}
            </section>
          </div>
        </aside>
      </div>

      {selectedItem &&
        createPortal(
          <div className="fixed inset-0 z-220 isolate">
            <div className="absolute inset-0 bg-black/45" onClick={closeConversion} />
            <div className="relative z-10 flex h-full w-full items-center justify-center p-4">
              <div
                className="flex max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex min-h-0 w-full flex-col">
                  <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-white px-6 py-5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Convert capture</p>
                      <h2 className="mt-2 truncate text-lg font-semibold text-gray-950">
                        {getDisplayTitle(selectedItem)}
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        {[getSourceLabel(selectedItem), getSourceContext(selectedItem), selectedItem.author_name]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        closeConversion();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        closeConversion();
                      }}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-50"
                      aria-label="Close convert modal"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="border-b border-gray-100 pb-4">
                  <p className="text-sm font-medium text-gray-900">{getDisplayTitle(selectedItem)}</p>
                  {getSlackLinkLabels(selectedItem.body || selectedItem.title).length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      {getSlackLinkLabels(selectedItem.body || selectedItem.title).join(' · ')}
                    </p>
                  )}
                </div>
  
                <div className="mt-5">
                  <p className="mb-2 text-sm font-semibold text-gray-900">Save as</p>
                  <div className="grid grid-cols-4 gap-1 rounded-full border border-gray-200 bg-gray-50 p-1">
                    {conversionTypes.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setConversionType(value)}
                        className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-semibold transition ${
                          conversionType === value
                            ? 'bg-gray-950 text-white'
                            : 'text-gray-600 hover:bg-white hover:text-gray-950'
                        }`}
                      >
                        <Icon size={13} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
  
                <div className="mt-5 grid gap-4">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-gray-500">Title</span>
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                    />
                  </label>
  
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-gray-500">
                      {conversionType === 'note' ? 'Content' : 'Notes'}
                    </span>
                    <textarea
                      value={draftBody}
                      onChange={(event) => setDraftBody(event.target.value)}
                      rows={conversionType === 'note' ? 5 : 4}
                      className="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm leading-6 text-gray-900 outline-none transition focus:border-gray-400"
                    />
                  </label>
  
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-gray-500">Workspace</span>
                      <input
                        value={activeWorkspace?.name ?? 'Current workspace'}
                        readOnly
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600 outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-gray-500">Project</span>
                      <select
                        value={selectedProjectId}
                        onChange={(event) => setSelectedProjectId(event.target.value)}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                      >
                        <option value="">No project</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name || project.title || 'Untitled project'}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
  
                  {conversionType === 'task' && (
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={showInToday}
                        onChange={(event) => setShowInToday(event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-[#FF5F40] focus:ring-[#FF5F40]"
                      />
                      Mark as Today
                    </label>
                  )}
  
                  {conversionType === 'reminder' && (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-gray-500">Remind on</span>
                        <input
                          type="date"
                          value={reminderDate}
                          onChange={(event) => setReminderDate(event.target.value)}
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-gray-500">Time</span>
                        <input
                          type="time"
                          value={reminderTime}
                          onChange={(event) => setReminderTime(event.target.value)}
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                        />
                      </label>
                    </div>
                  )}
  
                  {(conversionType === 'reminder' || conversionType === 'event') && (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-gray-500">Calendar</span>
                        <select
                          value={selectedCalendarId}
                          onChange={(event) => setSelectedCalendarId(event.target.value)}
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                        >
                          <option value="">Default calendar</option>
                          {calendars.map((calendar) => (
                            <option key={calendar.id} value={calendar.id}>
                              {calendar.name || 'Calendar'}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-gray-500">Linked note</span>
                        <select
                          value={selectedNoteId}
                          onChange={(event) => setSelectedNoteId(event.target.value)}
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                        >
                          <option value="">No note</option>
                          {notes.map((note) => (
                            <option key={note.id} value={note.id}>
                              {note.title || 'Untitled note'}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
  
                  {conversionType === 'event' && (
                    <div className="grid grid-cols-3 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-gray-500">Date</span>
                        <input
                          type="date"
                          value={eventDate}
                          onChange={(event) => setEventDate(event.target.value)}
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-gray-500">Start</span>
                        <input
                          type="time"
                          value={eventTime}
                          onChange={(event) => setEventTime(event.target.value)}
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-gray-500">Minutes</span>
                        <input
                          type="number"
                          min="15"
                          step="15"
                          value={eventDuration}
                          onChange={(event) => setEventDuration(event.target.value)}
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                        />
                      </label>
                    </div>
                  )}
                </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-5 py-4">
                    <p className="text-xs text-gray-500">
                      {conversionType === 'reminder'
                        ? 'Date and time are required for reminders.'
                        : conversionType === 'event'
                          ? 'Date and start time are required for events.'
                          : 'Source context stays attached in the notes.'}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={closeConversion}
                        className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitConversion()}
                        disabled={isConverting}
                        className="rounded-full bg-[#FF5F40] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#ea5336] disabled:opacity-60"
                      >
                        {isConverting ? 'Creating...' : `Create ${conversionType}`}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function FilterButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition ${
        active ? 'bg-gray-100 text-gray-950' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'
      }`}
    >
      <span className="font-medium">{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          active ? 'bg-white text-gray-700' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {count}
      </span>
    </button>
  );
}
