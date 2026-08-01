import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { CaptureFormShell } from '@/components/CaptureFormShell';
import { Row } from '@/components/Row';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { CaptureDateTimePickerSheet } from '@/features/capture/CaptureDateTimePickerSheet';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { createMobileEvent, createMobileProjectAction, createMobileReminder, createMobileTask, deleteMobileEvent, deleteMobileReminder, deleteMobileTask, updateMobileEvent, updateMobileReminder, updateMobileTask } from '@/api/captures';
import { getMobileCalendarRange } from '@/api/calendar';
import { getWorkspaceLabel, useWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';
import { formatDateToLocalIsoDate } from '@/utils/captureDates';
import { parseMobileDateInput, parseMobileDateTimeInput, formatCaptureDateLabel, formatCaptureTimeLabel } from '@/features/capture/dateUtils';
import type { MobileCalendarItem } from './calendarItemNormalizer';

export type CalendarEditorItemType = 'event' | 'reminder' | 'task' | 'project_action';

type EditorParams = {
  mode?: string; type?: string; workspaceId?: string; dateKey?: string; startAt?: string; endAt?: string;
  itemId?: string; title?: string; notes?: string; projectId?: string; calendarId?: string; allDay?: string; readOnly?: string;
};

function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function asType(value: string | undefined): CalendarEditorItemType { return value === 'reminder' || value === 'task' || value === 'project_action' ? value : 'event'; }
function dateInputFromParams(params: EditorParams) { return params.dateKey ?? (params.startAt ? formatDateToLocalIsoDate(new Date(params.startAt)) : formatDateToLocalIsoDate(new Date())); }
function timeInputFromValue(value?: string) { return value ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : ''; }
function recurrenceLabel(value: string) { return value === 'FREQ=DAILY' ? 'Daily' : value === 'FREQ=WEEKLY' ? 'Weekly' : value === 'FREQ=MONTHLY' ? 'Monthly' : 'Never'; }
function toIsoDateTime(dateInput: string, timeInput: string, fallback: Date) {
  const date = parseMobileDateInput(dateInput, fallback);
  const parsed = timeInput ? parseMobileDateTimeInput(timeInput, date) : null;
  if (!date || (timeInput && !parsed)) return null;
  if (timeInput && parsed) date.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0);
  else date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export function CalendarItemEditor() {
  const params = useLocalSearchParams<EditorParams>();
  const router = useRouter();
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const mode = params.mode === 'edit' ? 'edit' : 'create';
  const initialType = asType(first(params.type));
  const itemId = first(params.itemId) ?? null;
  const readOnly = first(params.readOnly) === '1';
  const [type, setType] = useState<CalendarEditorItemType>(initialType);
  const [title, setTitle] = useState(first(params.title) ?? '');
  const [dateInput, setDateInput] = useState(dateInputFromParams(params));
  const [startTime, setStartTime] = useState(timeInputFromValue(first(params.startAt)));
  const [endTime, setEndTime] = useState(timeInputFromValue(first(params.endAt)));
  const [allDay, setAllDay] = useState(first(params.allDay) === '1');
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [notes, setNotes] = useState(first(params.notes) ?? '');
  const [location, setLocation] = useState('');
  const [workspaceId, setWorkspaceId] = useState(first(params.workspaceId) ?? workspaceState.selectedWorkspaceId);
  const [projectId, setProjectId] = useState(first(params.projectId) ?? null);
  const [calendarId, setCalendarId] = useState(first(params.calendarId) ?? null);
  const [calendarOptions, setCalendarOptions] = useState<Array<{ id: string; name: string; color?: string }>>([]);
  const [typeSheetOpen, setTypeSheetOpen] = useState(false);
  const [calendarSheetOpen, setCalendarSheetOpen] = useState(false);
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = useState(false);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [startSheetOpen, setStartSheetOpen] = useState(false);
  const [endSheetOpen, setEndSheetOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<any>(null);
  const { projects, isLoading: projectsLoading } = useCaptureProjects(workspaceId);
  const workspaceLabel = useMemo(() => getWorkspaceLabel(workspaceId, workspaceState.options), [workspaceId, workspaceState.options]);
  const selectedProjectLabel = projects.find((project) => project.id === projectId)?.name ?? 'None';
  const selectedCalendarLabel = calendarOptions.find((calendar) => calendar.id === calendarId)?.name ?? (type === 'reminder' ? 'Default reminder list' : 'Default calendar');
  const parsedDate = useMemo(() => parseMobileDateInput(dateInput, new Date()), [dateInput]);
  const parsedStart = useMemo(() => parseMobileDateTimeInput(startTime, parsedDate), [parsedDate, startTime]);
  const parsedEnd = useMemo(() => parseMobileDateTimeInput(endTime, parsedDate), [parsedDate, endTime]);

  useEffect(() => {
    if (mode === 'create') requestAnimationFrame(() => titleRef.current?.focus?.());
  }, [mode]);
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    void getMobileCalendarRange(workspaceId, formatDateToLocalIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), formatDateToLocalIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))).then((payload) => {
      if (cancelled) return;
      setCalendarOptions((payload.calendars ?? []).map((calendar) => ({ id: String(calendar.id), name: String(calendar.name ?? 'Calendar'), color: String(calendar.color ?? theme.colors.accent) })));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [theme.colors.accent, workspaceId]);

  const close = () => router.back();
  const remove = async () => {
    if (!itemId) return;
    setIsSaving(true);
    try {
      const sourceId = itemId.replace(/^(event|reminder|task|project-action):/, '').split(':')[0];
      if (type === 'event') await deleteMobileEvent(workspaceId, sourceId);
      else if (type === 'reminder') await deleteMobileReminder(workspaceId, sourceId);
      else await deleteMobileTask(workspaceId, sourceId);
      close();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Could not delete item.'); } finally { setIsSaving(false); }
  };
  const save = async () => {
    if (!title.trim()) return setError('Title is required.');
    if (workspaceId === 'all') return setError('Choose a workspace before saving.');
    if (type === 'project_action' && !projectId) return setError('Choose a project for this action.');
    const date = parseMobileDateInput(dateInput, new Date());
    if (!date || Number.isNaN(date.getTime())) return setError('Choose a valid date.');
    const startAt = type === 'event' ? (allDay ? `${formatDateToLocalIsoDate(date)}T00:00:00.000Z` : toIsoDateTime(dateInput, startTime, date)) : (startTime ? toIsoDateTime(dateInput, startTime, date) : null);
    const endAt = type === 'event' && !allDay ? toIsoDateTime(dateInput, endTime, date) : null;
    if (type === 'event' && (!startAt || !endAt || new Date(endAt).getTime() <= new Date(startAt).getTime())) return setError('End time must be after start time.');
    if ((type === 'task' || type === 'project_action' || type === 'reminder') && !dateInput.trim()) return setError('Choose a date.');
    setIsSaving(true); setError(null);
    try {
      if (type === 'event') {
        const payload = { title: title.trim(), start_at: startAt!, end_at: endAt, all_day: allDay, notes: notes.trim() || null, location: location.trim() || null, project_id: projectId, calendar_id: calendarId, recurrence_rule: recurrenceRule || null };
        if (mode === 'edit' && itemId) await updateMobileEvent(workspaceId, itemId.replace(/^event:/, '').split(':')[0], payload); else await createMobileEvent(workspaceId, payload);
      } else if (type === 'reminder') {
        const payload = { title: title.trim(), remind_at: startAt ?? `${formatDateToLocalIsoDate(date)}T00:00:00.000Z`, body: notes.trim() || null, project_id: projectId, calendar_id: calendarId };
        if (mode === 'edit' && itemId) await updateMobileReminder(workspaceId, itemId.replace(/^reminder:/, '').split(':')[0], payload); else await createMobileReminder(workspaceId, payload);
      } else {
        const payload = { title: title.trim(), due_date: formatDateToLocalIsoDate(date), due_time: startTime ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(parsedStart) : null, notes: notes.trim() || null, project_id: projectId, show_in_today: true };
        if (mode === 'edit' && itemId) await updateMobileTask(workspaceId, itemId.replace(/^(task|project-action):/, '').split(':')[0], payload); else if (type === 'project_action') await createMobileProjectAction(workspaceId, payload); else await createMobileTask(workspaceId, payload);
      }
      close();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save calendar item.'); } finally { setIsSaving(false); }
  };

  const chooseType = (next: CalendarEditorItemType) => { setType(next); setTypeSheetOpen(false); if (next !== 'event') { setEndTime(''); setAllDay(false); } };
  const typeLabel = type === 'project_action' ? 'Project action' : type.charAt(0).toUpperCase() + type.slice(1);
  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.colors.background }]}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Close calendar editor" onPress={close} style={styles.headerButton}><AppText variant="button">Cancel</AppText></Pressable><AppText variant="bodyStrong">{mode === 'edit' ? `Edit ${typeLabel.toLowerCase()}` : `New ${typeLabel.toLowerCase()}`}</AppText><Pressable accessibilityRole="button" accessibilityLabel={`Save ${typeLabel.toLowerCase()}`} onPress={() => void save()} disabled={isSaving || readOnly} style={styles.headerButton}><AppText variant="button" style={{ color: theme.colors.accent }}>{isSaving ? 'Saving…' : 'Save'}</AppText></Pressable></View>
    <CaptureFormShell footer={<AppButton title={isSaving ? 'Saving…' : `Save ${typeLabel.toLowerCase()}`} disabled={isSaving || readOnly} onPress={() => void save()} />}>
      <View style={styles.section}><AppTextInput ref={titleRef} label="Title" placeholder={type === 'project_action' ? 'What needs to happen?' : 'Add title'} value={title} onChangeText={setTitle} />
        <Row title="Type" subtitle={typeLabel} onPress={() => setTypeSheetOpen(true)} chevron titleVariant="body" />
        <Row title={type === 'event' ? 'Starts' : type === 'reminder' ? 'Remind me' : 'Due date'} subtitle={formatCaptureDateLabel(dateInput)} onPress={() => setDateSheetOpen(true)} chevron titleVariant="body" />
        {type === 'event' ? (
          <>
            <Row title="All day" subtitle={allDay ? 'On' : 'Off'} right={<Switch value={allDay} onValueChange={setAllDay} trackColor={{ false: theme.colors.borderSubtle, true: theme.colors.accent }} />} titleVariant="body" />
            {!allDay ? <><Row title="Start time" subtitle={formatCaptureTimeLabel(startTime)} onPress={() => setStartSheetOpen(true)} chevron titleVariant="body" /><Row title="End time" subtitle={formatCaptureTimeLabel(endTime)} onPress={() => setEndSheetOpen(true)} chevron titleVariant="body" /></> : null}
            <Row title="Repeats" subtitle={recurrenceLabel(recurrenceRule)} onPress={() => setRecurrenceRule((current) => current === '' ? 'FREQ=DAILY' : current === 'FREQ=DAILY' ? 'FREQ=WEEKLY' : current === 'FREQ=WEEKLY' ? 'FREQ=MONTHLY' : '')} chevron titleVariant="body" />
          </>
        ) : <Row title={type === 'reminder' ? 'Time' : 'Due time'} subtitle={startTime ? formatCaptureTimeLabel(startTime) : 'Optional'} onPress={() => setStartSheetOpen(true)} chevron titleVariant="body" />}
        <Row title={type === 'reminder' ? 'Reminder list' : 'Calendar'} subtitle={selectedCalendarLabel} onPress={() => setCalendarSheetOpen(true)} chevron titleVariant="body" />
        <Row title="Workspace" subtitle={workspaceLabel} onPress={() => setWorkspaceSheetOpen(true)} chevron titleVariant="body" />
        <Row title="Project" subtitle={selectedProjectLabel} onPress={() => setProjectSheetOpen(true)} chevron titleVariant="body" />
        <AppTextInput label="Notes" placeholder="Add details or context" multiline value={notes} onChangeText={setNotes} />
        {type === 'event' ? <AppTextInput label="Location" placeholder="Optional" value={location} onChangeText={setLocation} /> : null}
        {error ? <AppText variant="meta" style={{ color: theme.colors.danger }}>{error}</AppText> : null}
        {readOnly ? <AppText variant="meta">This item is read-only from its connected source.</AppText> : null}
        {mode === 'edit' && !readOnly ? <Pressable accessibilityRole="button" onPress={() => Alert.alert(`Delete ${typeLabel.toLowerCase()}?`, 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove() }])} style={styles.deleteAction}><AppText variant="body" style={{ color: theme.colors.danger }}>Delete {typeLabel.toLowerCase()}</AppText></Pressable> : null}
      </View>
    </CaptureFormShell>
    <CalendarChoiceSheet visible={typeSheetOpen} title="Create as" options={['event', 'reminder', 'task', 'project_action']} onSelect={chooseType} onClose={() => setTypeSheetOpen(false)} />
    <CalendarSourceChoiceSheet visible={calendarSheetOpen} options={calendarOptions} selectedId={calendarId} onSelect={(next) => { setCalendarId(next); setCalendarSheetOpen(false); }} onClose={() => setCalendarSheetOpen(false)} />
    <WorkspaceSelectorSheet visible={workspaceSheetOpen} selectedWorkspaceId={workspaceId} workspaces={workspaceState.options} onSelect={(next) => { setWorkspaceId(next); setProjectId(null); setCalendarId(null); setWorkspaceSheetOpen(false); }} onClose={() => setWorkspaceSheetOpen(false)} />
    <ProjectPickerSheet visible={projectSheetOpen} projects={projects} selectedProjectId={projectId} onSelect={(next) => { setProjectId(next); setProjectSheetOpen(false); }} onClose={() => setProjectSheetOpen(false)} loading={projectsLoading} />
    <CaptureDateTimePickerSheet visible={dateSheetOpen} title="Select date" mode="date" value={parsedDate} onSelect={(next) => setDateInput(formatDateToLocalIsoDate(next))} onClose={() => setDateSheetOpen(false)} />
    <CaptureDateTimePickerSheet visible={startSheetOpen} title="Select time" mode="time" value={parsedStart} onSelect={(next) => setStartTime(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(next))} onClose={() => setStartSheetOpen(false)} />
    <CaptureDateTimePickerSheet visible={endSheetOpen} title="Select end time" mode="time" value={parsedEnd} onSelect={(next) => setEndTime(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(next))} onClose={() => setEndSheetOpen(false)} />
  </SafeAreaView>;
}

function CalendarChoiceSheet({ visible, title, options, onSelect, onClose }: { visible: boolean; title: string; options: CalendarEditorItemType[]; onSelect: (type: CalendarEditorItemType) => void; onClose: () => void }) {
  const theme = useLedgerTheme();
  return <View>{visible ? <View style={[styles.typeOverlay, { backgroundColor: theme.colors.background, borderColor: theme.colors.borderSubtle }]}><View style={styles.typeHeader}><AppText variant="bodyStrong">{title}</AppText><Pressable onPress={onClose}><AppText variant="button">Done</AppText></Pressable></View>{options.map((option) => <Pressable key={option} onPress={() => onSelect(option)} style={styles.typeRow}><AppText variant="body">{option === 'project_action' ? 'Project action' : option.charAt(0).toUpperCase() + option.slice(1)}</AppText><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.colors.textMuted} /></Pressable>)}</View> : null}</View>;
}

function CalendarSourceChoiceSheet({ visible, options, selectedId, onSelect, onClose }: { visible: boolean; options: Array<{ id: string; name: string; color?: string }>; selectedId: string | null; onSelect: (id: string | null) => void; onClose: () => void }) {
  const theme = useLedgerTheme();
  return <View>{visible ? <View style={[styles.typeOverlay, { backgroundColor: theme.colors.background, borderColor: theme.colors.borderSubtle }]}><View style={styles.typeHeader}><AppText variant="bodyStrong">Choose calendar</AppText><Pressable onPress={onClose}><AppText variant="button">Done</AppText></Pressable></View><Pressable onPress={() => onSelect(null)} style={styles.typeRow}><AppText variant="body">Default</AppText><AppText variant="meta">{selectedId ? '' : '✓'}</AppText></Pressable>{options.map((option) => <Pressable key={option.id} onPress={() => onSelect(option.id)} style={styles.typeRow}><View style={styles.sourceChoice}><View style={[styles.sourceDot, { backgroundColor: option.color ?? theme.colors.accent }]} /><AppText variant="body">{option.name}</AppText></View><AppText variant="meta">{selectedId === option.id ? '✓' : ''}</AppText></Pressable>)}</View> : null}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { minHeight: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerButton: { minHeight: 44, justifyContent: 'center', minWidth: 58 }, section: { gap: 14 }, typeOverlay: { position: 'absolute', left: 16, right: 16, top: 80, zIndex: 10, borderWidth: 1, borderRadius: 12, padding: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, elevation: 8 }, typeHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 8 }, typeRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth }, sourceChoice: { flexDirection: 'row', alignItems: 'center', gap: 10 }, sourceDot: { width: 8, height: 8, borderRadius: 4 }, deleteAction: { paddingTop: 14, minHeight: 44 },
});

export function calendarEditorParams(item: MobileCalendarItem, workspaceId: string) {
  return { mode: 'edit', type: item.type === 'external_event' ? 'event' : item.type === 'project_action' ? 'project_action' : item.type, workspaceId, itemId: item.id, dateKey: item.dateKey, startAt: item.startAt ?? '', endAt: item.endAt ?? '', title: item.title, projectId: item.projectId ?? '', calendarId: item.calendarId ?? '', allDay: item.allDay ? '1' : '0', readOnly: item.readOnly ? '1' : '0' };
}
