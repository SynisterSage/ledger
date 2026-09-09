import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { EmptyState, type MobileEmptyStateKind } from '@/components/EmptyState';
import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { Skeleton } from '@/components/Skeleton';
import { getMobileProjectDetail, type MobileProjectContextItem, type MobileProjectDetail, type MobileProjectResource, type MobileProjectTask } from '@/api/projectDetail';
import { deleteMobileProject, updateMobileProject, updateMobileProjectMilestone, type MobileProjectsMilestone } from '@/api/projects';
import { updateMobileTask } from '@/api/captures';
import { useLedgerTheme } from '@/theme';
import { openMobileNote } from '@/features/notes/openMobileNote';
import { useWorkspaceState } from '@/store/workspaceStore';
import { getMobileProjectPermissions } from '@/features/projects/projectPermissions';
import { projectTypeIcon } from '@/features/projects/projectTypeIcon';
import { NoteRow, noteRowDataFromSummary } from '@/features/notes/NoteRow';

function dateLabel(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}
function timeLabel(value?: string | null) {
  if (!value) return 'All day';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}
function isCompleteTask(task: MobileProjectTask) { return Boolean(task.completed_at) || ['completed', 'done', 'cancelled', 'dismissed'].includes(String(task.status ?? '').toLowerCase()); }
function isOverdueTask(task: MobileProjectTask) { return !isCompleteTask(task) && Boolean(task.due_date && task.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10)); }
function isOverdueMilestone(milestone: MobileProjectsMilestone) { return !milestone.completed && Boolean(milestone.milestone_date && milestone.milestone_date.slice(0, 10) < new Date().toISOString().slice(0, 10)); }
type ProjectPlanItem =
  | { kind: 'action'; item: MobileProjectTask; completed: boolean; overdue: boolean; date: string | null }
  | { kind: 'milestone'; item: MobileProjectsMilestone; completed: boolean; overdue: boolean; date: string | null };

function planItemIcon(kind: ProjectPlanItem['kind']): ResourceIconName {
  return kind === 'milestone'
    ? { ios: 'flag', android: 'flag', web: 'flag' }
    : { ios: 'checkmark.circle', android: 'check_circle_outline', web: 'check_circle_outline' };
}
function statusLabel(value?: string | null) { return String(value ?? 'Active').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '); }
function resourceTypeLabel(value?: string | null) {
  const labels: Record<string, string> = { note: 'Note', project: 'Project', task: 'Task', event: 'Event', reminder: 'Reminder', milestone: 'Milestone', intake: 'Intake', external_reference: 'Linked resource' };
  return labels[String(value ?? '').toLowerCase()] ?? 'Attached content';
}
function providerLabel(value?: string | null) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.replace(/[-_]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()) : null;
}
type ResourceIconName = ComponentProps<typeof SymbolView>['name'];
function resourceIcon(value?: string | null): ResourceIconName {
  const icons: Record<string, ResourceIconName> = {
    note: { ios: 'note.text', android: 'description', web: 'description' },
    event: { ios: 'calendar', android: 'event', web: 'event' },
    reminder: { ios: 'bell', android: 'notifications_none', web: 'notifications_none' },
    task: { ios: 'checkmark.circle', android: 'check_circle_outline', web: 'check_circle_outline' },
    project: { ios: 'folder', android: 'folder_open', web: 'folder_open' },
    external_reference: { ios: 'arrow.up.right.square', android: 'open_in_new', web: 'open_in_new' },
  };
  return icons[String(value ?? '').toLowerCase()] ?? icons.external_reference;
}

// Tasks and milestones already have dedicated project sections. This list is
// for the linked Ledger and integration context shown by the desktop app.
function isLinkedProjectContext(item: MobileProjectContextItem) {
  if (item.type === 'external_reference' || item.source === 'context_link') return true;
  return ['note', 'event', 'reminder'].includes(item.type) && item.relationship === 'contains';
}

export default function MobileProjectScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  const workspaceState = useWorkspaceState();
  const params = useLocalSearchParams<{ id: string }>();
  const scrollRef = useRef<ScrollView | null>(null);
  const [detail, setDetail] = useState<MobileProjectDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasksY, setTasksY] = useState<number | null>(null);
  const permissions = useMemo(() => getMobileProjectPermissions(detail?.project.workspace_id ?? workspaceState.selectedWorkspaceId, workspaceState.options), [detail?.project.workspace_id, workspaceState.options, workspaceState.selectedWorkspaceId]);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setIsLoading(true); setError(null); }
    try { setDetail(await getMobileProjectDetail(params.id, workspaceState.selectedWorkspaceId)); }
    catch (err) { if (!silent) setError(err instanceof Error ? err.message : 'Could not load this project.'); }
    finally { if (!silent) setIsLoading(false); }
  }, [params.id, workspaceState.selectedWorkspaceId]);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { if (detail) void load(true); }, [load, Boolean(detail)]));
  const refresh = useCallback(async () => { setIsRefreshing(true); try { await load(true); } finally { setIsRefreshing(false); } }, [load]);

  const planItems = useMemo<ProjectPlanItem[]>(() => {
    if (!detail) return [];
    const actions: ProjectPlanItem[] = detail.tasks.map((item) => ({ kind: 'action', item, completed: isCompleteTask(item), overdue: isOverdueTask(item), date: item.due_date ? dateLabel(item.due_date) : null }));
    const milestones: ProjectPlanItem[] = detail.milestones.map((item) => ({ kind: 'milestone', item, completed: Boolean(item.completed), overdue: isOverdueMilestone(item), date: dateLabel(item.milestone_date) }));
    return [...actions, ...milestones].sort((left, right) => Number(left.completed) - Number(right.completed) || Number(right.overdue) - Number(left.overdue) || String(left.date ?? '9999-12-31').localeCompare(String(right.date ?? '9999-12-31')));
  }, [detail]);

  const completeTask = useCallback((task: MobileProjectTask) => {
    if (!detail) return;
    setDetail({ ...detail, tasks: detail.tasks.map((item) => item.id === task.id ? { ...item, status: 'completed', completed_at: new Date().toISOString() } : item) });
    void updateMobileTask(detail.project.workspace_id, task.id, { status: 'completed' }).then(() => load(true)).catch(() => { void load(true); Alert.alert('Could not complete action', 'Please try again.'); });
  }, [detail, load]);
  const completeMilestone = useCallback((milestoneId: string) => {
    if (!detail) return;
    setDetail({ ...detail, milestones: detail.milestones.map((item) => item.id === milestoneId ? { ...item, completed: true } : item) });
    void updateMobileProjectMilestone(detail.project.workspace_id, milestoneId, { completed: true }).then(() => load(true)).catch(() => { void load(true); Alert.alert('Could not complete milestone', 'Please try again.'); });
  }, [detail, load]);
  const updateStatus = useCallback((status: string) => {
    if (!detail) return;
    setDetail({ ...detail, project: { ...detail.project, status } });
    void updateMobileProject(detail.project.workspace_id, detail.project.id, { status }).catch(() => { void load(true); Alert.alert('Could not update project', 'Please try again.'); });
  }, [detail, load]);
  const openActions = useCallback(() => {
    if (!detail) return;
    Alert.alert(detail.project.name, undefined, [
      ...(permissions.canAddAction ? [{ text: 'Add action', onPress: () => router.push({ pathname: '/capture/project-action', params: { projectId: detail.project.id, workspaceId: detail.project.workspace_id, returnTo: `/project/${detail.project.id}` } }) }] : []),
      ...(permissions.canAddMilestone ? [{ text: 'Add milestone', onPress: () => router.push({ pathname: '/project/milestone-new', params: { projectId: detail.project.id, workspaceId: detail.project.workspace_id } }) }] : []),
      ...(permissions.canAddNote ? [{ text: 'Add note', onPress: () => router.push({ pathname: '/capture/note', params: { projectId: detail.project.id, workspaceId: detail.project.workspace_id } }) }] : []),
      ...(permissions.canEdit ? [{ text: 'Edit project', onPress: () => router.push({ pathname: '/project/edit', params: { id: detail.project.id, workspaceId: detail.project.workspace_id } }) }] : []),
      ...(permissions.canChangeStatus ? [{ text: 'Update status', onPress: () => Alert.alert('Update status', undefined, [
        { text: 'Planned', onPress: () => updateStatus('NotStarted') },
        { text: 'Active', onPress: () => updateStatus('InProgress') },
        { text: 'On hold', onPress: () => updateStatus('Paused') },
        { text: 'Completed', onPress: () => updateStatus('Completed') },
        { text: 'Cancel', style: 'cancel' },
      ]) }] : []),
      ...(permissions.canArchive ? [{ text: 'Archive project', onPress: () => Alert.alert('Archive this project?', 'It will be removed from active views but can be restored.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Archive', onPress: () => updateStatus('Archived') }]) }] : []),
      ...(permissions.canDelete ? [{ text: 'Delete project', style: 'destructive' as const, onPress: () => Alert.alert('Delete this project?', 'This permanently removes the project. Linked content is not deleted unless the existing project rules require it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void deleteMobileProject(detail.project.workspace_id, detail.project.id).then(() => router.back()).catch(() => Alert.alert('Could not delete project', 'Please try again.')) }]) }] : []),
      { text: 'Cancel', style: 'cancel' },
    ] as any);
  }, [detail, permissions, router, updateStatus]);

  const topFadeOffset = insets.top + theme.spacing.lg + 52;
  const projectFadeProps = { topFadeOffset, topFadeOpacityScale: 0.28, topFadeHeight: 56 };
  if (isLoading) return <Screen contentStyle={{ paddingTop: theme.spacing.lg }} {...projectFadeProps}><CaptureHeader title="Project" /><ProjectSkeleton /></Screen>;
  if (error || !detail) return <Screen contentStyle={{ paddingTop: theme.spacing.lg }} {...projectFadeProps}><CaptureHeader title="Project" /><EmptyState iconName={{ ios: 'folder', android: 'folder_open', web: 'folder_open' }} title="Project unavailable" description={error ?? 'This project may have been deleted.'} kind="unavailable" primaryAction={error ? { label: 'Retry', onPress: () => void load() } : { label: 'Return to Projects', onPress: () => router.back() }} secondaryAction={error ? { label: 'Return to Projects', variant: 'link', onPress: () => router.back() } : undefined} /></Screen>;

  const { project } = detail;
  const attachedContent = [
    ...detail.relatedContext.filter(isLinkedProjectContext),
    ...detail.resources.map((resource: MobileProjectResource) => ({
      id: `connected:${resource.id ?? resource.name ?? resource.canonical_url ?? 'resource'}`,
      type: 'external_reference',
      title: resource.name || 'Linked resource',
      provider: resource.provider || (typeof resource.external_metadata?.provider === 'string' ? resource.external_metadata.provider : null),
      url: resource.canonical_url ?? null,
      relationship: 'references',
      sourceLabel: null,
    })),
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 10);
  const progress = typeof project.completeness === 'number' ? Math.max(0, Math.min(100, project.completeness)) : null;
  return <Screen contentStyle={{ paddingTop: theme.spacing.lg }} {...projectFadeProps}>
    <CaptureHeader title="Project" rightAccessory={!permissions.readOnly ? <Pressable accessibilityRole="button" accessibilityLabel="Project actions" onPress={openActions} hitSlop={10}><SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={19} tintColor={theme.colors.textSecondary} /></Pressable> : undefined} />
    <ScrollView ref={scrollRef} refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={theme.colors.accent} />} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.summary}>
        <View style={styles.titleLine}><View style={[styles.projectMarker, { backgroundColor: project.color || theme.colors.accent }]}><SymbolView name={projectTypeIcon(project.project_type)} size={15} tintColor="#FFFFFF" />{project.attention ? <View style={[styles.attentionBadge, { backgroundColor: project.attention.severity === 'critical' ? theme.colors.danger : theme.colors.warning }]}><SymbolView name={{ ios: 'exclamationmark', android: 'priority_high', web: 'priority_high' }} size={8} tintColor="#FFFFFF" /></View> : null}</View><AppText variant="title" numberOfLines={2} style={styles.title}>{project.name}</AppText></View>
        <AppText variant="caption">{[statusLabel(project.status), project.end_date ? `Due ${dateLabel(project.end_date)}` : null, progress !== null ? `${progress}%` : null].filter(Boolean).join(' · ')}</AppText>
        {project.description ? <AppText variant="meta" numberOfLines={3}>{project.description}</AppText> : null}
        {progress !== null ? <View style={[styles.progressTrack, { backgroundColor: theme.colors.borderSubtle }]}><View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: project.color || theme.colors.accent }]} /></View> : null}
      </View>

      {project.attention ? <Pressable onPress={() => tasksY !== null && scrollRef.current?.scrollTo({ y: Math.max(0, tasksY - 16), animated: true })} style={[styles.attention, { borderLeftColor: project.attention.severity === 'critical' ? theme.colors.danger : theme.colors.warning }]}><SymbolView name={{ ios: 'exclamationmark', android: 'priority_high', web: 'priority_high' }} size={15} tintColor={project.attention.severity === 'critical' ? theme.colors.danger : theme.colors.warning} /><AppText variant="meta" style={{ color: project.attention.severity === 'critical' ? theme.colors.danger : theme.colors.warning, flex: 1 }}>{project.attention.label}</AppText></Pressable> : null}

      <View onLayout={(event) => setTasksY(event.nativeEvent.layout.y)}><Section title="Project plan" action={permissions.canAddAction || permissions.canAddMilestone ? '+ Add' : undefined} onAction={permissions.canAddAction || permissions.canAddMilestone ? openActions : undefined}>{detail.sectionErrors.tasks ? <SectionFailure message={detail.sectionErrors.tasks} onRetry={() => void load(true)} /> : planItems.length ? <View style={[styles.planCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}>{planItems.map((planItem) => <ProjectPlanCard key={`${planItem.kind}:${planItem.item.id}`} planItem={planItem} projectColor={project.color || theme.colors.accent} canComplete={planItem.kind === 'action' ? permissions.canAddAction : permissions.canAddMilestone} onComplete={() => planItem.kind === 'action' ? completeTask(planItem.item) : completeMilestone(planItem.item.id)} onPress={() => planItem.kind === 'action' ? Alert.alert(planItem.item.title, planItem.item.due_date ? `Due ${dateLabel(planItem.item.due_date)}` : 'No due date') : router.push(`/project/${project.id}?milestoneId=${planItem.item.id}`)} />)}</View> : <ProjectEmptyState iconName={{ ios: 'checklist', android: 'checklist', web: 'checklist' }} title="Nothing planned yet" description={permissions.canAddAction || permissions.canAddMilestone ? 'Add an action or milestone to give this project a clear next step.' : 'There are no actions or milestones in this project.'} kind={permissions.canAddAction || permissions.canAddMilestone ? 'first-use' : 'permission'} actionLabel={permissions.canAddAction || permissions.canAddMilestone ? 'Add to plan' : undefined} onAction={permissions.canAddAction || permissions.canAddMilestone ? openActions : undefined} />}</Section></View>
      <Section title="Notes" action={permissions.canAddNote ? '+ New' : undefined} onAction={permissions.canAddNote ? () => router.push({ pathname: '/capture/note', params: { projectId: project.id, workspaceId: project.workspace_id } }) : undefined}>{detail.sectionErrors.notes ? <SectionFailure message={detail.sectionErrors.notes} onRetry={() => void load(true)} /> : detail.notes.length ? <View style={styles.simpleRows}>{detail.notes.slice(0, 4).map((note) => <NoteRow key={note.id} note={noteRowDataFromSummary({ id: note.id, workspace_id: project.workspace_id, title: note.title, preview: note.preview, mode: 'text', updated_at: note.updated_at ?? null, created_at: null }, { projectTitle: project.name })} variant="section" showPreview={false} onPress={() => openMobileNote(router, note.id, { workspaceId: project.workspace_id, returnTo: `/project/${project.id}` })} />)}</View> : <ProjectEmptyState iconName={{ ios: 'note.text', android: 'note', web: 'note' }} title="No project notes yet" description={permissions.canAddNote ? 'Capture context here so the next action has somewhere to start.' : 'There are no notes attached to this project.'} kind={permissions.canAddNote ? 'first-use' : 'permission'} actionLabel={permissions.canAddNote ? 'New note' : undefined} onAction={permissions.canAddNote ? () => router.push({ pathname: '/capture/note', params: { projectId: project.id, workspaceId: project.workspace_id } }) : undefined} />}</Section>
      <Section title="Calendar">{detail.sectionErrors.calendar ? <SectionFailure message={detail.sectionErrors.calendar} onRetry={() => void load(true)} /> : detail.calendar.length ? <View style={styles.simpleRows}>{detail.calendar.slice(0, 5).map((item) => <Pressable key={item.id} onPress={() => router.push('/(tabs)/calendar')} style={styles.simpleRow}><SymbolView name={{ ios: item.allDay ? 'calendar' : 'clock', android: item.allDay ? 'event' : 'schedule', web: item.allDay ? 'event' : 'schedule' }} size={16} tintColor={theme.colors.textMuted} /><View style={styles.rowCopy}><AppText variant="body" numberOfLines={1}>{item.title}</AppText><AppText variant="caption">{dateLabel(item.dateKey)} · {item.allDay ? 'All day' : timeLabel(item.startAt)}</AppText></View></Pressable>)}</View> : <ProjectEmptyState iconName={{ ios: 'calendar', android: 'event', web: 'event' }} title="No calendar items linked" description="Open Calendar to see what is planned around this project." kind="informational" actionLabel="View calendar" onAction={() => router.push('/(tabs)/calendar')} />}</Section>
      <Section title="Related context">{detail.sectionErrors.resources ? <SectionFailure message={detail.sectionErrors.resources} onRetry={() => void load(true)} /> : attachedContent.length ? <View style={styles.simpleRows}>{attachedContent.map((resource) => { const provider = providerLabel(resource.provider || resource.sourceLabel); const subtitle = [resourceTypeLabel(resource.type), provider].filter(Boolean).join(' · '); return <Pressable key={resource.id} onPress={() => resource.url ? void Linking.openURL(resource.url) : Alert.alert(resource.title, subtitle)} style={styles.simpleRow}><SymbolView name={resourceIcon(resource.type)} size={16} tintColor={theme.colors.textMuted} /><View style={styles.rowCopy}><AppText variant="body" numberOfLines={1}>{resource.title}</AppText><AppText variant="caption" numberOfLines={1}>{subtitle}</AppText></View>{resource.url ? <SymbolView name={{ ios: 'arrow.up.right', android: 'open_in_new', web: 'open_in_new' }} size={14} tintColor={theme.colors.textMuted} /> : null}</Pressable>; })}</View> : <ProjectEmptyState iconName={{ ios: 'link', android: 'link', web: 'link' }} title="No related context yet" description="Linked Ledger context and integration resources will appear here." kind="informational" />}</Section>
      {detail.activity.length ? <Section title="Activity"><View style={styles.simpleRows}>{detail.activity.slice(0, 5).map((item) => <View key={item.id} style={styles.activityRow}><AppText variant="caption" numberOfLines={2} ellipsizeMode="tail" style={styles.activityTitle}>{item.title}</AppText><AppText variant="caption" numberOfLines={1} style={styles.activityTimestamp}>{dateLabel(item.timestamp)}</AppText></View>)}</View></Section> : null}
    </ScrollView>
  </Screen>;
}

function ProjectPlanCard({ planItem, projectColor, canComplete, onComplete, onPress }: { planItem: ProjectPlanItem; projectColor: string; canComplete: boolean; onComplete: () => void; onPress: () => void }) {
  const theme = useLedgerTheme();
  const title = planItem.item.title;
  const typeLabel = planItem.kind === 'milestone' ? 'Milestone' : 'Action';
  const metadata = [planItem.date ?? 'No date', planItem.completed ? 'Completed' : typeLabel].join(' · ');
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${metadata}`} onPress={onPress} onLongPress={canComplete && !planItem.completed ? () => Alert.alert(title, undefined, [{ text: 'Complete', onPress: onComplete }, { text: 'Cancel', style: 'cancel' }]) : undefined} style={({ pressed }) => [styles.planRow, { opacity: pressed ? 0.68 : planItem.completed ? 0.58 : 1 }]}>
    <View style={[styles.planIcon, { backgroundColor: planItem.completed ? theme.colors.borderSubtle : projectColor }]}><SymbolView name={planItemIcon(planItem.kind)} size={15} tintColor={planItem.completed ? theme.colors.textMuted : '#FFFFFF'} /></View>
    <View style={styles.rowCopy}><AppText variant="body" numberOfLines={2} style={planItem.completed ? styles.completedTaskTitle : undefined}>{title}</AppText><AppText variant="caption" style={planItem.overdue ? { color: theme.colors.warning } : undefined}>{metadata}{planItem.overdue ? ' · Overdue' : ''}</AppText></View>
    <SymbolView name={planItem.completed ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' } : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={planItem.completed ? theme.colors.success : theme.colors.textMuted} />
  </Pressable>;
}
function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) { const theme = useLedgerTheme(); return <View style={styles.sectionHeader}><AppText variant="label" style={{ letterSpacing: 0.5 }}>{title}</AppText>{action ? <Pressable onPress={onAction}><AppText variant="caption" style={{ color: theme.colors.accent }}>{action}</AppText></Pressable> : null}</View>; }
function Section({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: ReactNode }) { return <View style={styles.section}><SectionHeader title={title} action={action} onAction={onAction} />{children}</View>; }
function InlineAction({ label, onPress }: { label: string; onPress: () => void }) { const theme = useLedgerTheme(); return <Pressable onPress={onPress} style={styles.inlineAction}><AppText variant="caption" style={{ color: theme.colors.accent }}>{label}</AppText></Pressable>; }
function EmptyInline({ title, detail }: { title: string; detail: string }) { return <View style={styles.emptyInline}><AppText variant="body">{title}</AppText><AppText variant="caption">{detail}</AppText></View>; }
function SectionFailure({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.emptyInline}><AppText variant="caption">{message}</AppText><InlineAction label="Retry" onPress={onRetry} /></View>; }
function ProjectEmptyState({ iconName, title, description, kind = 'informational', actionLabel, onAction }: { iconName: ResourceIconName; title: string; description: string; kind?: MobileEmptyStateKind; actionLabel?: string; onAction?: () => void }) {
  return <EmptyState iconName={iconName} title={title} description={description} kind={kind} density="compact" style={styles.emptyInline} primaryAction={actionLabel && onAction ? { label: actionLabel, onPress: onAction } : undefined} />;
}
function ProjectSkeleton() { const theme = useLedgerTheme(); return <View style={styles.skeleton}><Skeleton width={220} height={28} radius={7} /><Skeleton width={180} height={16} radius={5} /><Skeleton width="100%" height={3} radius={2} /><View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.lg }}><Skeleton width={130} height={16} radius={5} /><Skeleton width="100%" height={54} radius={6} /><Skeleton width="100%" height={54} radius={6} /><Skeleton width={110} height={16} radius={5} /></View></View>; }

const styles = StyleSheet.create({ content: { paddingBottom: 64, gap: 24 }, summary: { gap: 8 }, titleLine: { flexDirection: 'row', alignItems: 'center', gap: 10 }, title: { flex: 1 }, projectMarker: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center', position: 'relative' }, attentionBadge: { position: 'absolute', right: -4, bottom: -4, width: 12, height: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF' }, progressTrack: { height: 3, overflow: 'hidden', marginTop: 3 }, progressFill: { height: 3 }, attention: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10, borderLeftWidth: 2, paddingHorizontal: 12, backgroundColor: 'transparent' }, section: { gap: 9 }, sectionHeader: { minHeight: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, simpleRows: { gap: 2 }, simpleRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }, simpleRowPressed: { opacity: 0.68 }, planCard: { overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 5 }, planRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E8E1DA' }, planIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, rowCopy: { minWidth: 0, flex: 1, gap: 2 }, completedTaskTitle: { color: '#9CA3AF', textDecorationLine: 'line-through' }, overdueMark: { width: 16, textAlign: 'right' }, smallDot: { width: 7, height: 7, borderRadius: 1, transform: [{ rotate: '45deg' }] }, taskDot: { width: 8, height: 8, borderRadius: 999 }, inlineAction: { paddingVertical: 5 }, activityRow: { minHeight: 46, flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 6 }, activityTitle: { minWidth: 0, flex: 1 }, activityTimestamp: { width: 52, textAlign: 'right' }, emptyInline: { paddingVertical: 7, gap: 2 }, unavailable: { gap: 9, paddingTop: 24 }, skeleton: { gap: 12, paddingTop: 12 }, });
