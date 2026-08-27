import { Check, CircleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppleCalendar, type AppleCalendar } from '../Calendar/appleCalendar';
import { useAppleReminders, type AppleReminderList } from '../Calendar/appleReminders';
import { IntegrationPageHeader, IntegrationSection, MetaRow, settingsIntegrationButton, settingsIntegrationPrimary } from './FigmaIntegrationPage';

type Props = { userId?: string; kind: 'calendar' | 'reminders'; onBack: () => void };

export const AppleIntegrationPage = ({ userId, kind, onBack }: Props) => {
  const range = useMemo(() => ({ start: new Date(Date.now() - 86400000), end: new Date(Date.now() + 86400000 * 90) }), []);
  const calendar = useAppleCalendar(userId, range.start, range.end);
  const reminders = useAppleReminders(userId, range.start, range.end);
  const isCalendar = kind === 'calendar';
  const source = isCalendar ? calendar : reminders;
  const [draftCalendars, setDraftCalendars] = useState<AppleCalendar[]>([]);
  const [draftLists, setDraftLists] = useState<AppleReminderList[]>([]);
  const groups = useMemo(() => Object.entries(calendar.calendars.reduce<Record<string, AppleCalendar[]>>((result, item) => { (result[item.sourceTitle] ??= []).push(item); return result; }, {})), [calendar.calendars]);
  const reminderGroups = useMemo(() => Object.entries(reminders.lists.reduce<Record<string, AppleReminderList[]>>((result, item) => { (result[item.sourceTitle] ??= []).push(item); return result; }, {})), [reminders.lists]);
  const loadSelection = async () => {
    if (!source.connected && !await source.connect()) return;
    if (isCalendar) setDraftCalendars((await calendar.refreshCalendars()).filter((item) => item.available && item.visible));
    else setDraftLists((await reminders.refreshLists()).filter((item) => item.available && item.visible));
  };
  useEffect(() => { if (source.connected) void loadSelection().catch(() => undefined); }, [kind, userId, source.connected]);
  const connect = async () => { await loadSelection(); };
  const disconnect = () => {
    if (window.confirm(`Disconnect Apple ${isCalendar ? 'Calendar' : 'Reminders'} from Ledger? Apple will not be changed.`)) source.disconnect();
  };
  if (!source.supported) return null;
  const permissionIssue = source.permission === 'denied' || source.permission === 'restricted';
  const save = () => { if (isCalendar) calendar.saveSelection(draftCalendars); else reminders.saveSelection(draftLists); };
  return <section className="w-full max-w-215" aria-labelledby={`settings-apple-${kind}`}>
    <IntegrationPageHeader id={`settings-apple-${kind}`} title={isCalendar ? 'Apple Calendar' : 'Apple Reminders'} description={isCalendar ? 'Choose which calendars Ledger can read alongside your work.' : 'Choose which reminder lists Ledger can read alongside your work.'} icon={<img src={`${import.meta.env.BASE_URL}apple.svg`} alt="" className="h-7 w-7 dark:invert" />} onBack={onBack} />
    <IntegrationSection title="Connection">
      {!source.connected ? <div className="flex items-center justify-between gap-4"><div><p className="text-[13px] font-medium">Connect Apple {isCalendar ? 'Calendar' : 'Reminders'}</p><p className="mt-1 text-xs text-[var(--ledger-text-muted)]">Ledger only reads the calendars or lists you select.</p></div><button type="button" onClick={() => void connect()} disabled={source.loading} className={settingsIntegrationPrimary}>{source.loading ? 'Connecting…' : 'Connect'}</button></div> : <><div className="divide-y divide-[color:var(--ledger-border-subtle)]"><MetaRow label="Status" value="Connected" icon={<Check size={14} />} /><MetaRow label="Selected" value={`${isCalendar ? calendar.connectedCalendars.length : reminders.connectedLists.length} ${isCalendar ? 'calendars' : 'lists'}`} /></div><div className="mt-4 flex gap-2"><button type="button" onClick={() => void loadSelection()} disabled={source.loading} className={settingsIntegrationButton}>{source.loading ? 'Refreshing…' : 'Refresh available'}</button><button type="button" onClick={disconnect} className="h-8 rounded-full border border-[color:rgba(217,45,32,0.18)] px-3 text-xs font-medium text-[var(--ledger-danger)]">Disconnect</button></div></>}
      {permissionIssue && <p className="mt-4 flex items-start gap-2 text-xs text-[var(--ledger-danger)]" role="alert"><CircleAlert size={14} className="mt-0.5 shrink-0" />Ledger can’t access Apple {isCalendar ? 'Calendar' : 'Reminders'}. Allow access in macOS System Settings, then try again.</p>}
      {source.error && <p className="mt-3 text-xs text-[var(--ledger-danger)]" role="alert">{source.error}</p>}
    </IntegrationSection>
    <IntegrationSection title={isCalendar ? 'Calendars' : 'Reminder lists'}>
      <p className="text-xs text-[var(--ledger-text-muted)]">Select the {isCalendar ? 'calendars' : 'lists'} Ledger should include. Changes apply immediately after saving.</p>
      <div className="mt-4 flex gap-3 text-xs"><button type="button" className="underline" onClick={() => isCalendar ? setDraftCalendars(calendar.calendars.filter((item) => item.available)) : setDraftLists(reminders.lists.filter((item) => item.available))}>Select all</button><button type="button" className="underline" onClick={() => isCalendar ? setDraftCalendars([]) : setDraftLists([])}>Clear selection</button></div>
      <div className="mt-4 max-h-96 overflow-auto pr-1">{(isCalendar ? groups : reminderGroups).map(([group, items]) => <div key={group} className="mb-5 last:mb-0"><p className="mb-1 text-xs font-semibold text-[var(--ledger-text-muted)]">{group}</p>{items.filter((item) => item.available).map((item) => { const selected = isCalendar ? draftCalendars.some((entry) => entry.id === item.id) : draftLists.some((entry) => entry.id === item.id); return <button key={item.id} type="button" onClick={() => isCalendar ? setDraftCalendars((current) => selected ? current.filter((entry) => entry.id !== item.id) : [...current, item as AppleCalendar]) : setDraftLists((current) => selected ? current.filter((entry) => entry.id !== item.id) : [...current, item as AppleReminderList])} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left hover:bg-[var(--ledger-surface-hover)]"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="min-w-0 flex-1 text-sm text-[var(--ledger-text-primary)]">{item.title}</span>{isCalendar && !(item as AppleCalendar).allowsContentModifications && <span className="text-[10px] text-[var(--ledger-text-muted)]">Read-only</span>}<span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-[var(--ledger-accent)] bg-[var(--ledger-accent)] text-white' : 'border-[var(--ledger-border-strong)]'}`}>{selected && <Check size={11} />}</span></button>; })}</div>)}</div>
      <div className="mt-5 flex justify-end"><button type="button" onClick={save} disabled={isCalendar ? !draftCalendars.length : !draftLists.length} className={settingsIntegrationPrimary}>Save {isCalendar ? 'calendars' : 'lists'}</button></div>
    </IntegrationSection>
    <IntegrationSection title="Privacy"><p className="text-xs leading-5 text-[var(--ledger-text-muted)]">Ledger reads only the selected {isCalendar ? 'calendar events' : 'reminders with due dates'} and does not modify Apple data unless you explicitly create or edit an item.</p></IntegrationSection>
  </section>;
};
