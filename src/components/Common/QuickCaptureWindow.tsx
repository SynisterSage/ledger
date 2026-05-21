import { Check, FileText, Calendar } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuthContext } from '../../context/AuthContext';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { ModuleWindowHeader } from './ModuleWindowHeader';
import { CloseGuardModal } from './CloseGuardModal';

type FollowUpContext = {
  eventId: string;
  eventTitle: string;
  projectId: string | null;
  noteId: string | null;
};

const parseFollowUpContext = (value?: string): FollowUpContext | null => {
  if (!value) return null;
  if (!value.startsWith('ledger-followup|')) return null;
  const [, eventId = '', eventTitle = '', projectId = '', noteId = ''] = value.split('|');
  if (!eventId) return null;
  return {
    eventId,
    eventTitle: decodeURIComponent(eventTitle || ''),
    projectId: projectId || null,
    noteId: noteId || null,
  };
};

export const QuickCaptureWindow = ({
  kind,
  context,
}: {
  kind: 'quick-task' | 'quick-note' | 'quick-event';
  context?: string;
}) => {
  const { user } = useAuthContext();
  const { activeWorkspaceId } = useWorkspaceContext();
  const api = useApi();

  const [taskTitle, setTaskTitle] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [eventTime, setEventTime] = useState('09:00');
  const [eventDurationValue, setEventDurationValue] = useState(30);
  const [eventDurationUnit, setEventDurationUnit] = useState<'minutes' | 'hours'>('minutes');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCloseGuardModal, setShowCloseGuardModal] = useState(false);

  const taskInputRef = useRef<HTMLInputElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const eventInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (kind === 'quick-task') {
        taskInputRef.current?.focus();
      } else if (kind === 'quick-note') {
        noteInputRef.current?.focus();
      } else if (kind === 'quick-event') {
        eventInputRef.current?.focus();
      }
    }, 100);

    return () => window.clearTimeout(timer);
  }, [kind]);

  useEffect(() => {
    if (kind !== 'quick-event' || !user) return;

    let cancelled = false;
    const loadDefaultDuration = async () => {
      try {
        const payload = (await api.getUserSettings()) as {
          preferences?: { defaultEventMinutes?: number } | null;
        };
        if (cancelled) return;
        const minutes = Number(payload?.preferences?.defaultEventMinutes ?? 30);
        const resolved = [30, 45, 60].includes(minutes) ? minutes : 30;
        setEventDurationValue(resolved >= 60 && resolved % 60 === 0 ? resolved / 60 : resolved);
        setEventDurationUnit(resolved >= 60 && resolved % 60 === 0 ? 'hours' : 'minutes');
      } catch {
        if (!cancelled) {
          setEventDurationValue(30);
          setEventDurationUnit('minutes');
        }
      }
    };

    void loadDefaultDuration();

    return () => {
      cancelled = true;
    };
  }, [api, kind, user]);

  const closeWindowNow = () => {
    void window.desktopWindow?.closeModule(kind as any);
  };

  const resetTaskDraft = () => setTaskTitle('');
  const resetNoteDraft = () => {
    setNoteTitle('');
    setNoteContent('');
  };
  const resetEventDraft = () => {
    setEventTitle('');
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    setEventDate(`${year}-${month}-${day}`);
    setEventTime('09:00');
  };

  const hasUnsavedDraft =
    taskTitle.trim().length > 0 ||
    noteTitle.trim().length > 0 ||
    noteContent.trim().length > 0 ||
    eventTitle.trim().length > 0;

  const getEventDurationMinutes = () =>
    Math.max(
      1,
      Math.round(eventDurationUnit === 'hours' ? eventDurationValue * 60 : eventDurationValue)
    );

  const closeWindow = () => {
    if (isSaving || hasUnsavedDraft) {
      setShowCloseGuardModal(true);
      return;
    }
    closeWindowNow();
  };

  const minimizeWindow = () => {
    void window.desktopWindow?.minimizeModule(kind as any);
  };

  const toggleFullscreen = () => {
    void window.desktopWindow?.toggleModuleFullscreen(kind as any);
  };

  const footer = (onSave: () => void, canSave: boolean) => (
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={closeWindow}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !canSave}
          className="flex-1 rounded-lg bg-[#FF5F40] px-3 py-2 text-sm font-medium text-white hover:bg-[#E54E30] disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );

  const shellClassName =
    'grid h-screen w-screen grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-3xl border border-gray-200 bg-[#f5f7fb] shadow-[0_24px_80px_rgba(15,23,42,0.08)]';

  const scrollAreaClassName =
    'min-h-0 overflow-y-auto overflow-x-hidden p-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden';
  const contextText = context?.trim();
  const followUpContext = parseFollowUpContext(contextText);
  const displayContext = followUpContext?.eventTitle
    ? `Follow-up: ${followUpContext.eventTitle}`
    : contextText;
  const truncatedContext = displayContext
    ? displayContext.length > 80
      ? `${displayContext.slice(0, 77)}...`
      : displayContext
    : undefined;

  const saveQuickTask = async () => {
    if (!user || !activeWorkspaceId || !taskTitle.trim()) {
      setError('Task title cannot be empty');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      const createdTask = await api.createTask({
        title: taskTitle.trim(),
        description: followUpContext ? `calendar_followup:${followUpContext.eventId}` : '',
        status: 'todo',
        priority: 'medium',
        project_id: followUpContext?.projectId ?? null,
        notes: followUpContext?.eventTitle
          ? `Follow-up from calendar: ${followUpContext.eventTitle}`
          : null,
        due_date: (() => {
          const today = new Date();
          const year = today.getFullYear();
          const month = String(today.getMonth() + 1).padStart(2, '0');
          const day = String(today.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        })(),
      });

      if (followUpContext) {
        window.ipcRenderer?.send('calendar:follow-up-created', {
          eventId: followUpContext.eventId,
          eventTitle: followUpContext.eventTitle,
          task: createdTask,
        });
      }
      setShowCloseGuardModal(false);
      resetTaskDraft();
      closeWindowNow();
    } catch (error) {
      console.error('Failed to create task:', error);
      setError('Failed to create task. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const saveQuickNote = async () => {
    if (!user || !activeWorkspaceId || !noteTitle.trim()) {
      setError('Note title cannot be empty');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      await api.createNote(noteTitle.trim(), noteContent.trim(), {
        source: 'quick_capture',
      });
      setShowCloseGuardModal(false);
      resetNoteDraft();
      closeWindowNow();
    } catch (error) {
      console.error('Failed to create note:', error);
      setError('Failed to create note. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const saveQuickEvent = async () => {
    if (!user || !activeWorkspaceId || !eventTitle.trim()) {
      setError('Event title cannot be empty');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      const startDateTime = new Date(`${eventDate}T${eventTime}:00`);
      const endDateTime = new Date(
        startDateTime.getTime() + getEventDurationMinutes() * 60 * 1000
      );

      await api.createEvent({
        title: eventTitle.trim(),
        start_at: startDateTime.toISOString(),
        end_at: endDateTime.toISOString(),
      });
      setShowCloseGuardModal(false);
      resetEventDraft();
      closeWindowNow();
    } catch (error) {
      console.error('Failed to create event:', error);
      setError('Failed to create event. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (kind === 'quick-task') {
    return (
      <div className={shellClassName}>
        <CloseGuardModal
          isOpen={showCloseGuardModal}
          isSaving={isSaving}
          hasUnsavedChanges={hasUnsavedDraft}
          onCancel={() => setShowCloseGuardModal(false)}
          onCloseWithoutSaving={() => {
            setShowCloseGuardModal(false);
            closeWindowNow();
          }}
          onRetrySaveAndClose={() => {
            void saveQuickTask();
          }}
        />
        <ModuleWindowHeader
          title="Quick Task"
          icon={<Check size={16} />}
          onClose={closeWindow}
          onMinimize={minimizeWindow}
          onToggleFullscreen={toggleFullscreen}
        />

        {truncatedContext && (
          <div className="border-b border-gray-200 bg-white px-4 py-2">
            <p className="text-[11px] text-gray-500">From Calendar</p>
            <p className="mt-0.5 text-xs font-medium text-gray-900 truncate whitespace-nowrap">
              {truncatedContext}
            </p>
          </div>
        )}

        <div className={scrollAreaClassName}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Task Title</label>
              <input
                ref={taskInputRef}
                type="text"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="What needs to be done?"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void saveQuickTask();
                  }
                }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>
        {footer(() => void saveQuickTask(), Boolean(taskTitle.trim()))}
      </div>
    );
  }

  if (kind === 'quick-note') {
    return (
      <div className={shellClassName}>
        <CloseGuardModal
          isOpen={showCloseGuardModal}
          isSaving={isSaving}
          hasUnsavedChanges={hasUnsavedDraft}
          onCancel={() => setShowCloseGuardModal(false)}
          onCloseWithoutSaving={() => {
            setShowCloseGuardModal(false);
            closeWindowNow();
          }}
          onRetrySaveAndClose={() => {
            void saveQuickNote();
          }}
        />
        <ModuleWindowHeader
          title="Quick Note"
          icon={<FileText size={16} />}
          onClose={closeWindow}
          onMinimize={minimizeWindow}
          onToggleFullscreen={toggleFullscreen}
        />

        {contextText && (
          <div className="border-b border-gray-200 bg-white px-4 py-2">
            <p className="text-[11px] text-gray-500">From Calendar</p>
            <p className="mt-0.5 text-xs font-medium text-gray-900 truncate">{contextText}</p>
          </div>
        )}

        <div className={scrollAreaClassName}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Note Title</label>
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Note title..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Content</label>
              <textarea
                ref={noteInputRef}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Add your notes here..."
                rows={4}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none resize-none"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>
        {footer(() => void saveQuickNote(), Boolean(noteTitle.trim()))}
      </div>
    );
  }

  if (kind === 'quick-event') {
    return (
      <div className={shellClassName}>
        <CloseGuardModal
          isOpen={showCloseGuardModal}
          isSaving={isSaving}
          hasUnsavedChanges={hasUnsavedDraft}
          onCancel={() => setShowCloseGuardModal(false)}
          onCloseWithoutSaving={() => {
            setShowCloseGuardModal(false);
            closeWindowNow();
          }}
          onRetrySaveAndClose={() => {
            void saveQuickEvent();
          }}
        />
        <ModuleWindowHeader
          title="Quick Event"
          icon={<Calendar size={16} />}
          onClose={closeWindow}
          onMinimize={minimizeWindow}
          onToggleFullscreen={toggleFullscreen}
        />

        {contextText && (
          <div className="border-b border-gray-200 bg-white px-4 py-2">
            <p className="text-[11px] text-gray-500">From Calendar</p>
            <p className="mt-0.5 text-xs font-medium text-gray-900 truncate">{contextText}</p>
          </div>
        )}

        <div className={scrollAreaClassName}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Event Title</label>
              <input
                ref={eventInputRef}
                type="text"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                placeholder="Event name..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
                <input
                  type="time"
                  value={eventTime}
                  onChange={(e) => setEventTime(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-[1fr_92px] gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Duration</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={eventDurationValue}
                  onChange={(e) => setEventDurationValue(Number(e.target.value) || 1)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 invisible">
                  Duration unit
                </label>
                <select
                  value={eventDurationUnit}
                  onChange={(e) => setEventDurationUnit(e.target.value as 'minutes' | 'hours')}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none bg-white"
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>
        {footer(() => void saveQuickEvent(), Boolean(eventTitle.trim()))}
      </div>
    );
  }

  return null;
};
