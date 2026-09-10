import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { AppButton } from '@/components/AppButton';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { CaptureFormShell } from '@/components/CaptureFormShell';
import { Row } from '@/components/Row';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { ProjectPickerSheet } from '@/features/capture/ProjectPickerSheet';
import { CaptureDateTimePickerSheet } from '@/features/capture/CaptureDateTimePickerSheet';
import { useCaptureProjects } from '@/features/capture/useCaptureProjects';
import { createMobileEvent, createMobileProjectAction, createMobileReminder, createMobileTask, deleteMobileEvent, deleteMobileReminder, deleteMobileTask, getMobileEventProviderLinks, linkMobileEventProvider, updateMobileEvent, updateMobileReminder, updateMobileTask } from '@/api/captures';
import { bulkDeleteMobileEvents, getMobileCalendarRange, getMobileEventMatchPreview, type MobileEventMatchPreview } from '@/api/calendar';
import { emitCalendarDataChanged } from './calendarDataEvents';
import { getWorkspaceLabel, useWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';
import { formatDateToLocalIsoDate } from '@/utils/captureDates';
import { parseMobileDateInput, parseMobileDateTimeInput, formatCaptureDateLabel, formatCaptureTimeLabel } from '@/features/capture/dateUtils';
import type { MobileCalendarItem } from './calendarItemNormalizer';
import { appleCalendarNative, type AppleCalendarSummary } from '@/native/appleCalendar';

export type CalendarEditorItemType = 'event' | 'reminder' | 'task' | 'project_action';

type EditorParams = {
  mode?: string; type?: string; workspaceId?: string; dateKey?: string; startAt?: string; endAt?: string;
  itemId?: string; title?: string; notes?: string; projectId?: string; calendarId?: string; allDay?: string; readOnly?: string; sourcePlatform?: string; seriesId?: string; importSeriesKey?: string; openDeleteMatches?: string;
};

function confirmAppleOverwrite(title: string) {
  return new Promise<boolean>((resolve) => {
    Alert.alert('Apple Calendar changed', `“${title}” changed in Apple Calendar since Ledger last synced it. Replace those changes with the Ledger version?`, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Replace Apple version', style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: false });
  });
}

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
  const [appleCalendarOptions, setAppleCalendarOptions] = useState<AppleCalendarSummary[]>([]);
  const [typeSheetOpen, setTypeSheetOpen] = useState(false);
  const [calendarSheetOpen, setCalendarSheetOpen] = useState(false);
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = useState(false);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [startSheetOpen, setStartSheetOpen] = useState(false);
  const [endSheetOpen, setEndSheetOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchPreview, setMatchPreview] = useState<MobileEventMatchPreview | null>(null);
  const [matchScope, setMatchScope] = useState<'future' | 'all'>('future');
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [isDeletingMatches, setIsDeletingMatches] = useState(false);
  const titleRef = useRef<any>(null);
  const { projects, isLoading: projectsLoading } = useCaptureProjects(workspaceId);
  const workspaceLabel = useMemo(() => getWorkspaceLabel(workspaceId, workspaceState.options), [workspaceId, workspaceState.options]);
  const selectedProjectLabel = projects.find((project) => project.id === projectId)?.name ?? 'None';
  const selectedCalendarLabel = calendarId?.startsWith('apple:')
    ? appleCalendarOptions.find((calendar) => `apple:${calendar.id}` === calendarId)?.title ?? 'Apple Calendar'
    : calendarOptions.find((calendar) => calendar.id === calendarId)?.name ?? (type === 'reminder' ? 'Default reminder list' : 'Default calendar');
  const parsedDate = useMemo(() => parseMobileDateInput(dateInput, new Date()), [dateInput]);
  const parsedStart = useMemo(() => parseMobileDateTimeInput(startTime, parsedDate), [parsedDate, startTime]);
  const parsedEnd = useMemo(() => parseMobileDateTimeInput(endTime, parsedDate), [parsedDate, endTime]);

  useEffect(() => {
    if (mode === 'create') requestAnimationFrame(() => titleRef.current?.focus?.());
  }, [mode]);
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    void getMobileCalendarRange(workspaceId, formatDateToLocalIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), formatDateToLocalIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))).then(async (payload) => {
      if (cancelled) return;
      setCalendarOptions((payload.calendars ?? []).map((calendar) => ({ id: String(calendar.id), name: String(calendar.name ?? 'Calendar'), color: String(calendar.color ?? theme.colors.accent) })));
      if (appleCalendarNative.supported) {
        const status = await appleCalendarNative.getAuthorizationStatus();
        if (status === 'granted') setAppleCalendarOptions((await appleCalendarNative.listCalendars()).filter((calendar) => calendar.allowsContentModifications));
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [theme.colors.accent, workspaceId]);

  const close = () => router.back();
  const remove = async () => {
    if (!itemId) return;
    setIsSaving(true);
    try {
      const sourceId = itemId.replace(/^(event|reminder|task|project-action):/, '').split(':')[0];
      if (type === 'event') {
        const links = await getMobileEventProviderLinks(workspaceId, sourceId).catch(() => []);
        await deleteMobileEvent(workspaceId, sourceId);
        for (const link of links.filter((item) => item.provider === 'apple')) await appleCalendarNative.deleteEvent(link.provider_event_id).catch(() => undefined);
      }
      else if (type === 'reminder') await deleteMobileReminder(workspaceId, sourceId);
      else await deleteMobileTask(workspaceId, sourceId);
      emitCalendarDataChanged(workspaceId);
      close();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Could not delete item.'); } finally { setIsSaving(false); }
  };
  const sourceEventId = itemId?.replace(/^event:/, '').split(':')[0] ?? null;
  const canDeleteMatches = mode === 'edit' && type === 'event' && !readOnly && (first(params.openDeleteMatches) === '1' || first(params.sourcePlatform) === 'ics' || Boolean(first(params.seriesId)) || Boolean(first(params.importSeriesKey)));
  const loadMatchPreview = async (scope: 'future' | 'all' = matchScope) => {
    if (!sourceEventId || !canDeleteMatches) return;
    setIsLoadingMatches(true);
    setError(null);
    try {
      const preview = await getMobileEventMatchPreview(workspaceId, sourceEventId, scope);
      setMatchScope(scope);
      setMatchPreview(preview);
      setSelectedMatchIds(new Set(preview.matches.map((match) => match.id)));
    } catch (matchError) {
      setError(matchError instanceof Error ? matchError.message : 'Could not find matching events.');
    } finally {
      setIsLoadingMatches(false);
    }
  };
  useEffect(() => {
    if (mode === 'edit' && params.openDeleteMatches === '1' && canDeleteMatches) void loadMatchPreview('all');
    // The route parameter is a one-shot command; the preview owns subsequent
    // scope changes and selection state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDeleteMatches, mode, params.openDeleteMatches, sourceEventId]);
  const deleteSelectedMatches = async () => {
    const ids = [...selectedMatchIds];
    if (!ids.length) return;
    setIsDeletingMatches(true);
    try {
      const result = await bulkDeleteMobileEvents(workspaceId, ids);
      if (!result.success || !Array.isArray(result.deleted_ids) || result.deleted_ids.length !== ids.length) {
        throw new Error('The calendar changed before deletion. Review the matches again.');
      }
      emitCalendarDataChanged(workspaceId);
      setMatchPreview(null);
      setSelectedMatchIds(new Set());
      router.back();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete matching events.');
    } finally {
      setIsDeletingMatches(false);
    }
  };
  const save = async () => {
    if (!title.trim()) return setError('Title is required.');
    if (workspaceId === 'all') return setError('Choose a workspace before saving.');
    if (type === 'project_action' && !projectId) return setError('Choose a project for this action.');
    const date = parseMobileDateInput(dateInput, new Date());
    if (!date || Number.isNaN(date.getTime())) return setError('Choose a valid date.');
    const startAt = type === 'event' ? (allDay ? (() => { const localStart = new Date(date); localStart.setHours(0, 0, 0, 0); return localStart.toISOString(); })() : toIsoDateTime(dateInput, startTime, date)) : (startTime ? toIsoDateTime(dateInput, startTime, date) : null);
    const endAt = type === 'event' && !allDay ? toIsoDateTime(dateInput, endTime, date) : null;
    if (type === 'event' && (!startAt || (!allDay && (!endAt || new Date(endAt).getTime() <= new Date(startAt).getTime())))) return setError('End time must be after start time.');
    if ((type === 'task' || type === 'project_action' || type === 'reminder') && !dateInput.trim()) return setError('Choose a date.');
    setIsSaving(true); setError(null);
    try {
      if (type === 'event') {
        const appleCalendarId = calendarId?.startsWith('apple:') ? calendarId.slice('apple:'.length) : null;
        const payload = { title: title.trim(), start_at: startAt!, end_at: endAt, all_day: allDay, notes: notes.trim() || null, location: location.trim() || null, project_id: projectId, calendar_id: appleCalendarId ? null : calendarId, recurrence_rule: recurrenceRule || null };
        if (mode === 'edit' && itemId) {
          const eventId = itemId.replace(/^event:/, '').split(':')[0];
          const links = await getMobileEventProviderLinks(workspaceId, eventId).catch(() => []);
          const appleLink = links.find((link) => link.provider === 'apple');
          if (appleLink) {
            const latestApple = await appleCalendarNative.getEvent(appleLink.provider_event_id).catch(() => null);
            const lastKnown = appleLink.last_provider_modified_at;
            if (latestApple?.lastModified && lastKnown && latestApple.lastModified !== lastKnown && !(await confirmAppleOverwrite(title.trim()))) return;
          }
          await updateMobileEvent(workspaceId, eventId, payload);
          if (appleLink) {
            const appleEnd = endAt ?? new Date(new Date(startAt!).getTime() + 86400000).toISOString();
            try {
              const updatedApple = await appleCalendarNative.updateEvent(appleLink.provider_event_id, title.trim(), startAt!, appleEnd, allDay, notes.trim() || null, location.trim() || null);
              await linkMobileEventProvider(workspaceId, eventId, { provider: 'apple', provider_calendar_id: appleLink.provider_calendar_id, provider_event_id: appleLink.provider_event_id, last_provider_modified_at: updatedApple.lastModified ?? null });
            } catch {
              Alert.alert('Saved to Ledger', 'Ledger saved the changes, but Apple Calendar could not be updated.');
            }
          }
        }
        else {
          const created = await createMobileEvent(workspaceId, payload) as { id?: string };
          if (appleCalendarId) {
            const appleEnd = endAt ?? new Date(new Date(startAt!).getTime() + 86400000).toISOString();
            try {
              const appleEvent = await appleCalendarNative.createEvent(title.trim(), startAt!, appleEnd, allDay, notes.trim() || null, location.trim() || null, appleCalendarId);
              if (created.id && appleEvent.id) await linkMobileEventProvider(workspaceId, created.id, { provider: 'apple', provider_calendar_id: appleCalendarId, provider_event_id: appleEvent.id, last_provider_modified_at: appleEvent.lastModified ?? null });
            } catch {
              Alert.alert('Saved to Ledger', 'Ledger saved the event, but it could not be added to Apple Calendar.');
            }
          }
        }
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
  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.colors.background }]}><View style={[styles.header, { borderBottomColor: theme.colors.borderSubtle }]}><Pressable accessibilityRole="button" accessibilityLabel="Close calendar editor" onPress={close} style={styles.headerButton}><AppText variant="button">Cancel</AppText></Pressable><AppText variant="bodyStrong" style={styles.headerTitle}>{mode === 'edit' ? `Edit ${typeLabel.toLowerCase()}` : `New ${typeLabel.toLowerCase()}`}</AppText><Pressable accessibilityRole="button" accessibilityLabel={`Save ${typeLabel.toLowerCase()}`} onPress={() => void save()} disabled={isSaving || readOnly} style={styles.headerButton}><AppText variant="button" style={{ color: theme.colors.accent }}>{isSaving ? 'Saving…' : 'Save'}</AppText></Pressable></View>
    <CaptureFormShell
      footer={<AppButton title={isSaving ? 'Saving…' : `Save ${typeLabel.toLowerCase()}`} size="lg" disabled={isSaving || readOnly} onPress={() => void save()} />}
      contentStyle={styles.formContent}
      footerBottomPadding={theme.spacing.lg}
    >
      <View style={styles.form}>
      <View style={[styles.titleGroup, { backgroundColor: theme.colors.surfaceMuted }]}><AppTextInput ref={titleRef} label="Title" placeholder={type === 'project_action' ? 'What needs to happen?' : 'Add title'} value={title} onChangeText={setTitle} style={styles.cardInput} />
      </View>
      <View style={[styles.fieldGroup, { backgroundColor: theme.colors.surfaceMuted }]}>
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
      </View>
      <View style={[styles.fieldGroup, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Row title="Workspace" subtitle={workspaceLabel} onPress={() => setWorkspaceSheetOpen(true)} chevron titleVariant="body" />
        <Row title="Project" subtitle={selectedProjectLabel} onPress={() => setProjectSheetOpen(true)} chevron titleVariant="body" />
      </View>
      <View style={[styles.inputGroup, { backgroundColor: theme.colors.surfaceMuted }]}>
        <AppTextInput label="Notes" placeholder="Add details or context" multiline value={notes} onChangeText={setNotes} style={styles.cardInput} />
        {type === 'event' ? <AppTextInput label="Location" placeholder="Optional" value={location} onChangeText={setLocation} style={styles.cardInput} /> : null}
      </View>
        {error ? <AppText variant="meta" style={{ color: theme.colors.danger }}>{error}</AppText> : null}
        {readOnly ? <AppText variant="meta">This item is read-only from its connected source.</AppText> : null}
        {mode === 'edit' && !readOnly ? <Pressable accessibilityRole="button" onPress={() => Alert.alert(`Delete ${typeLabel.toLowerCase()}?`, 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove() }])} style={styles.deleteAction}><AppText variant="body" style={{ color: theme.colors.danger }}>Delete {typeLabel.toLowerCase()}</AppText></Pressable> : null}
        {canDeleteMatches ? <Pressable accessibilityRole="button" disabled={isLoadingMatches || isDeletingMatches} onPress={() => void loadMatchPreview()} style={styles.matchAction}><AppText variant="body" style={{ color: theme.colors.textSecondary }}>{isLoadingMatches ? 'Finding matches…' : 'Delete matching events…'}</AppText></Pressable> : null}
      </View>
    </CaptureFormShell>
    <CalendarChoiceSheet visible={typeSheetOpen} title="Create as" options={['event', 'reminder', 'task', 'project_action']} onSelect={chooseType} onClose={() => setTypeSheetOpen(false)} />
    <CalendarSourceChoiceSheet visible={calendarSheetOpen} options={[...calendarOptions, ...appleCalendarOptions.map((calendar) => ({ id: `apple:${calendar.id}`, name: `${calendar.title} · Apple Calendar`, color: calendar.color }))]} selectedId={calendarId} onSelect={(next) => { setCalendarId(next); setCalendarSheetOpen(false); }} onClose={() => setCalendarSheetOpen(false)} />
    <AppBottomSheet visible={Boolean(matchPreview)} onClose={() => { if (!isDeletingMatches) { setMatchPreview(null); setSelectedMatchIds(new Set()); } }} title="Delete matching events" snapPoints={['92%', '100%']} initialSnapPointIndex={0} footer={matchPreview ? <View style={styles.matchFooter}><AppText variant="meta">{selectedMatchIds.size} selected</AppText><Pressable disabled={!selectedMatchIds.size || isDeletingMatches} onPress={() => void deleteSelectedMatches()} style={[styles.deleteMatchesButton, { backgroundColor: theme.colors.danger, opacity: !selectedMatchIds.size || isDeletingMatches ? 0.5 : 1 }]}><AppText variant="button" style={{ color: theme.colors.onAccent }}>{isDeletingMatches ? 'Deleting…' : 'Delete selected'}</AppText></Pressable></View> : null}>
      {matchPreview ? <View style={styles.matchSheet}>
        <AppText variant="caption" style={{ color: theme.colors.textMuted }}>Review the events before removing them from Ledger.</AppText>
        <View style={[styles.scopeToggle, { borderColor: theme.colors.borderSubtle, backgroundColor: theme.colors.surface }]}>
          {(['future', 'all'] as const).map((scope) => <Pressable key={scope} disabled={isLoadingMatches || isDeletingMatches} onPress={() => void loadMatchPreview(scope)} style={[styles.scopeButton, matchScope === scope && { backgroundColor: theme.colors.surfaceMuted }]}><AppText variant="caption" style={matchScope === scope ? { color: theme.colors.textPrimary } : { color: theme.colors.textMuted }}>{scope === 'future' ? 'Future events' : 'All events'}</AppText></Pressable>)}
        </View>
        {matchPreview.matches.length === 0 ? <AppText variant="caption" style={styles.emptyMatches}>No matching events found.</AppText> : <View style={styles.matchList}>{matchPreview.matches.map((match) => <Pressable key={match.id} disabled={isDeletingMatches} onPress={() => setSelectedMatchIds((current) => { const next = new Set(current); if (next.has(match.id)) next.delete(match.id); else next.add(match.id); return next; })} style={styles.matchRow}><AppText variant="body" style={{ color: selectedMatchIds.has(match.id) ? theme.colors.textPrimary : theme.colors.textMuted }}>{selectedMatchIds.has(match.id) ? '✓' : '○'}</AppText><View style={styles.matchCopy}><AppText variant="caption">{match.title}</AppText><AppText variant="meta">{new Date(match.start_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · {match.reason}</AppText></View></Pressable>)}</View>}
      </View> : null}
    </AppBottomSheet>
    <WorkspaceSelectorSheet visible={workspaceSheetOpen} selectedWorkspaceId={workspaceId} workspaces={workspaceState.options} onSelect={(next) => { setWorkspaceId(next); setProjectId(null); setCalendarId(null); setWorkspaceSheetOpen(false); }} onClose={() => setWorkspaceSheetOpen(false)} />
    <ProjectPickerSheet visible={projectSheetOpen} projects={projects} selectedProjectId={projectId} onSelect={(next) => { setProjectId(next); setProjectSheetOpen(false); }} onClose={() => setProjectSheetOpen(false)} loading={projectsLoading} />
    <CaptureDateTimePickerSheet visible={dateSheetOpen} title="Select date" mode="date" value={parsedDate} onSelect={(next) => setDateInput(formatDateToLocalIsoDate(next))} onClose={() => setDateSheetOpen(false)} />
    <CaptureDateTimePickerSheet visible={startSheetOpen} title="Select time" mode="time" value={parsedStart} onSelect={(next) => setStartTime(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(next))} onClose={() => setStartSheetOpen(false)} />
    <CaptureDateTimePickerSheet visible={endSheetOpen} title="Select end time" mode="time" value={parsedEnd} onSelect={(next) => setEndTime(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(next))} onClose={() => setEndSheetOpen(false)} />
  </SafeAreaView>;
}

function CalendarChoiceSheet({ visible, title, options, onSelect, onClose }: { visible: boolean; title: string; options: CalendarEditorItemType[]; onSelect: (type: CalendarEditorItemType) => void; onClose: () => void }) {
  const theme = useLedgerTheme();
  return <View>{visible ? <View style={[styles.typeOverlay, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}><View style={styles.typeHeader}><AppText variant="bodyStrong">{title}</AppText><Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose}><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={22} tintColor={theme.colors.accent} /></Pressable></View>{options.map((option) => <Pressable key={option} onPress={() => onSelect(option)} style={styles.typeRow}><AppText variant="body">{option === 'project_action' ? 'Project action' : option.charAt(0).toUpperCase() + option.slice(1)}</AppText><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.colors.textMuted} /></Pressable>)}</View> : null}</View>;
}

function CalendarSourceChoiceSheet({ visible, options, selectedId, onSelect, onClose }: { visible: boolean; options: Array<{ id: string; name: string; color?: string }>; selectedId: string | null; onSelect: (id: string | null) => void; onClose: () => void }) {
  const theme = useLedgerTheme();
  return <View>{visible ? <View style={[styles.typeOverlay, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}><View style={styles.typeHeader}><AppText variant="bodyStrong">Choose calendar</AppText><Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose}><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={22} tintColor={theme.colors.accent} /></Pressable></View><Pressable onPress={() => onSelect(null)} style={styles.typeRow}><AppText variant="body">Default</AppText><AppText variant="meta">{selectedId ? '' : '✓'}</AppText></Pressable>{options.map((option) => <Pressable key={option.id} onPress={() => onSelect(option.id)} style={styles.typeRow}><View style={styles.sourceChoice}><View style={[styles.sourceDot, { backgroundColor: option.color ?? theme.colors.accent }]} /><AppText variant="body">{option.name}</AppText></View><AppText variant="meta">{selectedId === option.id ? '✓' : ''}</AppText></Pressable>)}</View> : null}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 58, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { minHeight: 44, justifyContent: 'center', minWidth: 58 },
  headerTitle: { fontSize: 17, lineHeight: 22 },
  formContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
  form: { gap: 14 },
  titleGroup: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18 },
  fieldGroup: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 18, gap: 2 },
  inputGroup: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 18, gap: 14 },
  cardInput: { borderBottomWidth: 0 },
  typeOverlay: { position: 'absolute', left: 16, right: 16, top: 80, zIndex: 10, padding: 16, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, elevation: 8 },
  typeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  typeRow: { minHeight: 56, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sourceChoice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceDot: { width: 8, height: 8, borderRadius: 4 },
  deleteAction: { paddingTop: 14, minHeight: 44 },
  matchAction: { minHeight: 44, justifyContent: 'center' },
  matchSheet: { gap: 14 },
  scopeToggle: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 2 },
  scopeButton: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  matchList: { borderRadius: 12 },
  matchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  matchCopy: { flex: 1, gap: 2 },
  emptyMatches: { paddingVertical: 28, textAlign: 'center' },
  matchFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  deleteMatchesButton: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});

export function calendarEditorParams(item: MobileCalendarItem, workspaceId: string) {
  return { mode: 'edit', type: item.type === 'external_event' ? 'event' : item.type === 'project_action' ? 'project_action' : item.type, workspaceId, itemId: item.id, dateKey: item.dateKey, startAt: item.startAt ?? '', endAt: item.endAt ?? '', title: item.title, projectId: item.projectId ?? '', calendarId: item.calendarId ?? '', allDay: item.allDay ? '1' : '0', readOnly: item.readOnly ? '1' : '0', sourcePlatform: item.sourcePlatform ?? '', seriesId: item.seriesId ?? '', importSeriesKey: item.importSeriesKey ?? '' };
}
