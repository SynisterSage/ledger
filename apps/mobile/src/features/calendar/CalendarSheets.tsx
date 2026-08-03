import { Pressable, StyleSheet, View, TextInput, Switch, useWindowDimensions } from 'react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import { SymbolView } from 'expo-symbols';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/AppText';
import type { MobileCalendarView } from './useMobileCalendarState';
import { useLedgerTheme } from '@/theme';
import { getMobileCalendarRange, createMobileCalendar } from '@/api/calendar';
import { createMobileEvent, createMobileProjectAction, createMobileReminder, createMobileTask } from '@/api/captures';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { CaptureDateTimePickerSheet } from '@/features/capture/CaptureDateTimePickerSheet';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { formatDateToLocalIsoDate } from '@/utils/captureDates';
import { parseMobileDateInput, parseMobileDateTimeInput, formatCaptureDateLabel, formatCaptureTimeLabel } from '@/features/capture/dateUtils';
import { getWorkspaceLabel, useWorkspaceState } from '@/store/workspaceStore';
import { emitCalendarDataChanged } from './calendarDataEvents';
import { normalizeCalendarRange, type MobileCalendarItem } from './calendarItemNormalizer';
import { defaultCalendarFilters, type CalendarFilters } from './calendarFilters';

type CalendarSymbolName = ComponentProps<typeof SymbolView>['name'];

const viewOptions: Array<{ id: MobileCalendarView; label: string }> = [
  { id: 'month', label: 'Month' }, { id: 'agenda', label: 'Agenda' }, { id: 'day', label: 'Day' },
];

export function CalendarViewSheet({ visible, value, onChange, onClose }: { visible: boolean; value: MobileCalendarView; onChange: (view: MobileCalendarView) => void; onClose: () => void }) {
  const theme = useLedgerTheme();
  return (
    <AppBottomSheet visible={visible} onClose={onClose} title="View calendar" snapPoints={['58%', '72%']} initialSnapPointIndex={0} dragCloseThreshold={36} dragCloseSnapMargin={6}>
      <View>
        {viewOptions.map((option) => {
          const selected = option.id === value;
          return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${option.label} calendar view`} onPress={() => { onChange(option.id); onClose(); }} style={({ pressed }) => [styles.option, { borderBottomColor: theme.colors.borderSubtle, opacity: pressed ? 0.68 : 1 }]}>
            <AppText variant="bodyStrong">{option.label}</AppText>
            {selected ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={18} tintColor={theme.colors.accent} /> : null}
          </Pressable>;
        })}
      </View>
    </AppBottomSheet>
  );
}

type CreateHref = '/capture/event' | '/capture/reminder' | '/capture/task' | '/capture/project-action';

type CalendarCreateItemType = 'event' | 'reminder' | 'task' | 'project_action';

type CalendarCreateSheetProps = {
  visible: boolean;
  workspaceId: string;
  initialDateKey: string;
  initialStartAt?: string;
  initialEndAt?: string;
  onClose: () => void;
  onCreated?: () => void;
};

export function CalendarCreateSheet({ visible, workspaceId: initialWorkspaceId, initialDateKey, initialStartAt, initialEndAt, onClose, onCreated }: CalendarCreateSheetProps) {
  const theme = useLedgerTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const workspaceState = useWorkspaceState();
  const [type, setType] = useState<CalendarCreateItemType>('event');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [dateInput, setDateInput] = useState(initialDateKey);
  const [startTime, setStartTime] = useState(initialStartAt ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(initialStartAt)) : '');
  const [endTime, setEndTime] = useState(initialEndAt ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(initialEndAt)) : '');
  const [allDay, setAllDay] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [notes, setNotes] = useState('');
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [calendarOptions, setCalendarOptions] = useState<Array<{ id: string; name: string; color?: string }>>([]);
  const [calendarSheetOpen, setCalendarSheetOpen] = useState(false);
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = useState(false);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [startSheetOpen, setStartSheetOpen] = useState(false);
  const [endSheetOpen, setEndSheetOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { projects, isLoading: projectsLoading } = useCaptureProjects(workspaceId);
  const workspaceLabel = useMemo(() => getWorkspaceLabel(workspaceId, workspaceState.options), [workspaceId, workspaceState.options]);
  const selectedProjectLabel = projects.find((project) => project.id === projectId)?.name ?? 'None';
  const selectedCalendarLabel = calendarOptions.find((calendar) => calendar.id === calendarId)?.name ?? (type === 'reminder' ? 'Default reminder list' : 'Default calendar');
  const parsedDate = useMemo(() => parseMobileDateInput(dateInput, new Date()), [dateInput]);
  const parsedStart = useMemo(() => parseMobileDateTimeInput(startTime, parsedDate), [parsedDate, startTime]);
  const parsedEnd = useMemo(() => parseMobileDateTimeInput(endTime, parsedDate), [parsedDate, endTime]);

  useEffect(() => {
    if (!visible) {
      setType('event');
      setTitle('');
      setLocation('');
      setDateInput(initialDateKey);
      setStartTime(initialStartAt ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(initialStartAt)) : '');
      setEndTime(initialEndAt ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(initialEndAt)) : '');
      setAllDay(false);
      setRecurrenceRule('');
      setNotes('');
      setWorkspaceId(initialWorkspaceId);
      setProjectId(null);
      setCalendarId(null);
      setError(null);
    }
  }, [initialDateKey, initialEndAt, initialStartAt, initialWorkspaceId, visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const now = new Date();
    void getMobileCalendarRange(workspaceId, formatDateToLocalIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), formatDateToLocalIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))).then((payload) => {
      if (!cancelled) setCalendarOptions((payload.calendars ?? []).map((calendar) => ({ id: String(calendar.id), name: String(calendar.name ?? 'Calendar'), color: String(calendar.color ?? theme.colors.accent) })));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [theme.colors.accent, visible, workspaceId]);

  const toIsoDateTime = (dateValue: string, timeValue: string, fallback: Date) => {
    const date = parseMobileDateInput(dateValue, fallback);
    const parsed = timeValue ? parseMobileDateTimeInput(timeValue, date) : null;
    if (!date || (timeValue && !parsed)) return null;
    if (timeValue && parsed) date.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0);
    else date.setHours(0, 0, 0, 0);
    return date.toISOString();
  };

  const save = async () => {
    if (!type) return;
    if (!title.trim()) return setError('Title is required.');
    if (workspaceId === 'all') return setError('Choose a workspace before saving.');
    if (type === 'project_action' && !projectId) return setError('Choose a project for this action.');
    const date = parseMobileDateInput(dateInput, new Date());
    if (!date) return setError('Choose a valid date.');
    const startAt = type === 'event' ? (allDay ? `${formatDateToLocalIsoDate(date)}T00:00:00.000Z` : toIsoDateTime(dateInput, startTime, date)) : (startTime ? toIsoDateTime(dateInput, startTime, date) : null);
    const endAt = type === 'event' && !allDay ? toIsoDateTime(dateInput, endTime, date) : null;
    if (type === 'event' && (!startAt || !endAt || new Date(endAt).getTime() <= new Date(startAt).getTime())) return setError('End time must be after start time.');
    setIsSaving(true);
    setError(null);
    try {
      if (type === 'event') await createMobileEvent(workspaceId, { title: title.trim(), start_at: startAt!, end_at: endAt, all_day: allDay, notes: notes.trim() || null, location: location.trim() || null, project_id: projectId, calendar_id: calendarId, recurrence_rule: recurrenceRule || null });
      else if (type === 'reminder') await createMobileReminder(workspaceId, { title: title.trim(), remind_at: startAt ?? `${formatDateToLocalIsoDate(date)}T00:00:00.000Z`, body: notes.trim() || null, project_id: projectId, calendar_id: calendarId });
      else {
        const payload = { title: title.trim(), due_date: formatDateToLocalIsoDate(date), due_time: startTime ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(parsedStart) : null, notes: notes.trim() || null, project_id: projectId, show_in_today: true };
        if (type === 'project_action') await createMobileProjectAction(workspaceId, payload);
        else await createMobileTask(workspaceId, payload);
      }
      emitCalendarDataChanged(workspaceId);
      onCreated?.();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save calendar item.');
    } finally {
      setIsSaving(false);
    }
  };

  const chooseType = (next: CalendarCreateItemType) => {
    setType(next);
    setError(null);
    if (next !== 'event') {
      setEndTime('');
      setAllDay(false);
    }
  };
  const typeLabel = type === 'project_action' ? 'Project action' : type.charAt(0).toUpperCase() + type.slice(1);
  const options: Array<{ label: string; href: CreateHref; icon: CalendarSymbolName }> = [
    { label: 'Event', href: '/capture/event', icon: { ios: 'calendar', android: 'event', web: 'event' } }, { label: 'Reminder', href: '/capture/reminder', icon: { ios: 'bell', android: 'notifications_none', web: 'notifications_none' } }, { label: 'Task', href: '/capture/task', icon: { ios: 'checkmark.circle', android: 'check_circle_outline', web: 'check_circle_outline' } }, { label: 'Project action', href: '/capture/project-action', icon: { ios: 'arrow.forward', android: 'subdirectory_arrow_right', web: 'subdirectory_arrow_right' } },
  ];
  const titleContent = <View style={styles.createHeader}><Pressable accessibilityRole="button" accessibilityLabel="Close create sheet" onPress={onClose} style={styles.createHeaderButton}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor={theme.colors.textPrimary} /></Pressable><View style={styles.typeSwitcher}>{options.map((option) => { const optionType = option.href.replace('/capture/', '').replace('-', '_') as CalendarCreateItemType; return <Pressable key={option.href} accessibilityRole="button" accessibilityLabel={`Switch to ${option.label}`} onPress={() => chooseType(optionType)} style={[styles.typeSwitchButton, optionType === type && { backgroundColor: theme.colors.surfaceMuted }]}><SymbolView name={option.icon} size={17} tintColor={optionType === type ? theme.colors.accent : theme.colors.textSecondary} /></Pressable>; })}</View><Pressable accessibilityRole="button" accessibilityLabel={`Save ${typeLabel}`} onPress={() => void save()} disabled={isSaving} style={styles.createHeaderButton}><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={21} tintColor={isSaving ? theme.colors.textMuted : theme.colors.accent} /></Pressable></View>;
  const form = type ? <View style={styles.createForm}>
    <View style={styles.createFormIntro}><AppText variant="sectionTitle">New {typeLabel.toLowerCase()}</AppText><AppText variant="caption">Add it to your Ledger calendar.</AppText></View>
    <View style={[styles.createInputGroup, { backgroundColor: theme.colors.surfaceMuted }]}><TextInput placeholder={type === 'project_action' ? 'What needs to happen?' : 'Title'} placeholderTextColor={theme.colors.placeholder} value={title} onChangeText={setTitle} style={[styles.createTitleInput, { color: theme.colors.textPrimary, borderBottomColor: theme.colors.borderSubtle }]} autoFocus />{type === 'event' ? <TextInput placeholder="Location or video call" placeholderTextColor={theme.colors.placeholder} value={location} onChangeText={setLocation} style={[styles.createSecondaryInput, { color: theme.colors.textPrimary }]} /> : null}</View>
    <View style={styles.createSection}><Row title={type === 'event' ? 'Starts' : type === 'reminder' ? 'Remind me' : 'Due date'} subtitle={formatCaptureDateLabel(dateInput)} onPress={() => setDateSheetOpen(true)} chevron titleVariant="body" />
      {type === 'event' ? <><Row title="All day" subtitle={allDay ? 'On' : 'Off'} right={<Switch value={allDay} onValueChange={setAllDay} trackColor={{ false: theme.colors.borderSubtle, true: theme.colors.accent }} />} titleVariant="body" />{!allDay ? <><Row title="Start time" subtitle={formatCaptureTimeLabel(startTime)} onPress={() => setStartSheetOpen(true)} chevron titleVariant="body" /><Row title="End time" subtitle={formatCaptureTimeLabel(endTime)} onPress={() => setEndSheetOpen(true)} chevron titleVariant="body" /></> : null}<Row title="Repeat" subtitle={recurrenceRule === 'FREQ=DAILY' ? 'Daily' : recurrenceRule === 'FREQ=WEEKLY' ? 'Weekly' : recurrenceRule === 'FREQ=MONTHLY' ? 'Monthly' : 'Never'} onPress={() => setRecurrenceRule((current) => current === '' ? 'FREQ=DAILY' : current === 'FREQ=DAILY' ? 'FREQ=WEEKLY' : current === 'FREQ=WEEKLY' ? 'FREQ=MONTHLY' : '')} chevron titleVariant="body" /></> : <Row title={type === 'reminder' ? 'Time' : 'Due time'} subtitle={startTime ? formatCaptureTimeLabel(startTime) : 'Optional'} onPress={() => setStartSheetOpen(true)} chevron titleVariant="body" />}
      <Row title={type === 'reminder' ? 'Reminder list' : 'Calendar'} subtitle={selectedCalendarLabel} onPress={() => setCalendarSheetOpen(true)} chevron titleVariant="body" /><Row title="Workspace" subtitle={workspaceLabel} onPress={() => setWorkspaceSheetOpen(true)} chevron titleVariant="body" /><Row title="Project" subtitle={selectedProjectLabel} onPress={() => setProjectSheetOpen(true)} chevron titleVariant="body" />
    </View>
    <AppTextInput label="Notes" placeholder="Add details or context" multiline value={notes} onChangeText={setNotes} />
    {error ? <AppText variant="caption" style={{ color: theme.colors.danger }}>{error}</AppText> : null}
    <Pressable accessibilityRole="button" onPress={() => void save()} disabled={isSaving} style={[styles.createSaveButton, { backgroundColor: theme.colors.accent, opacity: isSaving ? 0.6 : 1 }]}><AppText variant="bodyStrong" style={{ color: '#FFFFFF' }}>{isSaving ? 'Saving…' : `Create ${typeLabel.toLowerCase()}`}</AppText></Pressable>
  </View> : <View>{options.map((option) => <Pressable key={option.href} accessibilityRole="button" accessibilityLabel={`Create ${option.label}`} onPress={() => chooseType(option.href.replace('/capture/', '').replace('-', '_') as CalendarCreateItemType)} style={({ pressed }) => [styles.option, { borderBottomColor: theme.colors.borderSubtle, opacity: pressed ? 0.68 : 1 }]}><View style={styles.optionLabel}><SymbolView name={option.icon} size={19} tintColor={theme.colors.textSecondary} /><AppText variant="bodyStrong">{option.label}</AppText></View><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={17} tintColor={theme.colors.textMuted} /></Pressable>)}</View>;
  return <AppBottomSheet visible={visible} onClose={onClose} title={titleContent} snapPoints={['82%', '100%']} initialSnapPointIndex={1} maxHeight={Math.max(560, windowHeight - insets.top)} dragCloseThreshold={24} dragCloseVelocityThreshold={0.35} dragCloseSnapMargin={4} dismissKeyboardOnBackdropPress>{form}
    <><CalendarSourceChoiceSheet visible={calendarSheetOpen} options={calendarOptions} selectedId={calendarId} onSelect={(next) => { setCalendarId(next); setCalendarSheetOpen(false); }} onClose={() => setCalendarSheetOpen(false)} /><WorkspaceSelectorSheet visible={workspaceSheetOpen} selectedWorkspaceId={workspaceId} workspaces={workspaceState.options} onSelect={(next) => { setWorkspaceId(next); setProjectId(null); setCalendarId(null); setWorkspaceSheetOpen(false); }} onClose={() => setWorkspaceSheetOpen(false)} /><ProjectPickerSheet visible={projectSheetOpen} projects={projects} selectedProjectId={projectId} onSelect={(next) => { setProjectId(next); setProjectSheetOpen(false); }} onClose={() => setProjectSheetOpen(false)} loading={projectsLoading} /><CaptureDateTimePickerSheet visible={dateSheetOpen} title="Select date" mode="date" value={parsedDate} onSelect={(next) => setDateInput(formatDateToLocalIsoDate(next))} onClose={() => setDateSheetOpen(false)} /><CaptureDateTimePickerSheet visible={startSheetOpen} title="Select time" mode="time" value={parsedStart} onSelect={(next) => setStartTime(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(next))} onClose={() => setStartSheetOpen(false)} /><CaptureDateTimePickerSheet visible={endSheetOpen} title="Select time" mode="time" value={parsedEnd} onSelect={(next) => setEndTime(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(next))} onClose={() => setEndSheetOpen(false)} /></>
  </AppBottomSheet>;
}

function CalendarSourceChoiceSheet({ visible, options, selectedId, onSelect, onClose }: { visible: boolean; options: Array<{ id: string; name: string; color?: string }>; selectedId: string | null; onSelect: (id: string | null) => void; onClose: () => void }) {
  const theme = useLedgerTheme();
  if (!visible) return null;
  return <View style={[styles.typeOverlay, { backgroundColor: theme.colors.background, borderColor: theme.colors.borderSubtle }]}><View style={styles.typeHeader}><AppText variant="bodyStrong">Choose calendar</AppText><Pressable accessibilityRole="button" onPress={onClose}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor={theme.colors.textSecondary} /></Pressable></View><Pressable onPress={() => onSelect(null)} style={styles.typeRow}><AppText variant="body">Default</AppText><AppText variant="meta">{selectedId ? '' : '✓'}</AppText></Pressable>{options.map((option) => <Pressable key={option.id} onPress={() => onSelect(option.id)} style={styles.typeRow}><View style={styles.sourceChoice}><View style={[styles.sourceDot, { backgroundColor: option.color ?? theme.colors.accent }]} /><AppText variant="body">{option.name}</AppText></View><AppText variant="meta">{selectedId === option.id ? '✓' : ''}</AppText></Pressable>)}</View>;
}

type CalendarSource = { key: string; name: string; color: string; kind: 'ledger' | 'apple' | 'reminder'; readOnly?: boolean };

function sourceKeyForItem(item: MobileCalendarItem) {
  return item.sourceKey ?? `${item.sourceKind ?? 'calendar'}:${item.sourceName ?? item.sourceId ?? 'default'}`;
}

export function CalendarSourcesSheet({ visible, workspaceId, workspaceLabel, filters, onChangeFilters, onResetFilters, onOpenWorkspacePicker, onManageConnection, onClose }: { visible: boolean; workspaceId: string; workspaceLabel: string; filters: CalendarFilters; onChangeFilters: (patch: Partial<CalendarFilters>) => void; onResetFilters: () => void; onOpenWorkspacePicker?: () => void; onManageConnection?: () => void; onClose: () => void }) {
  const theme = useLedgerTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [showCreateCalendar, setShowCreateCalendar] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadSources = useCallback(() => {
    setLoading(true);
    setSyncError(null);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10);
    void getMobileCalendarRange(workspaceId, start, end).then((payload) => {
      const normalized = normalizeCalendarRange(payload);
      const next: CalendarSource[] = (payload.calendars ?? []).map((calendar) => ({ key: `calendar:${String(calendar.id)}`, name: String(calendar.name ?? 'Calendar'), color: String(calendar.color ?? theme.colors.accent), kind: 'ledger' }));
      for (const item of normalized) {
        if (!item.sourceName || !item.sourceKey) continue;
        const kind = item.sourceKind === 'reminder' ? 'reminder' : item.type === 'external_event' ? 'apple' : 'ledger';
        if (kind === 'ledger' && item.calendarId) continue;
        if (!next.some((source) => source.key === sourceKeyForItem(item))) next.push({ key: sourceKeyForItem(item), name: item.sourceName, color: item.sourceColor ?? theme.colors.accent, kind, readOnly: item.readOnly });
      }
      setSources(next);
      setLoading(false);
    }).catch((error: unknown) => { setLoading(false); setSyncError(error instanceof Error ? 'Could not refresh calendars' : 'Could not refresh calendars'); });
  }, [theme.colors.accent, workspaceId]);

  useEffect(() => { if (visible) loadSources(); }, [loadSources, visible]);

  const toggleSource = (source: CalendarSource) => {
    const field = source.kind === 'reminder' ? 'visibleReminderListIds' : 'visibleCalendarIds';
    const current = filters[field];
    const all = sources.filter((candidate) => candidate.kind === source.kind).map((candidate) => candidate.key);
    const next = current.length === 0 ? all.filter((key) => key !== source.key) : current.includes(source.key) ? current.filter((key) => key !== source.key) : [...current, source.key];
    onChangeFilters({ [field]: next.length === all.length ? [] : next });
  };

  const isVisible = (source: CalendarSource) => { const field = source.kind === 'reminder' ? 'visibleReminderListIds' : 'visibleCalendarIds'; return filters[field].length === 0 || filters[field].includes(source.key); };
  const renderGroup = (title: string, kind: CalendarSource['kind'], canCreate = false) => {
    const group = sources.filter((source) => source.kind === kind);
    if (!group.length) return null;
    const allVisible = group.every(isVisible);
    return <View style={styles.sourceGroup}><View style={styles.groupHeader}><AppText variant="meta">{title}</AppText><View style={styles.groupHeaderActions}>{canCreate ? <Pressable accessibilityRole="button" accessibilityLabel={showCreateCalendar ? 'Close new Ledger calendar' : 'New Ledger calendar'} onPress={() => setShowCreateCalendar((current) => !current)} style={styles.groupAction}><SymbolView name={{ ios: showCreateCalendar ? 'xmark' : 'plus', android: showCreateCalendar ? 'close' : 'add', web: showCreateCalendar ? 'close' : 'add' }} size={18} tintColor={theme.colors.accent} /></Pressable> : null}<Pressable accessibilityRole="button" onPress={() => onChangeFilters({ [kind === 'reminder' ? 'visibleReminderListIds' : 'visibleCalendarIds']: allVisible ? group.map((source) => source.key) : [] })}><AppText variant="caption" style={{ color: theme.colors.accent }}>{allVisible ? 'Hide all' : 'Show all'}</AppText></Pressable></View></View>{canCreate && showCreateCalendar ? <View style={styles.inlineCreateRow}><TextInput value={newCalendarName} onChangeText={setNewCalendarName} placeholder="Calendar name" placeholderTextColor={theme.colors.textMuted} style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.borderSubtle }]} /><Pressable accessibilityRole="button" onPress={() => void createCalendar()}><AppText variant="caption" style={{ color: theme.colors.accent }}>{creating ? 'Saving…' : 'Add'}</AppText></Pressable></View> : null}{group.map((source) => <Pressable key={source.key} accessibilityRole="checkbox" accessibilityState={{ checked: isVisible(source) }} accessibilityLabel={`${source.name} ${kind === 'reminder' ? 'reminder list' : 'calendar'}, ${isVisible(source) ? 'visible' : 'hidden'}${source.readOnly ? ', read only' : ''}`} onPress={() => toggleSource(source)} style={({ pressed }) => [styles.sourceRow, { opacity: pressed ? 0.68 : isVisible(source) ? 1 : 0.48 }]}><View style={[styles.sourceDot, { backgroundColor: source.color }]} /><AppText variant="bodyStrong" numberOfLines={1} style={styles.sourceName}>{source.name}</AppText>{source.readOnly ? <AppText variant="caption" style={styles.readOnly}>Read only</AppText> : null}<AppText variant="meta" style={{ color: isVisible(source) ? theme.colors.accent : theme.colors.textMuted }}>{isVisible(source) ? '✓' : ''}</AppText></Pressable>)}</View>;
  };
  const typeRows: Array<[keyof CalendarFilters, string]> = [['showEvents', 'Events'], ['showReminders', 'Reminders'], ['showTasks', 'Tasks'], ['showProjectActions', 'Project actions'], ['showMilestones', 'Milestones'], ['showProjectDeadlines', 'Project deadlines']];
  const createCalendar = async () => { const name = newCalendarName.trim(); if (!name || creating) return; setCreating(true); try { const created = await createMobileCalendar(workspaceId, { name, color: theme.colors.accent }); setSources((current) => [...current, { key: `calendar:${String(created.id)}`, name, color: String(created.color ?? theme.colors.accent), kind: 'ledger' }]); setNewCalendarName(''); setShowCreateCalendar(false); } finally { setCreating(false); } };

  return <AppBottomSheet visible={visible} onClose={onClose} title={<View style={styles.calendarSheetTitle}><AppText variant="sectionTitle" style={styles.calendarSheetTitleText}>Calendars</AppText><AppText variant="caption" numberOfLines={1}>Choose what appears in Calendar</AppText></View>} headerAccessory={<Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} style={styles.doneButton}><AppText variant="caption" style={{ color: theme.colors.accent, fontWeight: '600' }}>Done</AppText></Pressable>} snapPoints={['88%', '100%']} initialSnapPointIndex={1} maxHeight={Math.max(560, windowHeight - insets.top)} dismissKeyboardOnContentPress>
      <View style={styles.sourcesContent}><Pressable accessibilityRole="button" accessibilityLabel={`Calendar workspace, ${workspaceLabel}`} onPress={onOpenWorkspacePicker} style={styles.sheetActions}><AppText variant="meta">Workspace</AppText><AppText variant="bodyStrong" style={styles.sourceName}>{workspaceLabel}</AppText><AppText variant="meta">⌄</AppText>{JSON.stringify(filters) !== JSON.stringify(defaultCalendarFilters) ? <Pressable onPress={(event) => { event.stopPropagation(); onResetFilters(); }}><AppText variant="caption" style={{ color: theme.colors.accent }}>Reset</AppText></Pressable> : null}</Pressable>
      {renderGroup('Ledger calendars', 'ledger', true)}{renderGroup('Apple Calendar', 'apple')}{renderGroup('Apple Reminders', 'reminder')}
      <View style={styles.sourceGroup}><AppText variant="meta">Show in Calendar</AppText>{typeRows.map(([key, label]) => <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: filters[key] as boolean }} accessibilityLabel={`Show ${label.toLowerCase()} in Calendar, ${filters[key] ? 'enabled' : 'disabled'}`} onPress={() => onChangeFilters({ [key]: !filters[key] })} style={({ pressed }) => [styles.sourceRow, { opacity: pressed ? 0.68 : 1 }]}><AppText variant="bodyStrong" style={styles.sourceName}>{label}</AppText><AppText variant="meta" style={{ color: filters[key] ? theme.colors.accent : theme.colors.textMuted }}>{filters[key] ? '✓' : ''}</AppText></Pressable>)}</View>
      {loading ? <AppText variant="caption" style={styles.status}>Syncing…</AppText> : syncError ? <View style={styles.statusRow}><AppText variant="caption">{syncError}</AppText><Pressable onPress={loadSources}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View> : <AppText variant="caption" style={styles.status}>Up to date</AppText>}
      <Pressable accessibilityRole="button" style={styles.manageAction} onPress={onManageConnection ?? onClose}><AppText variant="bodyStrong" style={{ color: theme.colors.accent }}>Manage Apple Calendar</AppText></Pressable>
    </View>
  </AppBottomSheet>;
}

const styles = StyleSheet.create({
  option: { minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionLabel: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  createHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  createHeaderButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  typeSwitcher: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  typeSwitchButton: { width: 34, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  createForm: { gap: 14, paddingBottom: 8 },
  createFormIntro: { gap: 2, paddingTop: 2 },
  createInputGroup: { borderRadius: 22, paddingHorizontal: 18, paddingVertical: 8 },
  createTitleInput: { minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, fontSize: 19, lineHeight: 24 },
  createSecondaryInput: { minHeight: 48, fontSize: 16, lineHeight: 22 },
  createSection: { gap: 0, borderRadius: 18, overflow: 'hidden' },
  createSaveButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  typeOverlay: { position: 'absolute', left: 16, right: 16, top: 80, zIndex: 10, borderWidth: 1, borderRadius: 14, padding: 12, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, elevation: 8 },
  typeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  typeRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  sourceChoice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceDot: { width: 8, height: 8, borderRadius: 4 },
  sourceIntro: { gap: 4, paddingBottom: 12 },
  calendarSheetTitle: { gap: 1 },
  calendarSheetTitleText: { fontSize: 18, lineHeight: 22 },
  doneButton: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  sourcesContent: { paddingBottom: 24 },
  sheetActions: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceGroup: { paddingTop: 14 },
  groupHeader: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 2 },
  groupHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  groupAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  sourceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceName: { flex: 1 },
  readOnly: { color: '#8B735D' },
  sourceStatus: { marginLeft: 'auto' },
  status: { paddingTop: 14 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 14 },
  newCalendar: { paddingTop: 18, gap: 8 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inlineCreateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 6 },
  input: { flex: 1, height: 40, minHeight: 40, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 0, textAlignVertical: 'center' },
  manageAction: { minHeight: 46, justifyContent: 'center', paddingTop: 8 },
});
