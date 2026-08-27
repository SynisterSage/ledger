import { useMemo } from 'react';
import { useAppleCalendar } from './appleCalendar';
import { useAppleReminders } from './appleReminders';

type Props = {
  userId?: string;
  onManageCalendar?: () => void;
  onManageReminders?: () => void;
};

export const AppleCalendarConnection = ({ userId, onManageCalendar, onManageReminders }: Props) => {
  const range = useMemo(() => ({ start: new Date(Date.now() - 86400000), end: new Date(Date.now() + 86400000 * 90) }), []);
  const apple = useAppleCalendar(userId, range.start, range.end);
  const reminders = useAppleReminders(userId, range.start, range.end);
  if (!apple.supported) return null;
  const permissionIssue = apple.permission === 'denied' || apple.permission === 'restricted';
  const reminderPermissionIssue = reminders.permission === 'denied' || reminders.permission === 'restricted';
  return <div>
    <div className="divide-y divide-[color:var(--ledger-border-subtle)]">
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)]"><img src={`${import.meta.env.BASE_URL}apple.svg`} alt="" className="h-4 w-4 dark:invert" /></span>
        <div className="min-w-0 flex-1"><p className="text-[13px] font-medium text-[var(--ledger-text-primary)]">Apple Calendar <span className="ml-1 text-[11px] font-normal text-[var(--ledger-text-muted)]">{apple.connected ? 'Connected' : 'Not connected'}</span></p><p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">View events from calendars available on this Mac alongside your Ledger work.</p></div>
        <button type="button" onClick={onManageCalendar} className="h-7 shrink-0 rounded-md border border-[color:var(--ledger-border-subtle)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">{apple.connected ? 'Manage' : 'Connect'}</button>
      </div>
      {permissionIssue && <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ledger-danger)]"><span>Ledger no longer has access to Apple Calendar. Allow calendar access in macOS System Settings to reconnect.</span><button type="button" onClick={() => void window.appleCalendar?.openSystemSettings()} className="shrink-0 underline">Open System Settings</button></div>}
      {apple.error && <p className="mt-2 text-xs text-[var(--ledger-danger)]">{apple.error}</p>}
    </div>
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ledger-surface-muted)]"><img src={`${import.meta.env.BASE_URL}apple.svg`} alt="" className="h-4 w-4 dark:invert" /></span>
        <div className="min-w-0 flex-1"><p className="text-[13px] font-medium text-[var(--ledger-text-primary)]">Apple Reminders <span className="ml-1 text-[11px] font-normal text-[var(--ledger-text-muted)]">{reminders.connected ? 'Connected' : 'Not connected'}</span></p><p className="mt-0.5 text-[11px] leading-4 text-[var(--ledger-text-muted)]">View dated reminders from lists available on this Mac alongside your Ledger work.</p></div>
        <button type="button" onClick={onManageReminders} className="h-7 shrink-0 rounded-md border border-[color:var(--ledger-border-subtle)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]">{reminders.connected ? 'Manage' : 'Connect'}</button>
      </div>
      {reminderPermissionIssue && <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ledger-danger)]"><span>Ledger can’t access Apple Reminders. Allow access in macOS System Settings to reconnect.</span><button type="button" onClick={() => void window.appleReminders?.openSystemSettings()} className="shrink-0 underline">Open System Settings</button></div>}
      {reminders.error && <p className="mt-2 text-xs text-[var(--ledger-danger)]">{reminders.error}</p>}
    </div>
    </div>
  </div>;
};
