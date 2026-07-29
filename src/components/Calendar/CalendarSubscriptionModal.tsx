import { Check, Copy, ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ModalOverlay } from '../Common/ModalOverlay';

export type CalendarSubscriptionCalendar = { id: string; name: string; color?: string | null };
export type CalendarSubscriptionSettings = {
  calendar_ids: string[];
  include_events: boolean;
  include_reminders: boolean;
  include_tasks: boolean;
  include_milestones: boolean;
  include_project_deadlines: boolean;
};
export type CalendarSubscriptionDetails = CalendarSubscriptionSettings & {
  status?: 'active' | 'disabled';
  last_accessed_at?: string | null;
  last_generated_at?: string | null;
  last_error_at?: string | null;
  last_error?: string | null;
  updated_at?: string | null;
};

type Props = {
  isOpen: boolean;
  calendars: CalendarSubscriptionCalendar[];
  settings: CalendarSubscriptionDetails | null;
  workspaceName?: string | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (settings: CalendarSubscriptionSettings) => void;
  onOpenApple: () => void;
  onCopyLink: () => void;
  onRegenerate: () => void;
  onDisable: () => void;
  onEnable: () => void;
};

const workTypes = [
  ['include_events', 'Events'],
  ['include_reminders', 'Reminders'],
  ['include_tasks', 'Tasks assigned to me'],
  ['include_milestones', 'Milestones'],
  ['include_project_deadlines', 'Project deadlines'],
] as const;
type WorkTypeKey = (typeof workTypes)[number][0];

export const CalendarSubscriptionModal = ({
  isOpen,
  calendars,
  settings,
  workspaceName,
  isLoading,
  isSaving,
  error,
  onClose,
  onSave,
  onOpenApple,
  onCopyLink,
  onRegenerate,
  onDisable,
  onEnable,
}: Props) => {
  const [draft, setDraft] = useState<CalendarSubscriptionSettings | null>(settings);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  const selectedCalendarCount = draft?.calendar_ids.length ?? 0;
  const hasEventsOrReminders = Boolean(draft?.include_events || draft?.include_reminders);
  const canSave = Boolean(
    draft &&
      Object.entries(draft).some(([key, value]) => key.startsWith('include_') && value === true) &&
      (!hasEventsOrReminders || selectedCalendarCount > 0)
  );
  const selectedCalendarSet = useMemo(() => new Set(draft?.calendar_ids ?? []), [draft?.calendar_ids]);

  const toggleCalendar = (id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      calendar_ids: selectedCalendarSet.has(id)
        ? draft.calendar_ids.filter((calendarId) => calendarId !== id)
        : [...draft.calendar_ids, id],
    });
  };

  const toggleType = (key: WorkTypeKey) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: !draft[key] });
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      backdropBorderRadius="inherit"
      disablePortal
      manageWindowChrome={false}
      classNameContainer="w-full max-w-[520px] overflow-hidden rounded-2xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"
    >
      <div className="flex items-start justify-between border-b border-[#E8DDD4] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Subscribe to Ledger Calendar</h2>
          <p className="mt-1 max-w-[420px] text-xs leading-5 text-gray-500">
            View selected Ledger dates in Apple Calendar, Google Calendar, Outlook, or another calendar app. This subscription is read-only.
          </p>
        </div>
        <ModalCloseButton onClick={onClose} ariaLabel="Close calendar subscription settings" />
      </div>

      <div className="max-h-[62vh] space-y-5 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-gray-500">Loading subscription settings…</p>
        ) : draft ? (
          <>
            <section className="rounded-lg border border-[#E2D4C4] bg-white/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-gray-500">Ledger Calendar Subscription</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">{settings?.status === 'disabled' ? 'Disabled' : 'Active'}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">{workspaceName || 'Current workspace'}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-500">Anyone with this private link can view the Ledger items included in this subscription. Do not share it publicly.</p>
              <p className="mt-2 rounded-md bg-gray-50 px-2.5 py-2 font-mono text-[11px] text-gray-400">••••••••••••••••••••••••</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={onCopyLink} disabled={isSaving} className="inline-flex items-center gap-1.5 rounded-md border border-[#E2D4C4] px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-[#FFF1E3] disabled:opacity-50"><Copy size={12} />Copy link</button>
                <button type="button" onClick={onOpenApple} disabled={isSaving} className="inline-flex items-center gap-1.5 rounded-md border border-[#E2D4C4] px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-[#FFF1E3] disabled:opacity-50"><ExternalLink size={12} />Open in Apple Calendar</button>
                {settings?.status === 'disabled' ? (
                  <button type="button" onClick={onEnable} disabled={isSaving} className="rounded-md border border-[#E2D4C4] px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-[#FFF1E3] disabled:opacity-50">Enable subscription</button>
                ) : (
                  <button type="button" onClick={onDisable} disabled={isSaving} className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Disable subscription</button>
                )}
                <button type="button" onClick={onRegenerate} disabled={isSaving} className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Regenerate link</button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-500">
                <span>Last updated</span><span className="text-right">{settings?.updated_at ? new Date(settings.updated_at).toLocaleString() : '—'}</span>
                <span>Last requested</span><span className="text-right">{settings?.last_accessed_at ? new Date(settings.last_accessed_at).toLocaleString() : 'Not requested yet'}</span>
              </div>
              {settings?.status === 'disabled' && <p className="mt-3 text-xs text-gray-600">This subscription is disabled and is no longer sharing updates.</p>}
              {settings?.status !== 'disabled' && <p className="mt-3 text-xs text-gray-600">Your Ledger calendar subscription is active.</p>}
            </section>
            <section>
              <p className="mb-2 text-xs font-semibold text-gray-500">Included calendars</p>
              <div className="divide-y divide-[#E8DDD4] rounded-lg border border-[#E2D4C4] bg-white/50">
                {calendars.map((calendar) => (
                  <label key={calendar.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm text-gray-800">
                    <input type="checkbox" checked={selectedCalendarSet.has(calendar.id)} onChange={() => toggleCalendar(calendar.id)} className="h-4 w-4 rounded border-gray-300 accent-[#FF5F40]" />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: calendar.color || '#94A3B8' }} />
                    <span>{calendar.name}</span>
                  </label>
                ))}
                {calendars.length === 0 && <p className="px-3 py-3 text-xs text-gray-500">No internal calendars are available in this workspace.</p>}
              </div>
            </section>

            <section>
              <p className="mb-2 text-xs font-semibold text-gray-500">Included work</p>
              <div className="divide-y divide-[#E8DDD4] rounded-lg border border-[#E2D4C4] bg-white/50">
                {workTypes.map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm text-gray-800">
                    <input type="checkbox" checked={Boolean(draft[key])} onChange={() => toggleType(key)} className="h-4 w-4 rounded border-gray-300 accent-[#FF5F40]" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </section>
            <p className="text-xs leading-5 text-gray-500">Tasks include only items assigned to you. Changes made in another calendar app will not update Ledger.</p>
            <section>
              <p className="mb-2 text-xs font-semibold text-gray-500">Add to another calendar app</p>
              <p className="text-xs leading-5 text-gray-500">Apple Calendar: open the subscription directly. Google Calendar: use Other calendars → From URL. Outlook: add a calendar subscription using the copied URL.</p>
            </section>
          </>
        ) : null}
        {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E8DDD4] px-5 py-3">
        <div className="flex gap-2">
          <button type="button" onClick={onOpenApple} disabled={isLoading || isSaving} className="inline-flex items-center gap-1.5 rounded-md bg-[#FF5F40] px-3 py-2 text-xs font-medium text-white hover:bg-[#f4583a] disabled:opacity-50"><ExternalLink size={13} />Open in Apple Calendar</button>
          <button type="button" onClick={onCopyLink} disabled={isLoading || isSaving} className="inline-flex items-center gap-1.5 rounded-md border border-[#E2D4C4] px-3 py-2 text-xs font-medium text-gray-700 hover:bg-[#FFF1E3] disabled:opacity-50"><Copy size={13} />Copy subscription link</button>
        </div>
        <button type="button" onClick={() => draft && onSave(draft)} disabled={!canSave || isSaving || isLoading} className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">{isSaving ? 'Saving…' : <><Check size={13} />Save</>}</button>
      </div>
    </ModalOverlay>
  );
};
