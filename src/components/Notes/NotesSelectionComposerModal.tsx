import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ModalOverlay } from '../Common/ModalOverlay';

export type NotesSelectionComposerKind = 'task' | 'event' | 'reminder';

export type NotesSelectionComposerContext = {
  kind: NotesSelectionComposerKind;
  text: string;
  noteId: string;
  projectId?: string | null;
  assigneeId?: string | null;
  taskVariant?: 'task' | 'follow-up';
};

type Props = {
  context: NotesSelectionComposerContext | null;
  members: Array<{ user_id: string; full_name: string | null; email: string | null }>;
  onClose: () => void;
};

type Calendar = { id: string; name: string; color?: string | null };
type Team = { id: string; name: string };

const firstLine = (text: string) =>
  text
    .split('\n')
    .find((line) => line.trim())
    ?.trim()
    .slice(0, 120) ?? '';

export const NotesSelectionComposerModal = ({ context, members, onClose }: Props) => {
  const api = useApi();
  const toast = useToast();
  const { activeWorkspaceId } = useWorkspaceContext();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const [taskMode, setTaskMode] = useState<'focus' | 'today' | 'long_term'>('focus');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assignee, setAssignee] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!context) return;
    setTitle(firstLine(context.text));
    setTaskMode('focus');
    setDueDate('');
    setAssignee(context.assigneeId ? `user:${context.assigneeId}` : '');
    setDate('');
    setTime('09:00');
    setNotes(context.text);
    setCalendarId('');
    setTeamId('');
    setError('');
    window.setTimeout(() => titleRef.current?.focus(), 80);
  }, [context]);

  useEffect(() => {
    if (!context || context.kind === 'task' || !activeWorkspaceId) return;
    let cancelled = false;
    void Promise.all([api.getCalendars({ scope: 'current_workspace' }), api.getTeams()])
      .then(([calendarPayload, teamPayload]) => {
        if (cancelled) return;
        const nextCalendars = Array.isArray(calendarPayload)
          ? calendarPayload
          : Array.isArray((calendarPayload as { calendars?: Calendar[] })?.calendars)
          ? (calendarPayload as { calendars: Calendar[] }).calendars
          : [];
        const nextTeams = Array.isArray(teamPayload)
          ? teamPayload
          : Array.isArray((teamPayload as { teams?: Team[] })?.teams)
          ? (teamPayload as { teams: Team[] }).teams
          : [];
        setCalendars(nextCalendars.filter((item) => item.id && item.name));
        setTeams(nextTeams.filter((item) => item.id && item.name));
        setCalendarId(nextCalendars[0]?.id ?? '');
      })
      .catch(() => {
        if (!cancelled) setError('Could not load calendars.');
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, context]);

  if (!context) return null;

  const save = async () => {
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      if (context.kind === 'task') {
        const isFocus = taskMode === 'focus';
        const isLongTerm = taskMode === 'long_term';
        await api.createTask({
          title: title.trim(),
          description: context.text,
          notes: `Created from note ${context.noteId}`,
          project_id: context.projectId ?? null,
          due_date: isLongTerm ? dueDate || null : null,
          task_horizon: isLongTerm ? 'long_term' : 'today',
          show_in_today: !isLongTerm,
          is_today_focus: isFocus,
          status: 'todo',
          assigned_to_user_id: assignee.startsWith('user:') ? assignee.slice(5) : null,
          assigned_to_team_id: assignee.startsWith('team:') ? assignee.slice(5) : null,
        });
        toast.show('Created task.', { variant: 'success' });
      } else {
        if (!date) throw new Error('Choose a date.');
        const selectedCalendar = calendars.find((item) => item.id === calendarId) ?? calendars[0];
        if (!selectedCalendar) throw new Error('Choose a calendar.');
        const start = new Date(`${date}T${time}:00`);
        if (Number.isNaN(start.getTime())) throw new Error('Choose a valid date and time.');
        const common = {
          title: title.trim(),
          calendar_id: selectedCalendar.id,
          project_id: context.projectId ?? null,
          note_id: context.noteId,
          assigned_to_team_id: teamId || null,
          notes: notes.trim() || null,
        };
        if (context.kind === 'reminder') {
          await api.createReminder({
            ...common,
            remind_at: start.toISOString(),
            color: selectedCalendar.color ?? undefined,
            is_done: false,
          });
          toast.show('Saved reminder.', { variant: 'success' });
        } else {
          await api.createEvent({
            ...common,
            start_at: start.toISOString(),
            end_at: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
            color: selectedCalendar.color ?? undefined,
            status: 'planned',
            visibility: 'workspace',
          });
          toast.show('Saved event.', { variant: 'success' });
        }
        window.ipcRenderer?.send('calendar:items-updated');
      }
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save item.');
    } finally {
      setIsSaving(false);
    }
  };

  const isTask = context.kind === 'task';
  const label = isTask
    ? context.taskVariant === 'follow-up'
      ? 'New follow-up'
      : 'New task'
    : context.kind === 'event'
    ? 'New event'
    : 'New reminder';

  return (
    <ModalOverlay
      isOpen
      onClose={onClose}
      backdropBorderRadius="inherit"
      disablePortal
      manageWindowChrome={false}
      classNameContainer="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-[color:var(--ledger-border-subtle)] px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--ledger-text-primary)]">{label}</p>
          <p className="mt-1 text-sm text-[var(--ledger-text-secondary)]">
            Created from the selected note text.
          </p>
        </div>
        <ModalCloseButton onClick={onClose} ariaLabel={`Close ${label.toLowerCase()} modal`} />
      </div>
      <div className="space-y-4 p-5">
        {isTask ? (
          <>
            <div className="flex flex-wrap gap-2">
              {[
                ['focus', 'Focus'],
                ['today', 'Today'],
                ['long_term', 'Long-term'],
              ].map(([id, optionLabel]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTaskMode(id as typeof taskMode)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    taskMode === id
                      ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                      : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]'
                  }`}
                >
                  {optionLabel}
                </button>
              ))}
            </div>
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Task title"
              className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"
            />
            {taskMode === 'long_term' && (
              <label className="block space-y-1 text-xs font-medium text-[var(--ledger-text-secondary)]">
                End date
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm font-normal text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"
                />
              </label>
            )}
            <select
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"
            >
              <option value="">Unassigned</option>
              {members.length > 0 && (
                <optgroup label="People">
                  {members.map((member) => (
                    <option key={member.user_id} value={`user:${member.user_id}`}>
                      {member.full_name?.trim() || member.email?.trim() || 'Workspace member'}
                    </option>
                  ))}
                </optgroup>
              )}
              {teams.length > 0 && (
                <optgroup label="Teams">
                  {teams.map((team) => (
                    <option key={team.id} value={`team:${team.id}`}>
                      {team.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </>
        ) : (
          <>
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={context.kind === 'event' ? 'Event title' : 'Reminder title'}
              className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"
              />
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"
              />
            </div>
            <select
              value={calendarId}
              onChange={(event) => setCalendarId(event.target.value)}
              className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"
            >
              <option value="">Choose calendar</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </select>
            {teams.length > 0 && (
              <select
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                className="w-full rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"
              >
                <option value="">No team assignment</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            )}
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Notes"
              className="w-full resize-none rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-sm text-[var(--ledger-text-primary)] outline-none focus:border-[color:var(--ledger-border-strong)]"
            />
          </>
        )}
        {error && <p className="text-xs text-[var(--ledger-danger)]">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-1.5 text-sm font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!title.trim() || isSaving || (!isTask && !date)}
          className="rounded-lg bg-[var(--ledger-accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50"
        >
          {isSaving
            ? 'Saving...'
            : isTask
            ? context.taskVariant === 'follow-up'
              ? 'Create follow-up'
              : 'Create task'
            : context.kind === 'event'
            ? 'Create event'
            : 'Create reminder'}
        </button>
      </div>
    </ModalOverlay>
  );
};
