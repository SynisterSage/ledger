import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { Skeleton } from '@/components/Skeleton';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { TodayHeader, TODAY_HEADER_SCROLL_SPACE } from '@/features/today/TodayHeader';
import { useSearchSheet } from '@/features/search/SearchSheetContext';
import { ProjectRow } from '@/features/projects/ProjectRow';
import { toProjectRowModel } from '@/features/projects/projectRowModel';
import { ProjectFilterSheet } from '@/features/projects/ProjectFilterSheet';
import {
  DEFAULT_PROJECT_FILTERS,
  isCompletedProject,
  matchesProjectFilters,
  projectFilterCount,
  projectFilterSummary,
  sortProjects,
  type ProjectFilterState,
} from '@/features/projects/projectFilters';
import { deleteMobileProjectMilestone, getMobileProjects, updateMobileProjectMilestone, type MobileProjectsMilestone, type MobileProjectsProject } from '@/api/projects';
import { filterProjectDates, groupProjectDates, normalizeProjectDates, projectDateLabel, type MobileProjectDate, type MobileProjectDateGroup } from '@/features/projects/projectDates';
import { useLedgerTheme } from '@/theme';
import { bootstrapWorkspaceState, getWorkspaceLabel, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import { getMobileProjectPermissions } from '@/features/projects/projectPermissions';
import { NewProjectSheet } from '@/features/projects/NewProjectSheet';
import { useMobileUnreadNotificationCount } from '@/features/notifications/useMobileUnreadNotificationCount';
import { MobileActionsSheet, type MobileActionSheetAction } from '@/features/today/TodayItemActionsSheet';

type ViewMode = 'projects' | 'milestones';
type QuickFilter = 'all' | 'active' | 'mine' | 'due' | 'completed';
type ProjectSection = 'attention' | 'active' | 'upcoming' | 'hold' | 'completed';

const SECTION_TITLES: Record<ProjectSection, string> = {
  attention: 'Needs Attention', active: 'Active', upcoming: 'Upcoming', hold: 'On Hold', completed: 'Completed',
};

const projectFilterSession = new Map<string, ProjectFilterState>();
const copyDefaultFilters = (): ProjectFilterState => ({ ...DEFAULT_PROJECT_FILTERS, status: [], attention: [], date: [], progress: [] });

function isCompleted(project: MobileProjectsProject) { return isCompletedProject(project); }
function isPaused(project: MobileProjectsProject) { return /paused|hold|archived/.test(String(project.status ?? '').toLowerCase()); }
function isDueSoon(project: MobileProjectsProject) {
  if (!project.end_date) return false;
  const due = new Date(`${project.end_date}T12:00:00`).getTime();
  return due >= Date.now() - 86400000 && due <= Date.now() + 14 * 86400000;
}
export default function ProjectsScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const scrollY = useRef(new Animated.Value(0)).current;
  const workspaceState = useWorkspaceState();
  const unreadNotificationCount = useMobileUnreadNotificationCount(workspaceState.selectedWorkspaceId);
  const { openSearch } = useSearchSheet();
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectMode, setNewProjectMode] = useState<'project' | 'milestone'>('project');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [projectActionProject, setProjectActionProject] = useState<MobileProjectsProject | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('projects');
  const [filters, setFilters] = useState<ProjectFilterState>(() => copyDefaultFilters());
  const [projects, setProjects] = useState<MobileProjectsProject[]>([]);
  const [milestones, setMilestones] = useState<MobileProjectsMilestone[]>([]);
  const [collapsed, setCollapsed] = useState<Record<ProjectSection, boolean>>({ attention: false, active: false, upcoming: false, hold: false, completed: true });
  const [completedMilestonesCollapsed, setCompletedMilestonesCollapsed] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const loadedWorkspaceRef = useRef<string | null>(null);
  const hasLoadedDataRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setIsLoading(true); setError(null); }
    try {
      setRefreshError(null);
      const response = await getMobileProjects(workspaceState.selectedWorkspaceId, true);
      setProjects(response.projects ?? []); setMilestones(response.milestones ?? []); hasLoadedDataRef.current = true;
    } catch (err) { const message = err instanceof Error ? err.message : 'Could not load projects.'; if (!silent) setError(message); else setRefreshError(message); }
    finally { if (!silent) setIsLoading(false); }
  }, [workspaceState.selectedWorkspaceId]);

  useEffect(() => { void bootstrapWorkspaceState(); }, []);
  useEffect(() => {
    const stored = projectFilterSession.get(workspaceState.selectedWorkspaceId);
    setFilters(stored ? { ...stored, status: [...stored.status], attention: [...stored.attention], date: [...stored.date], progress: [...stored.progress] } : copyDefaultFilters());
  }, [workspaceState.selectedWorkspaceId]);
  useEffect(() => { projectFilterSession.set(workspaceState.selectedWorkspaceId, filters); }, [filters, workspaceState.selectedWorkspaceId]);
  useFocusEffect(useCallback(() => {
    const workspaceChanged = loadedWorkspaceRef.current !== workspaceState.selectedWorkspaceId;
    if (workspaceChanged) {
      loadedWorkspaceRef.current = workspaceState.selectedWorkspaceId;
      hasLoadedDataRef.current = false;
      setProjects([]);
      setMilestones([]);
    }
    void load(hasLoadedDataRef.current);
  }, [load, workspaceState.selectedWorkspaceId]));
  const refresh = useCallback(async () => { setIsRefreshing(true); try { await load(true); } finally { setIsRefreshing(false); } }, [load]);

  const visibleProjects = useMemo(() => sortProjects(projects.filter((project) => matchesProjectFilters(project, filters)), filters), [filters, projects]);
  const sections = useMemo(() => {
    const result: Record<ProjectSection, MobileProjectsProject[]> = { attention: [], active: [], upcoming: [], hold: [], completed: [] };
    for (const project of visibleProjects) {
      const section: ProjectSection = isCompleted(project) ? 'completed' : isPaused(project) ? 'hold' : project.attention ? 'attention' : project.start_date && project.start_date > new Date().toISOString().slice(0, 10) ? 'upcoming' : 'active';
      result[section].push(project);
    }
    return result;
  }, [visibleProjects]);
  const summary = useMemo(() => ({ active: projects.filter((p) => !isCompleted(p) && !isPaused(p)).length, attention: projects.filter((p) => Boolean(p.attention)).length, due: projects.filter(isDueSoon).length }), [projects]);
  const projectDates = useMemo(() => normalizeProjectDates(projects, milestones), [milestones, projects]);
  const filteredProjectDates = useMemo(() => filterProjectDates(projectDates, projects, filters), [filters, projectDates, projects]);
  const milestoneGroups = useMemo(() => groupProjectDates(filteredProjectDates), [filteredProjectDates]);
  const workspaceLabel = useMemo(() => getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options), [workspaceState.options, workspaceState.selectedWorkspaceId]);
  const permissions = useMemo(() => getMobileProjectPermissions(workspaceState.selectedWorkspaceId, workspaceState.options), [workspaceState.options, workspaceState.selectedWorkspaceId]);

  const quickFilter = useMemo<QuickFilter>(() => {
    if (filters.status.length === 1 && filters.status[0] === 'completed') return 'completed';
    if (filters.status.length === 1 && filters.status[0] === 'active' && !filters.attention.length && !filters.date.length && !filters.progress.length && !filters.ownership) return 'active';
    if (filters.ownership === 'mine' && !filters.status.length && !filters.attention.length && !filters.date.length && !filters.progress.length) return 'mine';
    if (filters.date.length === 1 && filters.date[0] === 'soon' && !filters.status.length && !filters.attention.length && !filters.progress.length && !filters.ownership) return 'due';
    return 'all';
  }, [filters]);
  const advancedFilterCount = quickFilter === 'all' ? projectFilterCount(filters) : 0;
  const quickSummary = quickFilter === 'mine' ? 'Mine' : quickFilter === 'due' ? 'Due soon' : quickFilter === 'completed' ? 'Completed' : null;
  const filterSummary = advancedFilterCount ? projectFilterSummary(filters) : quickSummary;
  const applyQuickFilter = (next: Exclude<QuickFilter, 'all'>) => {
    if (quickFilter === next) {
      setFilters(copyDefaultFilters());
      return;
    }
    const nextFilters = copyDefaultFilters();
    if (next === 'active') nextFilters.status = ['active'];
    if (next === 'mine') nextFilters.ownership = 'mine';
    if (next === 'due') nextFilters.date = ['soon'];
    if (next === 'completed') nextFilters.status = ['completed'];
    setFilters(nextFilters);
    if (next === 'completed') setCollapsed((current) => ({ ...current, completed: false }));
    if (next === 'completed') setCompletedMilestonesCollapsed(false);
  };
  const chooseSummary = (filter: QuickFilter) => { setViewMode('projects'); if (filter !== 'all') applyQuickFilter(filter); };
  const openNewProject = (mode: 'project' | 'milestone' = 'project') => { setNewProjectMode(mode); setNewProjectOpen(true); };
  const handleProjectLongPress = (project: MobileProjectsProject) => setProjectActionProject(project);
  const projectActions = useMemo<MobileActionSheetAction[]>(() => {
    if (!projectActionProject) return [];
    const project = projectActionProject;
    return [
      { id: 'open', label: 'Open', perform: () => { setProjectActionProject(null); router.push(`/project/${project.id}`); } },
      ...(permissions.canAddAction ? [{ id: 'add_action', label: 'Add action', perform: () => { setProjectActionProject(null); router.push({ pathname: '/capture/project-action', params: { projectId: project.id, returnTo: `/project/${project.id}` } }); } }] : []),
      ...(permissions.canAddMilestone ? [{ id: 'add_milestone', label: 'Add milestone', perform: () => { setProjectActionProject(null); router.push({ pathname: '/project/milestone-new', params: { projectId: project.id } }); } }] : []),
      ...(permissions.canAddNote ? [{ id: 'add_note', label: 'Add note', perform: () => { setProjectActionProject(null); router.push({ pathname: '/capture/note', params: { projectId: project.id } }); } }] : []),
    ];
  }, [permissions.canAddAction, permissions.canAddMilestone, permissions.canAddNote, projectActionProject, router]);
  const handleMilestoneLongPress = useCallback((item: MobileProjectDate) => {
    const project = projects.find((candidate) => candidate.id === item.projectId);
    if (item.kind !== 'milestone' || !project) {
      Alert.alert(item.title, undefined, [{ text: 'Open project', onPress: () => router.push(`/project/${item.projectId}?milestoneId=${encodeURIComponent(item.id)}`) }, { text: 'Cancel', style: 'cancel' }]);
      return;
    }
    const milestoneId = item.id.replace(/^milestone:/, '');
    const buttons: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [
      { text: 'Open project', onPress: () => router.push(`/project/${item.projectId}?milestoneId=${encodeURIComponent(milestoneId)}`) },
      ...(!item.completed ? [{ text: 'Mark complete', onPress: () => {
        setMilestones((current) => current.map((milestone) => milestone.id === milestoneId ? { ...milestone, completed: true } : milestone));
        void updateMobileProjectMilestone(project.workspace_id, milestoneId, { completed: true }).catch(() => { void load(true); Alert.alert('Could not update milestone', 'Please try again.'); });
      } }] : []),
      { text: 'Delete', style: 'destructive', onPress: () => {
        setMilestones((current) => current.filter((milestone) => milestone.id !== milestoneId));
        void deleteMobileProjectMilestone(project.workspace_id, milestoneId).catch(() => { void load(true); Alert.alert('Could not delete milestone', 'Please try again.'); });
      } },
      { text: 'Cancel', style: 'cancel' },
    ];
    Alert.alert(item.title, `${item.projectTitle} · Milestone`, buttons);
  }, [load, projects, router]);
  return <Screen contentStyle={{ paddingTop: 0 }}>
    <View style={styles.fill}>
      <TodayHeader workspaceLabel={workspaceState.isLoading ? 'Loading workspaces…' : workspaceLabel} workspaceLoading={workspaceState.isLoading} workspaceExpanded={workspacePickerOpen} onWorkspacePress={() => setWorkspacePickerOpen(true)} unreadCount={unreadNotificationCount} onSearchPress={openSearch} onNotificationsPress={() => router.push({ pathname: '/notifications', params: { returnTo: '/(tabs)/projects' } })} onSettingsPress={() => router.push('/settings')} scrollY={scrollY} />
      <WorkspaceSelectorSheet visible={workspacePickerOpen} selectedWorkspaceId={workspaceState.selectedWorkspaceId} workspaces={workspaceState.options} onSelect={(id) => selectWorkspace(id)} onClose={() => setWorkspacePickerOpen(false)} />
      <NewProjectSheet visible={newProjectOpen} initialMode={newProjectMode} onClose={() => setNewProjectOpen(false)} onCreated={(projectId) => { if (projectId) router.push(`/project/${projectId}`); else void load(true); }} />
      <MobileActionsSheet visible={Boolean(projectActionProject)} title={projectActionProject?.name ?? 'Project'} typeLabel="Project" meta={workspaceLabel} actions={projectActions} onClose={() => setProjectActionProject(null)} />
      <ProjectFilterSheet visible={filterSheetOpen} filters={filters} activeCount={advancedFilterCount} showOwnership={workspaceState.selectedWorkspaceId === 'all' || workspaceState.options.find((option) => option.id === workspaceState.selectedWorkspaceId)?.type !== 'personal'} onChange={setFilters} onReset={() => setFilters(copyDefaultFilters())} onClose={() => setFilterSheetOpen(false)} />
      <Animated.ScrollView style={styles.fill} contentContainerStyle={{ paddingTop: TODAY_HEADER_SCROLL_SPACE, paddingBottom: theme.spacing['3xl'] + 132 }} refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={theme.colors.accent} />} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.summary}>{([['active', summary.active, 'Active'], ['attention', summary.attention, 'Attention'], ['due', summary.due, 'Due soon']] as const).filter(([, value]) => value > 0).map(([key, value, label], index) => <Pressable key={key} onPress={() => chooseSummary(key === 'due' ? 'due' : key as QuickFilter)} style={[styles.summaryItem, index > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.colors.borderSubtle }]}><AppText variant="bodyStrong" style={{ color: theme.colors.textPrimary }}>{value}</AppText><AppText variant="caption">{label}</AppText></Pressable>)}</View>
          <View style={styles.toolbar}><View style={[styles.switcher, { backgroundColor: theme.colors.surfaceMuted }]}>{(['projects', 'milestones'] as const).map((mode) => <Pressable key={mode} accessibilityRole="tab" accessibilityState={{ selected: viewMode === mode }} onPress={() => setViewMode(mode)} style={[styles.switcherItem, viewMode === mode && { backgroundColor: theme.colors.surface }]}><AppText variant="caption" style={{ color: viewMode === mode ? theme.colors.textPrimary : theme.colors.textMuted, fontWeight: viewMode === mode ? '600' : '400' }}>{mode === 'projects' ? 'Projects' : 'Milestones'}</AppText></Pressable>)}</View>{permissions.canCreate ? <Pressable accessibilityRole="button" accessibilityLabel="Create project" onPress={() => openNewProject(viewMode === 'milestones' ? 'milestone' : 'project')} hitSlop={8} style={({ pressed }) => [styles.createProjectButton, { backgroundColor: theme.colors.surfaceMuted, opacity: pressed ? 0.62 : 1 }]}><SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={18} tintColor={theme.colors.accent} /></Pressable> : null}</View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{([['active', 'Active'], ['mine', 'Mine'], ['due', 'Due soon'], ['completed', 'Completed']] as const).map(([key, label]) => <Pressable key={key} onPress={() => applyQuickFilter(key)} style={styles.filter}><AppText variant="caption" style={{ color: quickFilter === key ? theme.colors.accent : theme.colors.textSecondary, fontWeight: quickFilter === key ? '600' : '400' }}>{label}</AppText></Pressable>)}<Pressable onPress={() => setFilterSheetOpen(true)} style={styles.filter}><AppText variant="caption" style={{ color: advancedFilterCount ? theme.colors.accent : theme.colors.textSecondary }}>Filter{advancedFilterCount ? ` · ${advancedFilterCount}` : ''}</AppText></Pressable></ScrollView>
          {filterSummary ? <View style={styles.filterSummary}><AppText variant="caption" numberOfLines={1} style={styles.filterSummaryText}>{filterSummary}</AppText><Pressable onPress={() => setFilters(copyDefaultFilters())}><AppText variant="caption" style={{ color: theme.colors.accent }}>Clear</AppText></Pressable></View> : null}
          {isLoading && !projects.length ? <ProjectListSkeleton /> : error && !projects.length ? <View style={styles.errorState}><AppText variant="meta">{error}</AppText><Pressable onPress={() => void load()}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View> : <>{refreshError ? <View style={styles.refreshError}><AppText variant="caption">Could not refresh projects.</AppText><Pressable onPress={() => void load(true)}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View> : null}{viewMode === 'milestones' ? <MilestoneList groups={milestoneGroups} hasAnyMilestones={milestones.length > 0} canCreate={permissions.canCreate} onCreate={() => openNewProject('milestone')} completedCollapsed={completedMilestonesCollapsed} onToggleCompleted={() => setCompletedMilestonesCollapsed((current) => !current)} hasFilters={Boolean(advancedFilterCount || quickFilter !== 'all')} onClear={() => setFilters(copyDefaultFilters())} onProjectPress={(item) => router.push(`/project/${item.projectId}?milestoneId=${encodeURIComponent(item.id)}`)} onLongPress={handleMilestoneLongPress} /> : <ProjectSections sections={sections} hasFilters={Boolean(advancedFilterCount || quickFilter !== 'all')} onClear={() => setFilters(copyDefaultFilters())} collapsed={collapsed} setCollapsed={setCollapsed} onProjectPress={(id) => router.push(`/project/${id}`)} onProjectLongPress={handleProjectLongPress} canCreate={permissions.canCreate} onCreate={() => openNewProject('project')} />}</>}
        </View>
      </Animated.ScrollView>
    </View>
  </Screen>;
}

function ProjectSections({ sections, hasFilters, onClear, collapsed, setCollapsed, onProjectPress, onProjectLongPress, canCreate, onCreate }: { sections: Record<ProjectSection, MobileProjectsProject[]>; hasFilters: boolean; onClear: () => void; collapsed: Record<ProjectSection, boolean>; setCollapsed: (value: Record<ProjectSection, boolean>) => void; onProjectPress: (id: string) => void; onProjectLongPress?: (project: MobileProjectsProject) => void; canCreate: boolean; onCreate: () => void }) {
  const theme = useLedgerTheme();
  const visible = (Object.keys(SECTION_TITLES) as ProjectSection[]).filter((section) => sections[section].length);
  if (!visible.length) return hasFilters ? <View style={styles.emptyFilter}><AppText variant="meta">No projects match these filters</AppText><Pressable onPress={onClear}><AppText variant="caption" style={{ color: theme.colors.accent }}>Clear filters</AppText></Pressable></View> : <View style={styles.emptyState}><AppText variant="sectionTitle">A place for the work ahead</AppText><AppText variant="body" style={styles.emptyStateCopy}>Create a project to gather the next actions, notes, and milestones that move something forward.</AppText>{canCreate ? <Pressable onPress={onCreate} style={({ pressed }) => [styles.emptyStateButton, { backgroundColor: theme.colors.accent, opacity: pressed ? 0.72 : 1 }]}><AppText variant="bodyStrong" style={{ color: '#FFFFFF' }}>Create project</AppText></Pressable> : <AppText variant="caption">You can view projects, but creation is restricted in this workspace.</AppText>}</View>;
  return <View style={styles.sections}>{visible.map((section) => <View key={section} style={styles.section}><Pressable onPress={() => setCollapsed({ ...collapsed, [section]: !collapsed[section] })} style={styles.sectionHeader}><AppText variant="label" style={{ letterSpacing: 0.5 }}>{SECTION_TITLES[section]}  {sections[section].length}</AppText><SymbolView name={{ ios: collapsed[section] ? 'chevron.down' : 'chevron.up', android: collapsed[section] ? 'keyboard_arrow_down' : 'keyboard_arrow_up', web: collapsed[section] ? 'keyboard_arrow_down' : 'keyboard_arrow_up' }} size={14} tintColor={theme.colors.textMuted} /></Pressable>{collapsed[section] ? null : sections[section].map((project) => <ProjectRow key={project.id} project={toProjectRowModel(project, section)} onPress={() => onProjectPress(project.id)} onLongPress={() => onProjectLongPress?.(project)} />)}</View>)}</View>;
}

function MilestoneList({ groups, hasAnyMilestones, canCreate, onCreate, completedCollapsed, onToggleCompleted, hasFilters, onClear, onProjectPress, onLongPress }: { groups: MobileProjectDateGroup[]; hasAnyMilestones: boolean; canCreate: boolean; onCreate: () => void; completedCollapsed: boolean; onToggleCompleted: () => void; hasFilters: boolean; onClear: () => void; onProjectPress: (item: MobileProjectDate) => void; onLongPress: (item: MobileProjectDate) => void }) {
  const theme = useLedgerTheme();
  if (!groups.length) return hasFilters ? <View style={styles.emptyFilter}><AppText variant="meta">No milestones match these filters</AppText><Pressable onPress={onClear}><AppText variant="caption" style={{ color: theme.colors.accent }}>Clear filters</AppText></Pressable></View> : <View style={styles.emptyState}><AppText variant="sectionTitle">Keep important dates visible</AppText><AppText variant="body" style={styles.emptyStateCopy}>{hasAnyMilestones ? 'There are no upcoming milestones right now.' : 'Add milestones to keep project deadlines and meaningful checkpoints in view.'}</AppText>{!hasAnyMilestones && canCreate ? <Pressable onPress={onCreate} style={({ pressed }) => [styles.emptyStateButton, { backgroundColor: theme.colors.accent, opacity: pressed ? 0.72 : 1 }]}><AppText variant="bodyStrong" style={{ color: '#FFFFFF' }}>Create milestone</AppText></Pressable> : null}</View>;
  return <View style={styles.sections}>{groups.map((group) => <View key={group.key} style={styles.section}><Pressable onPress={group.completed ? onToggleCompleted : undefined} style={styles.sectionHeader}><AppText variant="label" style={{ letterSpacing: 0.5 }}>{group.title}  {group.items.length}</AppText>{group.completed ? <SymbolView name={{ ios: completedCollapsed ? 'chevron.down' : 'chevron.up', android: completedCollapsed ? 'keyboard_arrow_down' : 'keyboard_arrow_up', web: completedCollapsed ? 'keyboard_arrow_down' : 'keyboard_arrow_up' }} size={14} tintColor={theme.colors.textMuted} /> : null}</Pressable>{group.completed && completedCollapsed ? null : group.items.map((item, index) => <MilestoneRow key={item.id} item={item} isLast={index === group.items.length - 1} onPress={() => onProjectPress(item)} onLongPress={() => onLongPress(item)} />)}</View>)}</View>;
}

function MilestoneRow({ item, isLast, onPress, onLongPress }: { item: MobileProjectDate; isLast: boolean; onPress: () => void; onLongPress: () => void }) {
  const theme = useLedgerTheme();
  const overdue = Boolean(item.attention?.type === 'overdue_milestone' && !item.completed);
  const kindLabel = item.kind === 'project_deadline' ? 'Project deadline' : item.kind === 'project_start' ? 'Project start' : 'Milestone';
  const dateLabel = projectDateLabel(item);
  const accessibleDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(`${item.date}T12:00:00`));
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.projectTitle}, ${kindLabel}, ${accessibleDate}${item.completed ? ', completed' : overdue ? ', overdue' : ''}`} accessibilityHint="Opens the project. Long press for actions." onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.milestoneRow, { opacity: pressed ? 0.62 : item.completed ? 0.55 : 1 }]}><View style={styles.milestoneDateColumn}><AppText variant="caption" style={{ color: overdue ? theme.colors.warning : theme.colors.textMuted, textAlign: 'right' }}>{dateLabel}</AppText></View><View style={styles.timelineColumn}><View style={[styles.timelineMarker, { backgroundColor: item.completed ? theme.colors.success : overdue ? theme.colors.warning : item.projectColor || theme.colors.accent }]} />{isLast ? null : <View style={[styles.timelineLine, { backgroundColor: theme.colors.borderSubtle }]} />}</View><View style={styles.milestoneCopy}><View style={styles.milestoneTitleRow}><AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{item.title}</AppText>{item.completed ? <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={15} tintColor={theme.colors.success} /> : null}</View><AppText variant="caption" numberOfLines={1}>{item.projectTitle} · {kindLabel}</AppText></View></Pressable>;
}

function ProjectListSkeleton() { return <View style={styles.skeleton}><View style={styles.skeletonSummary}><Skeleton width={170} height={16} radius={5} /><Skeleton width={100} height={16} radius={5} /></View><Skeleton width={170} height={30} radius={8} /><Skeleton width="100%" height={14} radius={4} />{[1, 2, 3].map((item) => <Skeleton key={item} width="100%" height={58} radius={5} />)}</View>; }
const styles = StyleSheet.create({ fill: { flex: 1 }, content: { paddingHorizontal: 2, gap: 20 }, summary: { flexDirection: 'row', alignItems: 'center', minHeight: 34 }, summaryItem: { flexDirection: 'row', alignItems: 'baseline', gap: 5, paddingHorizontal: 10 }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, switcher: { alignSelf: 'flex-start', flexDirection: 'row', padding: 3, borderRadius: 9, gap: 2 }, switcherItem: { minWidth: 78, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 7 }, createProjectButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, filters: { gap: 18, paddingVertical: 1 }, filter: { paddingVertical: 5 }, filterSummary: { flexDirection: 'row', alignItems: 'center', gap: 10 }, filterSummaryText: { flex: 1 }, sections: { gap: 26 }, section: { gap: 10 }, sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, milestoneRow: { minHeight: 58, flexDirection: 'row', alignItems: 'stretch', gap: 10, paddingVertical: 4 }, milestoneDateColumn: { width: 62, justifyContent: 'flex-start', paddingTop: 3 }, timelineColumn: { width: 12, alignItems: 'center', position: 'relative' }, timelineMarker: { width: 7, height: 7, marginTop: 5, borderRadius: 1, transform: [{ rotate: '45deg' }], zIndex: 1 }, timelineLine: { position: 'absolute', top: 13, bottom: -5, width: StyleSheet.hairlineWidth }, milestoneCopy: { minWidth: 0, flex: 1, gap: 3 }, milestoneTitleRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 }, emptyFilter: { alignItems: 'flex-start', gap: 7, paddingVertical: 24 }, emptyState: { alignItems: 'flex-start', gap: 10, paddingHorizontal: 8, paddingVertical: 42 }, emptyStateCopy: { maxWidth: 330, color: '#6B7280', lineHeight: 22 }, emptyStateButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 14, marginTop: 4 }, state: { paddingVertical: 24 }, errorState: { gap: 8, paddingVertical: 24 }, refreshError: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, skeleton: { gap: 12, paddingVertical: 8 }, skeletonSummary: { flexDirection: 'row', justifyContent: 'space-between' }, });
