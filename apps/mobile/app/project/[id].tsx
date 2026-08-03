import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { AppText } from '@/components/AppText';
import { CaptureHeader } from '@/components/CaptureHeader';
import { Screen } from '@/components/Screen';
import { Skeleton } from '@/components/Skeleton';
import { getMobileProjectDetail, type MobileProjectDetail, type MobileProjectTask } from '@/api/projectDetail';
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
function statusLabel(value?: string | null) { return String(value ?? 'Active').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '); }

export default function MobileProjectScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
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

  const openTasks = useMemo(() => detail?.tasks.filter((task) => !isCompleteTask(task)).sort((left, right) => Number(isOverdueTask(right)) - Number(isOverdueTask(left)) || String(left.due_date ?? '9999-12-31').localeCompare(String(right.due_date ?? '9999-12-31'))) ?? [], [detail?.tasks]);
  const milestones = useMemo(() => detail?.milestones.filter((item) => !item.completed).sort((a, b) => String(a.milestone_date ?? '').localeCompare(String(b.milestone_date ?? ''))).slice(0, 4) ?? [], [detail?.milestones]);

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

  if (isLoading) return <Screen contentStyle={{ paddingTop: theme.spacing.lg }}><CaptureHeader title="Project" /><ProjectSkeleton /></Screen>;
  if (error || !detail) return <Screen contentStyle={{ paddingTop: theme.spacing.lg }}><CaptureHeader title="Project" /><View style={styles.unavailable}><AppText variant="bodyStrong">Project unavailable</AppText><AppText variant="meta">{error ?? 'This project may have been deleted.'}</AppText><AppText variant="caption" style={{ color: theme.colors.accent }} onPress={() => router.back()}>Return to Projects</AppText></View></Screen>;

  const { project } = detail;
  const progress = typeof project.completeness === 'number' ? Math.max(0, Math.min(100, project.completeness)) : null;
  return <Screen contentStyle={{ paddingTop: theme.spacing.lg }}>
    <CaptureHeader title="Project" rightAccessory={!permissions.readOnly ? <Pressable accessibilityRole="button" accessibilityLabel="Project actions" onPress={openActions} hitSlop={10}><SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={19} tintColor={theme.colors.textSecondary} /></Pressable> : undefined} />
    <ScrollView ref={scrollRef} refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={theme.colors.accent} />} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.summary}>
        <View style={styles.titleLine}><View style={[styles.projectMarker, { backgroundColor: project.color || theme.colors.accent }]}><SymbolView name={projectTypeIcon(project.project_type)} size={15} tintColor="#FFFFFF" />{project.attention ? <View style={[styles.attentionBadge, { backgroundColor: project.attention.severity === 'critical' ? theme.colors.danger : theme.colors.warning }]}><SymbolView name={{ ios: 'exclamationmark', android: 'priority_high', web: 'priority_high' }} size={8} tintColor="#FFFFFF" /></View> : null}</View><AppText variant="title" numberOfLines={2} style={styles.title}>{project.name}</AppText></View>
        <AppText variant="caption">{[statusLabel(project.status), project.end_date ? `Due ${dateLabel(project.end_date)}` : null, progress !== null ? `${progress}%` : null].filter(Boolean).join(' · ')}</AppText>
        {project.description ? <AppText variant="meta" numberOfLines={3}>{project.description}</AppText> : null}
        {progress !== null ? <View style={[styles.progressTrack, { backgroundColor: theme.colors.borderSubtle }]}><View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: project.color || theme.colors.accent }]} /></View> : null}
      </View>

      {project.attention ? <Pressable onPress={() => tasksY !== null && scrollRef.current?.scrollTo({ y: Math.max(0, tasksY - 16), animated: true })} style={[styles.attention, { borderLeftColor: project.attention.severity === 'critical' ? theme.colors.danger : theme.colors.warning }]}><SymbolView name={{ ios: 'exclamationmark', android: 'priority_high', web: 'priority_high' }} size={15} tintColor={project.attention.severity === 'critical' ? theme.colors.danger : theme.colors.warning} /><AppText variant="meta" style={{ color: project.attention.severity === 'critical' ? theme.colors.danger : theme.colors.warning, flex: 1 }}>{project.attention.label}</AppText></Pressable> : null}

      <View onLayout={(event) => setTasksY(event.nativeEvent.layout.y)}>{detail.tasks.length || detail.sectionErrors.tasks ? <Section title="Tasks" action={detail.sectionErrors.tasks ? undefined : permissions.canAddAction ? '+ Add' : `${openTasks.length} open`} onAction={permissions.canAddAction ? () => router.push({ pathname: '/capture/project-action', params: { projectId: project.id, workspaceId: project.workspace_id, returnTo: `/project/${project.id}` } }) : undefined}>{detail.sectionErrors.tasks ? <SectionFailure message={detail.sectionErrors.tasks} onRetry={() => void load(true)} /> : <View style={styles.simpleRows}>{detail.tasks.map((task) => { const completed = isCompleteTask(task); const overdue = isOverdueTask(task); return <Pressable key={task.id} onPress={() => Alert.alert(task.title, task.due_date ? `Due ${dateLabel(task.due_date)}` : 'No due date')} onLongPress={!completed && permissions.canAddAction ? () => Alert.alert(task.title, undefined, [{ text: 'Complete', onPress: () => completeTask(task) }, { text: 'Cancel', style: 'cancel' }]) : undefined} style={({ pressed }) => [styles.simpleRow, pressed && styles.simpleRowPressed]}><View style={[styles.taskDot, { backgroundColor: completed ? theme.colors.textMuted : overdue ? theme.colors.warning : project.color || theme.colors.accent }]} /><View style={styles.rowCopy}><AppText variant="body" numberOfLines={1} style={completed ? styles.completedTaskTitle : undefined}>{task.title}</AppText><AppText variant="caption">{task.due_date ? dateLabel(task.due_date) : 'No due date'} · {completed ? 'Completed' : 'Task'}</AppText></View>{overdue ? <AppText variant="bodyStrong" accessibilityLabel="Overdue" style={[styles.overdueMark, { color: theme.colors.warning }]}>!</AppText> : null}</Pressable>; })}</View>}</Section> : null}</View>
      {detail.milestones.length ? <Section title="Milestones" action={permissions.canAddMilestone ? "+ Add" : undefined} onAction={permissions.canAddMilestone ? () => router.push({ pathname: '/project/milestone-new', params: { projectId: project.id, workspaceId: project.workspace_id } }) : undefined}><View style={styles.simpleRows}>{milestones.map((milestone) => { const overdue = isOverdueMilestone(milestone); return <Pressable key={milestone.id} onPress={() => router.push(`/project/${project.id}?milestoneId=${milestone.id}`)} onLongPress={() => permissions.canAddMilestone ? Alert.alert(milestone.title, `${dateLabel(milestone.milestone_date)} · Milestone`, [{ text: 'Mark complete', onPress: () => completeMilestone(milestone.id) }, { text: 'Cancel', style: 'cancel' }]) : undefined} style={styles.simpleRow}><View style={[styles.smallDot, { backgroundColor: overdue ? theme.colors.warning : project.color || theme.colors.accent }]} /><View style={styles.rowCopy}><AppText variant="body" numberOfLines={1}>{milestone.title}</AppText><AppText variant="caption">{dateLabel(milestone.milestone_date)} · Milestone</AppText></View>{overdue ? <AppText variant="bodyStrong" accessibilityLabel="Overdue" style={[styles.overdueMark, { color: theme.colors.warning }]}>!</AppText> : null}</Pressable>; })}</View>{detail.milestones.filter((item) => !item.completed).length > 4 ? <InlineAction label="View all milestones" onPress={() => router.push(`/project/${project.id}?milestones=all`)} /> : null}</Section> : null}
      {detail.notes.length || detail.sectionErrors.notes ? <Section title="Notes" action={detail.sectionErrors.notes || !permissions.canAddNote ? undefined : "+ New"} onAction={permissions.canAddNote ? () => router.push({ pathname: '/capture/note', params: { projectId: project.id, workspaceId: project.workspace_id } }) : undefined}>{detail.sectionErrors.notes ? <SectionFailure message={detail.sectionErrors.notes} onRetry={() => void load(true)} /> : <View style={styles.simpleRows}>{detail.notes.slice(0, 4).map((note) => <NoteRow key={note.id} note={noteRowDataFromSummary({ id: note.id, workspace_id: project.workspace_id, title: note.title, preview: note.preview, mode: 'text', updated_at: note.updated_at ?? null, created_at: null }, { projectTitle: project.name })} variant="section" showPreview={false} onPress={() => openMobileNote(router, note.id, { workspaceId: project.workspace_id, returnTo: `/project/${project.id}` })} />)}</View>}</Section> : null}
      {detail.calendar.length || detail.sectionErrors.calendar ? <Section title="Calendar">{detail.sectionErrors.calendar ? <SectionFailure message={detail.sectionErrors.calendar} onRetry={() => void load(true)} /> : <View style={styles.simpleRows}>{detail.calendar.slice(0, 5).map((item) => <Pressable key={item.id} onPress={() => router.push('/(tabs)/calendar')} style={styles.simpleRow}><SymbolView name={{ ios: item.allDay ? 'calendar' : 'clock', android: item.allDay ? 'event' : 'schedule', web: item.allDay ? 'event' : 'schedule' }} size={16} tintColor={theme.colors.textMuted} /><View style={styles.rowCopy}><AppText variant="body" numberOfLines={1}>{item.title}</AppText><AppText variant="caption">{dateLabel(item.dateKey)} · {item.allDay ? 'All day' : timeLabel(item.startAt)}</AppText></View></Pressable>)}</View>}</Section> : null}
      {detail.resources.length || detail.sectionErrors.resources ? <Section title="Resources" action={detail.sectionErrors.resources ? undefined : "+ Link"} onAction={() => Alert.alert('Link resource', 'Resource linking is available from the desktop project workspace.')}>{detail.sectionErrors.resources ? <SectionFailure message={detail.sectionErrors.resources} onRetry={() => void load(true)} /> : <View style={styles.simpleRows}>{detail.resources.slice(0, 5).map((resource, index) => <Pressable key={resource.id ?? String(index)} onPress={() => Alert.alert(resource.name ?? 'Resource', resource.provider ?? resource.type ?? 'Linked resource')} style={styles.simpleRow}><SymbolView name={{ ios: 'link', android: 'link', web: 'link' }} size={16} tintColor={theme.colors.textMuted} /><View style={styles.rowCopy}><AppText variant="body" numberOfLines={1}>{resource.name ?? 'Linked resource'}</AppText><AppText variant="caption">{resource.provider ?? resource.type ?? 'External resource'}</AppText></View></Pressable>)}</View>}</Section> : null}
      {detail.activity.length ? <Section title="Activity"><View style={styles.simpleRows}>{detail.activity.slice(0, 5).map((item) => <View key={item.id} style={styles.activityRow}><AppText variant="caption" numberOfLines={2} ellipsizeMode="tail" style={styles.activityTitle}>{item.title}</AppText><AppText variant="caption" numberOfLines={1} style={styles.activityTimestamp}>{dateLabel(item.timestamp)}</AppText></View>)}</View></Section> : null}
    </ScrollView>
  </Screen>;
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) { const theme = useLedgerTheme(); return <View style={styles.sectionHeader}><AppText variant="label" style={{ letterSpacing: 0.5 }}>{title}</AppText>{action ? <Pressable onPress={onAction}><AppText variant="caption" style={{ color: theme.colors.accent }}>{action}</AppText></Pressable> : null}</View>; }
function Section({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: ReactNode }) { return <View style={styles.section}><SectionHeader title={title} action={action} onAction={onAction} />{children}</View>; }
function InlineAction({ label, onPress }: { label: string; onPress: () => void }) { const theme = useLedgerTheme(); return <Pressable onPress={onPress} style={styles.inlineAction}><AppText variant="caption" style={{ color: theme.colors.accent }}>{label}</AppText></Pressable>; }
function EmptyInline({ title, detail }: { title: string; detail: string }) { return <View style={styles.emptyInline}><AppText variant="body">{title}</AppText><AppText variant="caption">{detail}</AppText></View>; }
function SectionFailure({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.emptyInline}><AppText variant="caption">{message}</AppText><InlineAction label="Retry" onPress={onRetry} /></View>; }
function ProjectSkeleton() { const theme = useLedgerTheme(); return <View style={styles.skeleton}><Skeleton width={220} height={28} radius={7} /><Skeleton width={180} height={16} radius={5} /><Skeleton width="100%" height={3} radius={2} /><View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.lg }}><Skeleton width={130} height={16} radius={5} /><Skeleton width="100%" height={54} radius={6} /><Skeleton width="100%" height={54} radius={6} /><Skeleton width={110} height={16} radius={5} /></View></View>; }

const styles = StyleSheet.create({ content: { paddingBottom: 64, gap: 24 }, summary: { gap: 8 }, titleLine: { flexDirection: 'row', alignItems: 'center', gap: 10 }, title: { flex: 1 }, projectMarker: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center', position: 'relative' }, attentionBadge: { position: 'absolute', right: -4, bottom: -4, width: 12, height: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF' }, progressTrack: { height: 3, overflow: 'hidden', marginTop: 3 }, progressFill: { height: 3 }, attention: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10, borderLeftWidth: 2, paddingHorizontal: 12, backgroundColor: 'transparent' }, section: { gap: 9 }, sectionHeader: { minHeight: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, simpleRows: { gap: 2 }, simpleRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }, simpleRowPressed: { opacity: 0.68 }, rowCopy: { minWidth: 0, flex: 1, gap: 2 }, completedTaskTitle: { color: '#9CA3AF', textDecorationLine: 'line-through' }, overdueMark: { width: 16, textAlign: 'right' }, smallDot: { width: 7, height: 7, borderRadius: 1, transform: [{ rotate: '45deg' }] }, taskDot: { width: 8, height: 8, borderRadius: 999 }, inlineAction: { paddingVertical: 5 }, activityRow: { minHeight: 46, flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 6 }, activityTitle: { minWidth: 0, flex: 1 }, activityTimestamp: { width: 52, textAlign: 'right' }, emptyInline: { paddingVertical: 7, gap: 2 }, unavailable: { gap: 9, paddingTop: 24 }, skeleton: { gap: 12, paddingTop: 12 }, });
