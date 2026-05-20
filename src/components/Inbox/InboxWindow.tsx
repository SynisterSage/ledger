import {
  Inbox as InboxIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { ModuleWindowHeader } from '../Common/ModuleWindowHeader';
import { ModalOverlay } from '../Common/ModalOverlay';

type InboxItem = {
  id: string;
  source: string;
  source_id?: string | null;
  source_url?: string | null;
  title: string;
  body?: string | null;
  status: 'unprocessed' | 'converted' | 'archived';
  suggested_type?: string | null;
  converted_type?: string | null;
  channel_name?: string | null;
  author_name?: string | null;
  source_label?: string | null;
  created_at: string;
  updated_at: string;
};

type ConversionType = 'task' | 'note' | 'reminder' | 'event';

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

const defaultReminderAt = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return {
    date: date.toISOString().slice(0, 10),
    time: '09:00',
  };
};

const defaultEventStart = () => {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return {
    date: date.toISOString().slice(0, 10),
    time: `${String(date.getHours()).padStart(2, '0')}:00`,
  };
};

export default function InboxWindow() {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const api = useApi();

  const [items, setItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [conversionType, setConversionType] = useState<ConversionType>('task');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('09:00');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('10:00');
  const [eventDuration, setEventDuration] = useState('30');
  const [isConverting, setIsConverting] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

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
      const payload = (await api.getInboxItems({ status: 'unprocessed' })) as InboxItem[];
      setItems(Array.isArray(payload) ? payload : []);
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
    const timer = window.setInterval(() => {
      if (!activeWorkspaceId) return;
      void loadInbox(true);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activeWorkspaceId]);

  const openConversion = (item: InboxItem, type: ConversionType) => {
    setSelectedItem(item);
    setConversionType(type);
    setDraftTitle(item.title || 'Untitled');
    setDraftBody(item.body ?? '');
    const reminderDefaults = defaultReminderAt();
    const eventDefaults = defaultEventStart();
    setReminderDate(reminderDefaults.date);
    setReminderTime(reminderDefaults.time);
    setEventDate(eventDefaults.date);
    setEventTime(eventDefaults.time);
    setEventDuration('30');
  };

  const closeConversion = () => {
    if (isConverting) return;
    setSelectedItem(null);
  };

  const archiveItem = async (itemId: string) => {
    setActiveItemId(itemId);
    try {
      await api.archiveInboxItem(itemId);
      setItems((current) => current.filter((item) => item.id !== itemId));
      window.ipcRenderer?.send('inbox:items-updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive inbox item.');
    } finally {
      setActiveItemId(null);
    }
  };

  const submitConversion = async () => {
    if (!selectedItem) return;
    setIsConverting(true);
    try {
      const body = draftBody.trim();
      const title = draftTitle.trim() || selectedItem.title || 'Untitled';
      if (conversionType === 'task') {
        await api.convertInboxItem(selectedItem.id, {
          type: 'task',
          title,
          body,
          notes: body,
        });
      } else if (conversionType === 'note') {
        await api.convertInboxItem(selectedItem.id, {
          type: 'note',
          title,
          body,
        });
      } else if (conversionType === 'reminder') {
        const remindAt = new Date(`${reminderDate}T${reminderTime}:00`).toISOString();
        await api.convertInboxItem(selectedItem.id, {
          type: 'reminder',
          title,
          body,
          remind_at: remindAt,
          notes: body,
        });
      } else {
        const startAt = new Date(`${eventDate}T${eventTime}:00`).toISOString();
        const durationMinutes = Math.max(15, Number(eventDuration) || 30);
        const endAt = new Date(
          new Date(startAt).getTime() + durationMinutes * 60 * 1000
        ).toISOString();
        await api.convertInboxItem(selectedItem.id, {
          type: 'event',
          title,
          body,
          start_at: startAt,
          end_at: endAt,
          notes: body,
        });
      }
      setItems((current) => current.filter((item) => item.id !== selectedItem.id));
      setSelectedItem(null);
      window.ipcRenderer?.send('inbox:items-updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not convert inbox item.');
    } finally {
      setIsConverting(false);
    }
  };

  const headerSubtitle = useMemo(() => {
    return `${items.length} unprocessed`;
  }, [items.length]);

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-[28px] border border-gray-200 bg-white text-gray-950 shadow-none">
      <ModuleWindowHeader
        eyebrow="Ledger"
        title="Inbox"
        subtitle={headerSubtitle}
        icon={<InboxIcon size={22} className="text-[#FF5F40]" />}
        onClose={() => window.desktopWindow?.closeModule('inbox')}
        onMinimize={() => window.desktopWindow?.minimizeModule('inbox')}
        onToggleFullscreen={() => window.desktopWindow?.toggleModuleFullscreen('inbox')}
        actions={
          <button
            type="button"
            onClick={() => void loadInbox(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] gap-5 overflow-hidden p-5">
        <section className="min-h-0 flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Loader2 size={20} className="mx-auto mb-2 animate-spin text-gray-400" />
                <p className="text-sm text-gray-500">Loading…</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-gray-600">{error}</p>
                <button
                  onClick={() => void loadInbox()}
                  className="mt-2 text-xs font-medium text-[#FF5F40] hover:underline"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">Inbox is clear.</p>
                <p className="mt-1 text-xs text-gray-500">Saved Slack messages and other captures will appear here.</p>
              </div>
            </div>
          ) : (
            <div className="min-h-0 overflow-y-auto pr-2">
              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-gray-200 p-3 transition hover:border-gray-300 hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                            {item.source_label || item.source}
                          </p>
                          {item.channel_name && (
                            <p className="text-xs text-gray-500">#{item.channel_name}</p>
                          )}
                        </div>
                        <h3 className="mt-1 text-sm font-medium text-gray-900">{item.title}</h3>
                        {item.body && (
                          <p className="mt-1 line-clamp-2 text-xs text-gray-600">{item.body}</p>
                        )}
                        <p className="mt-2 text-xs text-gray-500">
                          {item.author_name ? `${item.author_name}` : 'Unnamed'} · {formatDateTime(item.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openConversion(item, 'task')}
                        className="text-xs font-medium text-gray-600 transition hover:text-gray-900"
                      >
                        Task
                      </button>
                      <span className="text-xs text-gray-300">·</span>
                      <button
                        type="button"
                        onClick={() => openConversion(item, 'note')}
                        className="text-xs font-medium text-gray-600 transition hover:text-gray-900"
                      >
                        Note
                      </button>
                      <span className="text-xs text-gray-300">·</span>
                      <button
                        type="button"
                        onClick={() => openConversion(item, 'reminder')}
                        className="text-xs font-medium text-gray-600 transition hover:text-gray-900"
                      >
                        Reminder
                      </button>
                      <span className="text-xs text-gray-300">·</span>
                      <button
                        type="button"
                        onClick={() => openConversion(item, 'event')}
                        className="text-xs font-medium text-gray-600 transition hover:text-gray-900"
                      >
                        Event
                      </button>
                      <span className="text-xs text-gray-300">·</span>
                      <button
                        type="button"
                        onClick={() => void archiveItem(item.id)}
                        disabled={activeItemId === item.id}
                        className="text-xs font-medium text-gray-600 transition hover:text-gray-900 disabled:opacity-50"
                      >
                        {activeItemId === item.id ? (
                          <Loader2 size={11} className="inline animate-spin" />
                        ) : (
                          'Archive'
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="min-h-0 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                How it works
              </p>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Slack saves land here first. Convert an item into a task, note, reminder, or
                event when you’re ready.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Source
              </p>
              <p className="mt-1 text-sm font-medium text-gray-900">Slack</p>
              <p className="mt-1 text-sm leading-6 text-gray-600">
                Intentional captures from Slack message shortcuts.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <ModalOverlay
        isOpen={Boolean(selectedItem)}
        onClose={closeConversion}
        classNameContainer="w-full max-w-xl"
      >
        {selectedItem && (
          <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Convert inbox item
              </p>
              <h2 className="mt-1 text-lg font-semibold text-gray-950">{selectedItem.title}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {selectedItem.source_label || selectedItem.source}
                {selectedItem.channel_name ? ` · #${selectedItem.channel_name}` : ''}
                {selectedItem.author_name ? ` · ${selectedItem.author_name}` : ''}
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['task', 'Task'],
                  ['note', 'Note'],
                  ['reminder', 'Reminder'],
                  ['event', 'Event'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setConversionType(value)}
                    className={`rounded-2xl border px-3 py-2 text-sm font-medium transition ${
                      conversionType === value
                        ? 'border-[#FF5F40] bg-[#FFF3EF] text-[#FF5F40]'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                  Title
                </span>
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                  Body
                </span>
                <textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  rows={5}
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
                />
              </label>

              {conversionType === 'reminder' && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                      Date
                    </span>
                    <input
                      type="date"
                      value={reminderDate}
                      onChange={(e) => setReminderDate(e.target.value)}
                      className="h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                      Time
                    </span>
                    <input
                      type="time"
                      value={reminderTime}
                      onChange={(e) => setReminderTime(e.target.value)}
                      className="h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
                    />
                  </label>
                </div>
              )}

              {conversionType === 'event' && (
                <div className="grid grid-cols-3 gap-3">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                      Date
                    </span>
                    <input
                      type="date"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                      Time
                    </span>
                    <input
                      type="time"
                      value={eventTime}
                      onChange={(e) => setEventTime(e.target.value)}
                      className="h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                      Minutes
                    </span>
                    <input
                      type="number"
                      min="15"
                      step="15"
                      value={eventDuration}
                      onChange={(e) => setEventDuration(e.target.value)}
                      className="h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white"
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4">
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
                className="rounded-full bg-[#FF5F40] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#ea5336] disabled:opacity-60"
              >
                {isConverting ? 'Converting…' : 'Convert'}
              </button>
            </div>
          </div>
        )}
      </ModalOverlay>
    </div>
  );
}
