import { Check, Copy, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ModalCloseButton } from '../Common/ModalCloseButton';
import { ModalOverlay } from '../Common/ModalOverlay';
import { ContextMenu } from '../Common/ContextMenu';

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
  const [actionMenu, setActionMenu] = useState<{ x: number; y: number } | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

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
      classNameContainer="w-full max-w-[680px] overflow-hidden rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]"
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--ledger-text-primary)]">Subscribe to Ledger Calendar</h2>
          <p className="mt-1 max-w-[560px] text-xs leading-5 text-[var(--ledger-text-muted)]">View selected Ledger dates in Apple Calendar, Google Calendar, Outlook, and other calendar apps. Changes remain managed in Ledger.</p>
        </div>
        <ModalCloseButton onClick={onClose} ariaLabel="Close calendar subscription settings" className="h-7 w-7 shrink-0 opacity-70" />
      </div>

      <div className="max-h-[62vh] space-y-5 overflow-y-auto px-5 pb-5">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-[var(--ledger-text-muted)]">Loading subscription settings…</p>
        ) : draft ? (
          <>
            <section>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-xs">
                <div><span className="text-[var(--ledger-text-muted)]">Subscription</span><span className="ml-2 font-medium text-[var(--ledger-text-primary)]">{settings?.status === 'disabled' ? 'Disabled' : 'Active'}</span></div>
                <div><span className="text-[var(--ledger-text-muted)]">Workspace</span><span className="ml-2 font-medium text-[var(--ledger-text-primary)]">{workspaceName || 'Current workspace'}</span></div>
                <div><span className="text-[var(--ledger-text-muted)]">Last requested</span><span className="ml-2 font-medium text-[var(--ledger-text-primary)]">{settings?.last_accessed_at ? new Date(settings.last_accessed_at).toLocaleString() : 'Not yet'}</span></div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={onCopyLink} disabled={isSaving} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[color:var(--ledger-border-subtle)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><Copy size={13} />Copy link</button>
                <button type="button" onClick={onOpenApple} disabled={isSaving} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[color:var(--ledger-border-subtle)] px-3 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><img src={`${import.meta.env.BASE_URL}apple.svg`} alt="" className="h-[13px] w-[13px] dark:invert" />Open in Apple Calendar</button>
                <button type="button" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setActionMenu({ x: rect.right - 190, y: rect.bottom + 6 }); }} disabled={isSaving} aria-label="More subscription actions" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] text-[var(--ledger-text-muted)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50"><MoreHorizontal size={15} /></button>
              </div>
              <p className="mt-2 text-[11px] text-[var(--ledger-text-muted)]">Anyone with this private link can view the items included below.</p>
            </section>
            <section>
              <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-[var(--ledger-text-muted)]">Included calendars</p><button type="button" onClick={() => setDraft({ ...draft, calendar_ids: calendars.map((calendar) => calendar.id) })} className="text-[11px] font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]">Select all</button></div>
              <div className="grid gap-0.5">
                {calendars.map((calendar) => (
                  <label key={calendar.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--ledger-text-primary)] transition hover:bg-[var(--ledger-surface-hover)]">
                    <input type="checkbox" checked={selectedCalendarSet.has(calendar.id)} onChange={() => toggleCalendar(calendar.id)} className="h-4 w-4 rounded border-gray-300 accent-[#FF5F40]" />
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: calendar.color || '#94A3B8' }} />
                    <span>{calendar.name}</span>
                  </label>
                ))}
                {calendars.length === 0 && <p className="px-2 py-2 text-xs text-[var(--ledger-text-muted)]">No internal calendars are available in this workspace.</p>}
              </div>
            </section>

            <section>
              <p className="mb-2 text-xs font-semibold text-[var(--ledger-text-muted)]">Include</p>
              <div className="grid gap-0.5">
                {workTypes.map(([key, label]) => (
                  <label key={key} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--ledger-text-primary)] transition hover:bg-[var(--ledger-surface-hover)]">
                    <input type="checkbox" checked={Boolean(draft[key])} onChange={() => toggleType(key)} className="h-4 w-4 rounded border-gray-300 accent-[#FF5F40]" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-[var(--ledger-text-muted)]">Only tasks assigned to you are included.</p>
            </section>
            <div>
              <button type="button" onClick={() => setShowInstructions((value) => !value)} className="text-xs font-medium text-[var(--ledger-text-secondary)] hover:text-[var(--ledger-text-primary)]">How to add this to another calendar</button>
              {showInstructions && <p className="mt-2 max-w-[520px] text-[11px] leading-5 text-[var(--ledger-text-muted)]">Apple Calendar: open directly · Google Calendar: add from URL · Outlook: subscribe from URL</p>}
            </div>
          </>
        ) : null}
        {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[color:var(--ledger-border-subtle)] px-5 py-3">
        <button type="button" onClick={onClose} disabled={isSaving} className="h-9 rounded-lg px-3 text-xs font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] disabled:opacity-50">Cancel</button>
        <button type="button" onClick={() => draft && onSave(draft)} disabled={!canSave || isSaving || isLoading} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--ledger-accent)] px-3.5 text-xs font-medium text-white hover:bg-[var(--ledger-accent-hover)] disabled:opacity-50">{isSaving ? 'Saving…' : <><Check size={13} />Save changes</>}</button>
      </div>
      <ContextMenu open={Boolean(actionMenu)} x={actionMenu?.x ?? 0} y={actionMenu?.y ?? 0} width={190} onClose={() => setActionMenu(null)} ariaLabel="Calendar sharing actions" groupLabelCase="normal" groups={[{ items: [{ id: 'regenerate', label: 'Regenerate link', icon: <SlidersHorizontal size={13} />, onClick: onRegenerate }, { id: settings?.status === 'disabled' ? 'enable' : 'disable', label: settings?.status === 'disabled' ? 'Enable subscription' : 'Disable subscription', icon: <SlidersHorizontal size={13} />, onClick: settings?.status === 'disabled' ? onEnable : onDisable }] }]} />
    </ModalOverlay>
  );
};
