import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter, useFocusEffect } from 'expo-router';

import { TodayHeader } from '@/features/today/TodayHeader';
import { TODAY_HEADER_SCROLL_SPACE } from '@/features/today/TodayHeader';
import { WorkspaceSelectorSheet } from '@/components/WorkspaceSelectorSheet';
import { Screen } from '@/components/Screen';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Skeleton } from '@/components/Skeleton';
import { createMeetingNoteFromCalendar, getMobileCalendarRange } from '@/api/calendar';
import { searchMobileNotes } from '@/api/search';
import { createMobileChildNote, deleteMobileNote, duplicateMobileNote, getMobileNoteSections, getMobileNoteSummaries, getMobilePins, getMobileWorkspaceNoteLinks, moveMobileNote, pinMobileNote, unpinMobileObject, type MobileNoteSection, type MobileNoteSummary, type MobilePin } from '@/api/notes';
import { normalizeCalendarRange, type MobileCalendarItem } from '@/features/calendar/calendarItemNormalizer';
import { NoteRow, noteRowDataFromSummary } from '@/features/notes/NoteRow';
import { NoteFilterSheet } from '@/features/notes/NoteFilterSheet';
import { DEFAULT_NOTE_BROWSE_FILTERS, countActiveNoteFilters, type NoteBrowseFilters, type NoteQuickFilter } from '@/features/notes/noteBrowseTypes';
import { useSearchSheet } from '@/features/search/SearchSheetContext';
import { bootstrapWorkspaceState, getWorkspaceLabel, selectWorkspace, useWorkspaceState } from '@/store/workspaceStore';
import { useLedgerTheme } from '@/theme';
import { NoteCreationSheet } from '@/features/notes/NoteCreationSheet';
import { NoteActionSheet, NoteMoveSheet, NoteProjectSheet, SectionActionSheet } from '@/features/notes/NoteOrganizationSheets';
import { getMobileNotePermissions } from '@/features/notes/notePermissions';
import { openMobileNote } from '@/features/notes/openMobileNote';

type ViewMode = 'home' | 'browse';

const DAYS_AHEAD = 30;

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function meetingTime(item: MobileCalendarItem) {
  const date = new Date(item.startAt ?? `${item.dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return item.dateKey;
  const day = date.toLocaleDateString(undefined, { weekday: 'short' });
  return item.startAt ? `${day} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : day;
}

function isMeetingLike(item: MobileCalendarItem) {
  if (item.noteId) return true;
  return /meeting|review|sync|standup|1:1|one[- ]on[- ]one|interview|planning|call|demo/i.test(item.title);
}

function SectionLabel({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const theme = useLedgerTheme();
  return <View style={styles.sectionHeader}><AppText variant="label" style={{ letterSpacing: 0.7 }}>{title}</AppText>{action ? <Pressable onPress={onAction} hitSlop={8}><AppText variant="caption" style={{ color: theme.colors.accent }}>{action}</AppText></Pressable> : null}</View>;
}

export default function NotesScreen() {
  const theme = useLedgerTheme();
  const router = useRouter();
  const scrollY = useRef(new Animated.Value(0)).current;
  const workspaceState = useWorkspaceState();
  const { openSearch } = useSearchSheet();
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [browseFilters, setBrowseFilters] = useState<NoteBrowseFilters>(DEFAULT_NOTE_BROWSE_FILTERS);
  const [browseSectionId, setBrowseSectionId] = useState<string | null>(null);
  const [sectionPath, setSectionPath] = useState<string[]>([]);
  const [childNoteParentId, setChildNoteParentId] = useState<string | null>(null);
  const [showAllSections, setShowAllSections] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [notesQuery, setNotesQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MobileNoteSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notes, setNotes] = useState<MobileNoteSummary[]>([]);
  const [sections, setSections] = useState<MobileNoteSection[]>([]);
  const [pins, setPins] = useState<MobilePin[]>([]);
  const [projectByNoteId, setProjectByNoteId] = useState<Map<string, string>>(new Map());
  const [meetings, setMeetings] = useState<MobileCalendarItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [sectionRetrying, setSectionRetrying] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [creationOpen, setCreationOpen] = useState(false);
  const [creationContext, setCreationContext] = useState<{ sectionId?: string | null; parentId?: string | null }>({});
  const [actionNote, setActionNote] = useState<MobileNoteSummary | null>(null);
  const [moveNote, setMoveNote] = useState<MobileNoteSummary | null>(null);
  const [projectNote, setProjectNote] = useState<MobileNoteSummary | null>(null);
  const [actionSection, setActionSection] = useState<MobileNoteSection | null>(null);
  const loadedRef = useRef(false);
  const loadTokenRef = useRef(0);

  const workspaceId = workspaceState.selectedWorkspaceId;
  const workspaceLabel = useMemo(() => getWorkspaceLabel(workspaceId, workspaceState.options), [workspaceId, workspaceState.options]);
  const permissions = useMemo(() => getMobileNotePermissions(workspaceState.options.find((option) => option.id === workspaceId)), [workspaceId, workspaceState.options]);
  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const sectionById = useMemo(() => new Map(sections.map((section) => [section.id, section])), [sections]);
  const pinByNoteId = useMemo(() => new Map(pins.map((pin) => [pin.object_id, pin])), [pins]);
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach((note) => { if (note.parent_id) counts.set(note.parent_id, (counts.get(note.parent_id) ?? 0) + 1); });
    return counts;
  }, [notes]);
  const pinnedNotes = useMemo(() => pins.filter((pin) => noteById.has(pin.object_id)).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)).slice(0, 4).map((pin) => noteById.get(pin.object_id)!), [noteById, pins]);
  const recentNotes = useMemo(() => notes.filter((note) => !pinnedNotes.some((pinned) => pinned.id === note.id)).sort((a, b) => new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime()).slice(0, 5), [notes, pinnedNotes]);
  const sectionRows = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach((note) => counts.set(note.section_id ?? '__unsorted__', (counts.get(note.section_id ?? '__unsorted__') ?? 0) + 1));
    const rows = sections.filter((section) => (counts.get(section.id) ?? 0) > 0).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)).slice(0, 5).map((section) => ({ ...section, count: counts.get(section.id) ?? 0 }));
    const unsortedCount = counts.get('__unsorted__') ?? 0;
    if (unsortedCount && rows.length < 5) rows.push({ id: '__unsorted__', name: 'Unsorted', count: unsortedCount, color: null, parent_id: null, sort_order: 999 });
    return rows;
  }, [notes, sections]);

  const rootSections = useMemo(() => sections.filter((section) => !section.parent_id).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)), [sections]);
  const currentSection = browseSectionId && browseSectionId !== '__unsorted__' ? sectionById.get(browseSectionId) ?? null : null;
  const currentSectionChildren = useMemo(() => browseSectionId && browseSectionId !== '__unsorted__' ? sections.filter((section) => section.parent_id === browseSectionId).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) : [], [browseSectionId, sections]);

  const openNote = (note: MobileNoteSummary) => {
    openMobileNote(router, note.id, { workspaceId: note.workspace_id });
  };
  const openNoteActions = (note: MobileNoteSummary) => setActionNote(note);

  const openCreate = (sectionId: string | null = null, parentId: string | null = null) => {
    if (!permissions.canCreate) { Alert.alert('Read-only workspace', 'You do not have permission to create notes here.'); return; }
    if (workspaceId === 'all') { Alert.alert('Choose a workspace', 'Select a workspace before creating a note.'); return; }
    setCreationContext({ sectionId, parentId });
    setCreationOpen(true);
  };

  const handleCreated = (id: string) => {
    void load({ silent: true });
    openMobileNote(router, id, { workspaceId });
  };

  const togglePin = async (note: MobileNoteSummary) => {
    const existing = pins.find((pin) => pin.object_id === note.id);
    const previous = pins;
    setPins(existing ? pins.filter((pin) => pin.id !== existing.id) : [...pins, { id: `pending-${note.id}`, object_type: 'note', object_id: note.id, title: note.title, sort_order: 0 }]);
    try { if (existing) await unpinMobileObject(workspaceId, existing.id); else await pinMobileNote(workspaceId, note.id); } catch { setPins(previous); Alert.alert('Could not update pin', 'Please try again.'); }
  };

  const moveNoteTo = async (sectionId: string | null) => {
    const note = moveNote;
    setMoveNote(null);
    if (!note) return;
    const previous = notes;
    setNotes((current) => current.map((item) => item.id === note.id ? { ...item, section_id: sectionId } : item));
    try { await moveMobileNote(workspaceId, note.id, { section_id: sectionId }); } catch (error) { setNotes(previous); Alert.alert('Could not move note', error instanceof Error ? error.message : 'Please try again.'); }
  };
  const moveNoteParent = async (parentId: string | null) => {
    const note = moveNote;
    setMoveNote(null);
    if (!note) return;
    const previous = notes;
    setNotes((current) => current.map((item) => item.id === note.id ? { ...item, parent_id: parentId } : item));
    try { await moveMobileNote(workspaceId, note.id, { parent_id: parentId }); } catch (error) { setNotes(previous); Alert.alert('Could not change parent note', error instanceof Error ? error.message : 'Please try again.'); }
  };

  const duplicateNote = async (note: MobileNoteSummary) => {
    try { const copy = await duplicateMobileNote(workspaceId, note.id); await load({ silent: true }); openNote({ ...note, id: copy.id, title: copy.title }); } catch (error) { Alert.alert('Could not duplicate note', error instanceof Error ? error.message : 'Please try again.'); }
  };

  const createChild = async (note: MobileNoteSummary) => {
    try { const child = await createMobileChildNote(workspaceId, note.id, { section_id: note.section_id, mode: 'text' }); if (note.section_id) await moveMobileNote(workspaceId, child.id, { section_id: note.section_id }); await load({ silent: true }); openNote({ ...note, ...child, id: child.id, title: child.title ?? 'Untitled', parent_id: note.id, section_id: note.section_id }); } catch (error) { Alert.alert('Could not create child note', error instanceof Error ? error.message : 'Please try again.'); }
  };

  const deleteNote = (note: MobileNoteSummary) => Alert.alert('Delete this note?', 'The note will be removed from this workspace. Linked projects, tasks, and calendar items will not be deleted.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { const previous = notes; setNotes((current) => current.filter((item) => item.id !== note.id)); void deleteMobileNote(workspaceId, note.id).catch((error) => { setNotes(previous); Alert.alert('Could not delete note', error instanceof Error ? error.message : 'Please try again.'); }); } }]);

  const normalizeSearchResult = useCallback((result: Awaited<ReturnType<typeof searchMobileNotes>>[number]): MobileNoteSummary => {
    const noteId = result.note_id ?? result.id;
    const loadedNote = noteById.get(noteId);
    return {
    id: noteId,
    workspace_id: result.workspace_id,
    title: loadedNote?.title ?? result.title,
    preview: result.preview || result.snippet,
    mode: loadedNote?.mode ?? result.mode ?? (['transcript', 'meeting_metadata'].includes(String((result as { type?: string }).type)) ? 'meeting_note' : 'text'),
    section_id: loadedNote?.section_id ?? null,
    parent_id: loadedNote?.parent_id ?? null,
    updated_at: result.updated_at ?? null,
    created_at: loadedNote?.created_at ?? null,
    sort_order: loadedNote?.sort_order ?? null,
  }; }, [noteById]);

  const retrySections = useCallback(async () => {
    if (!workspaceId || workspaceId === 'all') {
      setSections([]);
      setSectionError(null);
      return;
    }
    setSectionRetrying(true);
    try {
      const result = await getMobileNoteSections(workspaceId);
      setSections(Array.isArray(result) ? result : []);
      setSectionError(null);
    } catch (cause) {
      setSectionError(cause instanceof Error ? cause.message : 'Could not load sections.');
    } finally {
      setSectionRetrying(false);
    }
  }, [workspaceId]);

  const load = useCallback(async ({ silent = false } = {}) => {
    const token = ++loadTokenRef.current;
    if (!workspaceId) return;
    if (!silent && !loadedRef.current) setIsLoading(true);
    setError(null);
    const start = dateKey(new Date());
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + DAYS_AHEAD);
    const end = dateKey(endDate);
    const [notesResult, sectionsResult, pinsResult, calendarResult, linksResult] = await Promise.allSettled([
      getMobileNoteSummaries(workspaceId),
      workspaceId === 'all' ? Promise.resolve<MobileNoteSection[]>([]) : getMobileNoteSections(workspaceId),
      getMobilePins(workspaceId),
      getMobileCalendarRange(workspaceId, start, end),
      getMobileWorkspaceNoteLinks(workspaceId),
    ]);
    if (token !== loadTokenRef.current) return;
    if (notesResult.status === 'fulfilled') {
      const payload = notesResult.value;
      setNotes(Array.isArray(payload) ? payload : payload.notes ?? []);
    } else if (!loadedRef.current) setError(notesResult.reason instanceof Error ? notesResult.reason.message : 'Could not load Notes.');
    if (sectionsResult.status === 'fulfilled') { setSections(Array.isArray(sectionsResult.value) ? sectionsResult.value : []); setSectionError(null); } else setSectionError(sectionsResult.reason instanceof Error ? sectionsResult.reason.message : 'Could not load sections.');
    if (pinsResult.status === 'fulfilled') setPins(pinsResult.value.pins ?? []);
    if (calendarResult.status === 'fulfilled') setMeetings(normalizeCalendarRange(calendarResult.value).filter((item) => item.type === 'event' || item.type === 'external_event').filter((item) => !item.completed && isMeetingLike(item)).filter((item) => new Date(`${item.dateKey}T23:59:59`).getTime() >= Date.now()).slice(0, 5));
    if (linksResult.status === 'fulfilled') { const next = new Map<string, string>(); linksResult.value.forEach((link) => { if (!next.has(link.note_id)) next.set(link.note_id, link.project_name); }); setProjectByNoteId(next); }
    loadedRef.current = true;
    setIsLoading(false);
  }, [workspaceId]);

  useEffect(() => { void bootstrapWorkspaceState(); }, []);
  useFocusEffect(useCallback(() => { void load({ silent: loadedRef.current }); }, [load]));
  useEffect(() => { if (workspaceState.isHydrated) void load(); }, [load, workspaceState.isHydrated]);

  useEffect(() => {
    setBrowseSectionId((current) => current && (current === '__unsorted__' || sectionById.has(current)) ? current : null);
    setSectionPath((current) => current.filter((id) => id === '__unsorted__' || sectionById.has(id)));
    setChildNoteParentId(null);
  }, [workspaceId, sectionById]);

  useEffect(() => {
    const query = notesQuery.trim();
    if (query.length < 2) {
      setSearchResults(null);
      setSearchError(null);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      if (!workspaceId) return;
      setIsSearching(true);
      setSearchError(null);
      void searchMobileNotes(workspaceId, query)
        .then((results) => {
          const normalized = results.map(normalizeSearchResult);
          const matchedSectionIds = new Set(sections.filter((section) => section.name.toLowerCase().includes(query.toLowerCase())).map((section) => section.id));
          const sectionMatches = notes.filter((note) => note.section_id && matchedSectionIds.has(note.section_id) && !normalized.some((result) => result.id === note.id));
          setSearchResults([...normalized, ...sectionMatches]);
        })
        .catch((err) => setSearchError(err instanceof Error ? err.message : 'Could not search notes.'))
        .finally(() => setIsSearching(false));
    }, 280);
    return () => clearTimeout(timer);
  }, [normalizeSearchResult, notes, notesQuery, sections, workspaceId]);

  const refresh = async () => { setIsRefreshing(true); try { await load(); } finally { setIsRefreshing(false); } };
  const openBrowse = () => { setViewMode('browse'); setBrowseSectionId(null); setChildNoteParentId(null); };
  const openSection = (sectionId: string) => {
    setViewMode('browse');
    setBrowseFilters(DEFAULT_NOTE_BROWSE_FILTERS);
    setShowAllSections(false);
    setChildNoteParentId(null);
    setBrowseSectionId(sectionId);
    setSectionPath((current) => current.includes(sectionId) ? current.slice(0, current.indexOf(sectionId) + 1) : [...current, sectionId]);
  };
  const openSectionBrowser = () => { setViewMode('browse'); setShowAllSections(true); setBrowseSectionId(null); setChildNoteParentId(null); };
  const openSectionActions = (section: MobileNoteSection) => setActionSection(section);
  const goBackSection = () => {
    if (childNoteParentId) { setChildNoteParentId(null); return; }
    setSectionPath((current) => {
      const next = current.slice(0, -1);
      setBrowseSectionId(next[next.length - 1] ?? null);
      if (!next.length) setShowAllSections(false);
      return next;
    });
  };
  const openNewNote = () => openCreate();
  const startMeetingNote = async (meeting: MobileCalendarItem) => {
    if (workspaceId === 'all') {
      Alert.alert('Choose a workspace', 'Select a workspace before starting a meeting note.');
      return;
    }
    try {
      const created = await createMeetingNoteFromCalendar(workspaceId, { eventId: meeting.sourceId ?? undefined, provider: meeting.readOnly ? 'google' : 'ledger', eventKey: meeting.sourceId ?? undefined, projectId: meeting.projectId ?? null });
      await load({ silent: true });
      const id = created.note?.id;
      openMobileNote(router, id, { workspaceId });
    } catch (err) {
      Alert.alert('Could not start meeting note', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  return <Screen contentStyle={{ paddingTop: 0 }}>
    <View style={styles.container}>
      <TodayHeader workspaceLabel={workspaceState.isLoading ? 'Loading workspaces…' : workspaceLabel} workspaceLoading={workspaceState.isLoading} workspaceExpanded={workspacePickerOpen} onWorkspacePress={() => setWorkspacePickerOpen(true)} onSearchPress={openSearch} onNotificationsPress={() => router.push('/(tabs)/notifications')} scrollY={scrollY} />
      <WorkspaceSelectorSheet visible={workspacePickerOpen} selectedWorkspaceId={workspaceId} workspaces={workspaceState.options} onSelect={(id) => selectWorkspace(id)} onClose={() => setWorkspacePickerOpen(false)} />
      <Animated.ScrollView refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={theme.colors.accent} />} contentContainerStyle={[styles.content, { paddingTop: TODAY_HEADER_SCROLL_SPACE, paddingBottom: theme.spacing['3xl'] + 132 }]} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        <View style={[styles.switcher, { backgroundColor: theme.colors.surfaceMuted }]}>{(['home', 'browse'] as const).map((mode) => <Pressable key={mode} accessibilityRole="tab" accessibilityState={{ selected: viewMode === mode }} onPress={() => setViewMode(mode)} style={[styles.switcherItem, viewMode === mode && { backgroundColor: theme.colors.surface }]}><AppText variant="caption" style={{ color: viewMode === mode ? theme.colors.textPrimary : theme.colors.textMuted, fontWeight: viewMode === mode ? '600' : '400' }}>{mode === 'home' ? 'Home' : 'Browse'}</AppText></Pressable>)}</View>
        {isLoading ? <NotesSkeleton /> : error ? <View style={styles.inlineState}><AppText variant="bodyStrong">Notes unavailable</AppText><AppText variant="caption">{error}</AppText><AppButton title="Retry" variant="ghost" fullWidth={false} onPress={() => void load()} /></View> : viewMode === 'browse' ? <BrowseView notes={notes} sections={sections} rootSections={rootSections} sectionRows={sectionRows} sectionById={sectionById} childCounts={childCounts} pins={pinByNoteId} projectByNoteId={projectByNoteId} filters={browseFilters} query={notesQuery} searchResults={searchResults} isSearching={isSearching} searchError={searchError} currentSection={currentSection} currentSectionChildren={currentSectionChildren} browseSectionId={browseSectionId} sectionPath={sectionPath} childNoteParentId={childNoteParentId} showAllSections={showAllSections} activeFilterCount={countActiveNoteFilters(browseFilters)} onQueryChange={setNotesQuery} onOpenNote={openNote} onOpenNoteActions={openNoteActions} onOpenChildren={setChildNoteParentId} onNewNote={openNewNote} onOpenSection={openSection} onOpenSectionBrowser={openSectionBrowser} onSectionActions={openSectionActions} onBack={goBackSection} onSetQuickFilter={(quick) => setBrowseFilters((current) => quick === 'all' ? { ...DEFAULT_NOTE_BROWSE_FILTERS } : { ...current, quick, types: [] })} onOpenFilterSheet={() => setFilterSheetOpen(true)} /> : <>
          {pinnedNotes.length ? <View style={styles.section}><SectionLabel title="PINNED" action="View all" onAction={openBrowse} />{pinnedNotes.map((note) => <NoteRow key={note.id} note={noteRowDataFromSummary(note, { sectionName: sectionById.get(note.section_id ?? '')?.name, projectTitle: projectByNoteId.get(note.id), pinned: true })} variant="compact" showPreview={false} onPress={() => openNote(note)} onLongPress={() => openNoteActions(note)} />)}</View> : null}
          {recentNotes.length ? <View style={styles.section}><SectionLabel title="RECENT" />{recentNotes.map((note) => <NoteRow key={note.id} note={noteRowDataFromSummary(note, { sectionName: sectionById.get(note.section_id ?? '')?.name, projectTitle: projectByNoteId.get(note.id) })} onPress={() => openNote(note)} onLongPress={() => openNoteActions(note)} />)}</View> : null}
          {meetings.length ? <View style={styles.section}><SectionLabel title="UPCOMING" />{meetings.map((meeting) => { const linkedNote = meeting.noteId ? noteById.get(meeting.noteId) : null; return linkedNote ? <NoteRow key={meeting.id} note={noteRowDataFromSummary(linkedNote, { meetingContext: meetingTime(meeting) })} variant="meeting" showPreview={false} onPress={() => openNote(linkedNote)} onLongPress={() => openNoteActions(linkedNote)} /> : <Pressable key={meeting.id} onPress={() => void startMeetingNote(meeting)} style={({ pressed }) => [styles.meetingRow, { opacity: pressed ? 0.68 : 1 }]}><View style={styles.meetingDate}><AppText variant="caption">{meetingTime(meeting)}</AppText></View><View style={styles.rowCopy}><AppText variant="bodyStrong" numberOfLines={1}>{meeting.title}</AppText><AppText variant="caption">Start meeting note</AppText></View><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.colors.textMuted} /></Pressable>; })}</View> : null}
          {sectionRows.length || sectionError ? <View style={styles.section}><SectionLabel title="SECTIONS" action="View all" onAction={openSectionBrowser} />{sectionError ? <View style={styles.inlineState}><AppText variant="caption" numberOfLines={1}>{sectionError}</AppText><Pressable accessibilityRole="button" accessibilityLabel="Retry loading note sections" disabled={sectionRetrying} onPress={() => void retrySections()}><AppText variant="caption" style={{ color: theme.colors.accent, opacity: sectionRetrying ? 0.55 : 1 }}>{sectionRetrying ? 'Retrying…' : 'Retry'}</AppText></Pressable></View> : sectionRows.map((section) => <Pressable key={section.id} onPress={() => openSection(section.id)} onLongPress={() => openSectionActions(section)} style={({ pressed }) => [styles.sectionRow, { opacity: pressed ? 0.68 : 1 }]}><View style={[styles.sectionDot, { backgroundColor: section.color ? theme.colors.accent : theme.colors.borderSubtle }]} /><AppText variant="body" numberOfLines={1} style={styles.flex}>{section.name}</AppText><AppText variant="caption">{section.count}</AppText><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={15} tintColor={theme.colors.textMuted} /></Pressable>)}</View> : null}
          {!notes.length ? <View style={styles.empty}><AppText variant="bodyStrong">No notes yet</AppText><AppText variant="caption">Create a note to start capturing ideas and context.</AppText><AppButton title="New note" fullWidth={false} size="md" onPress={openNewNote} /></View> : null}
          <Pressable onPress={openNewNote} style={({ pressed }) => [styles.newNoteAction, { borderColor: theme.colors.borderSubtle, opacity: pressed ? 0.68 : 1 }]}><SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={16} tintColor={theme.colors.accent} /><AppText variant="body" style={{ color: theme.colors.accent }}>New note</AppText></Pressable>
        </>}
      </Animated.ScrollView>
      <NoteFilterSheet visible={filterSheetOpen} filters={browseFilters} sections={sections} hasUnsorted={notes.some((note) => !note.section_id)} onChange={setBrowseFilters} onReset={() => setBrowseFilters(DEFAULT_NOTE_BROWSE_FILTERS)} onClose={() => setFilterSheetOpen(false)} />
      <NoteCreationSheet visible={creationOpen} workspaceId={workspaceId} sectionId={creationContext.sectionId} parentId={creationContext.parentId} meetings={meetings.map((meeting) => ({ id: meeting.id, title: meeting.title, sourceId: meeting.sourceId, startAt: meeting.startAt, readOnly: meeting.readOnly, projectId: meeting.projectId }))} sections={sections} onClose={() => setCreationOpen(false)} onCreated={handleCreated} onSectionCreated={() => void load({ silent: true })} />
      <NoteActionSheet visible={Boolean(actionNote)} note={actionNote} permissions={permissions} pinned={actionNote ? pinByNoteId.has(actionNote.id) : false} onClose={() => setActionNote(null)} onOpen={() => actionNote && openNote(actionNote)} onTogglePin={() => actionNote && void togglePin(actionNote)} onMove={() => actionNote && setMoveNote(actionNote)} onDuplicate={() => actionNote && void duplicateNote(actionNote)} onChild={() => actionNote && void createChild(actionNote)} onProjects={() => actionNote && setProjectNote(actionNote)} onDelete={() => actionNote && deleteNote(actionNote)} />
      <NoteMoveSheet visible={Boolean(moveNote)} note={moveNote} sections={sections} notes={notes} onClose={() => setMoveNote(null)} onMove={moveNoteTo} onParentMove={moveNoteParent} />
      <NoteProjectSheet visible={Boolean(projectNote)} workspaceId={workspaceId} note={projectNote} onClose={() => setProjectNote(null)} onChanged={() => void load({ silent: true })} />
      <SectionActionSheet visible={Boolean(actionSection)} workspaceId={workspaceId} section={actionSection} onClose={() => setActionSection(null)} onOpen={() => actionSection && openSection(actionSection.id)} onNewNote={() => actionSection && openCreate(actionSection.id)} onNewSubsection={() => actionSection && (setCreationContext({ sectionId: actionSection.id }), setCreationOpen(true))} onChanged={() => void load({ silent: true })} />
    </View>
  </Screen>;
}

type BrowseViewProps = {
  notes: MobileNoteSummary[];
  sections: MobileNoteSection[];
  rootSections: MobileNoteSection[];
  sectionRows: Array<MobileNoteSection & { count: number }>;
  sectionById: Map<string, MobileNoteSection>;
  childCounts: Map<string, number>;
  pins: Map<string, MobilePin>;
  filters: NoteBrowseFilters;
  query: string;
  searchResults: MobileNoteSummary[] | null;
  isSearching: boolean;
  searchError: string | null;
  currentSection: MobileNoteSection | null;
  currentSectionChildren: MobileNoteSection[];
  browseSectionId: string | null;
  sectionPath: string[];
  childNoteParentId: string | null;
  projectByNoteId: Map<string, string>;
  showAllSections: boolean;
  activeFilterCount: number;
  onQueryChange: (value: string) => void;
  onOpenNote: (note: MobileNoteSummary) => void;
  onOpenNoteActions: (note: MobileNoteSummary) => void;
  onOpenChildren: (noteId: string) => void;
  onNewNote: () => void;
  onOpenSection: (sectionId: string) => void;
  onOpenSectionBrowser: () => void;
  onSectionActions: (section: MobileNoteSection) => void;
  onBack: () => void;
  onSetQuickFilter: (filter: NoteQuickFilter) => void;
  onOpenFilterSheet: () => void;
};

function BrowseView(props: BrowseViewProps) {
  const theme = useLedgerTheme();
  const {
    notes, rootSections, sectionRows, sectionById, childCounts, pins, projectByNoteId, filters, query, searchResults,
    isSearching, searchError, currentSection, currentSectionChildren, browseSectionId, childNoteParentId,
    showAllSections, activeFilterCount, onQueryChange, onOpenNote, onOpenNoteActions, onOpenChildren,
    onNewNote, onOpenSection, onOpenSectionBrowser, onSectionActions, onBack, onSetQuickFilter, onOpenFilterSheet,
  } = props;
  const counts = useMemo(() => {
    const values = new Map<string, number>();
    notes.forEach((note) => values.set(note.section_id ?? '__unsorted__', (values.get(note.section_id ?? '__unsorted__') ?? 0) + 1));
    return values;
  }, [notes]);
    const sourceNotes = query.trim().length >= 2 ? searchResults ?? [] : notes;
  const scopedNotes = useMemo(() => {
    let result = sourceNotes;
    if (childNoteParentId) result = result.filter((note) => note.parent_id === childNoteParentId);
    else if (browseSectionId) result = result.filter((note) => browseSectionId === '__unsorted__' ? !note.section_id : note.section_id === browseSectionId);
    if (filters.quick === 'pinned') result = result.filter((note) => pins.has(note.id));
    if (filters.quick === 'meetings') result = result.filter((note) => note.mode === 'meeting_note');
    if (filters.quick === 'maps') result = result.filter((note) => note.mode === 'mind_map');
    if (filters.types.length) result = result.filter((note) => filters.types.includes(note.mode ?? 'text'));
    if (filters.sectionId) result = result.filter((note) => note.section_id === filters.sectionId);
    if (filters.organization === 'unsorted') result = result.filter((note) => !note.section_id);
    if (filters.organization === 'root') result = result.filter((note) => !note.parent_id);
    if (filters.updated) {
      const now = Date.now();
      const start = new Date();
      if (filters.updated === 'today') start.setHours(0, 0, 0, 0);
      if (filters.updated === 'this_week') { start.setDate(start.getDate() - start.getDay()); start.setHours(0, 0, 0, 0); }
      if (filters.updated === 'this_month') { start.setDate(1); start.setHours(0, 0, 0, 0); }
      result = result.filter((note) => { const updated = new Date(note.updated_at ?? 0).getTime(); return updated >= start.getTime() && updated <= now; });
    }
    return result.slice().sort((a, b) => {
      if (filters.sort === 'title') return a.title.localeCompare(b.title);
      if (filters.sort === 'created') return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
      if (filters.sort === 'manual') return Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
      return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
    });
  }, [browseSectionId, childNoteParentId, filters, pins, sourceNotes]);
  const sectionName = (note: MobileNoteSummary) => sectionById.get(note.section_id ?? '')?.name ?? null;
  const renderNote = (note: MobileNoteSummary, variant: 'default' | 'section' = 'default') => <NoteRow key={note.id} note={noteRowDataFromSummary(note, { sectionName: sectionName(note), projectTitle: projectByNoteId.get(note.id), pinned: pins.has(note.id) })} variant={variant} childCount={childCounts.get(note.id) ?? 0} onOpenChildren={() => onOpenChildren(note.id)} onPress={() => onOpenNote(note)} onLongPress={() => onOpenNoteActions(note)} />;
  const quickFilters: Array<[NoteQuickFilter, string]> = [['all', 'All'], ['pinned', 'Pinned'], ['meetings', 'Meetings'], ['maps', 'Maps']];
  const activeFilterSummary = [
    filters.quick !== 'all' ? quickFilters.find(([value]) => value === filters.quick)?.[1] : null,
    filters.types.length ? filters.types.map((type) => type === 'meeting_note' ? 'Meetings' : type === 'mind_map' ? 'Maps' : 'Text').join(' · ') : null,
    filters.sectionId ? sectionById.get(filters.sectionId)?.name : filters.organization === 'unsorted' ? 'Unsorted' : filters.organization === 'root' ? 'Root notes' : null,
    filters.updated === 'today' ? 'Today' : filters.updated === 'this_week' ? 'This week' : filters.updated === 'this_month' ? 'This month' : null,
  ].filter(Boolean).join(' · ');
  const hasActiveResultFilter = filters.quick !== 'all' || Boolean(countActiveNoteFilters(filters));
  const currentTitle = childNoteParentId ? notes.find((note) => note.id === childNoteParentId)?.title ?? 'Child notes' : currentSection?.name ?? (browseSectionId === '__unsorted__' ? 'Unsorted' : 'Browse');

  return <View style={styles.browseContent}>
    {(browseSectionId || showAllSections || childNoteParentId) ? <Pressable onPress={onBack} hitSlop={8} style={styles.backRow}><AppText variant="caption" style={{ color: theme.colors.accent }}>‹ Sections</AppText><AppText variant="caption" numberOfLines={1} style={styles.backTitle}>{currentTitle}</AppText></Pressable> : null}
    <View style={[styles.searchBox, { borderColor: theme.colors.borderSubtle, backgroundColor: theme.colors.surfaceMuted }]}><SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={15} tintColor={theme.colors.textMuted} /><TextInput accessibilityLabel="Search notes" placeholder="Search notes…" placeholderTextColor={theme.colors.textMuted} value={query} onChangeText={onQueryChange} returnKeyType="search" style={[styles.searchInput, { color: theme.colors.textPrimary }]} /></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickFilters}>{quickFilters.map(([value, label]) => <Pressable key={value} onPress={() => onSetQuickFilter(value)} style={[styles.quickFilter, filters.quick === value && { backgroundColor: theme.colors.surfaceSelected }]}><AppText variant="caption" style={{ color: filters.quick === value ? theme.colors.accent : theme.colors.textSecondary, fontWeight: filters.quick === value ? '600' : '400' }}>{label}</AppText></Pressable>)}<Pressable onPress={onOpenFilterSheet} style={[styles.quickFilter, activeFilterCount ? { backgroundColor: theme.colors.surfaceSelected } : null]}><AppText variant="caption" style={{ color: activeFilterCount ? theme.colors.accent : theme.colors.textSecondary }}>Filter{activeFilterCount ? ` · ${activeFilterCount}` : ''}</AppText></Pressable></ScrollView>
    {activeFilterSummary ? <View style={styles.activeFilterRow}><AppText variant="caption" numberOfLines={1} style={styles.flex}>{activeFilterSummary}</AppText><Pressable onPress={() => onSetQuickFilter('all')} hitSlop={8}><AppText variant="caption" style={{ color: theme.colors.accent }}>Clear</AppText></Pressable></View> : null}
    {searchError ? <View style={styles.inlineState}><AppText variant="caption">Could not search notes.</AppText><Pressable onPress={() => onQueryChange(`${query} `)}><AppText variant="caption" style={{ color: theme.colors.accent }}>Retry</AppText></Pressable></View> : null}
    {isSearching ? <View style={styles.inlineState}><AppText variant="caption">Searching notes…</AppText></View> : null}
    {query.trim().length >= 2 ? <View style={styles.section}><SectionLabel title="NOTES" />{!isSearching && !scopedNotes.length ? <View style={styles.empty}><AppText variant="bodyStrong">No notes match “{query.trim()}”</AppText><Pressable onPress={() => onQueryChange('')}><AppText variant="caption" style={{ color: theme.colors.accent }}>Clear search</AppText></Pressable></View> : scopedNotes.map((note) => renderNote(note))}</View> : browseSectionId || childNoteParentId ? <>
      {currentSectionChildren.length && !childNoteParentId ? <View style={styles.section}><SectionLabel title="SUBSECTIONS" />{currentSectionChildren.map((section) => <SectionBrowseRow key={section.id} section={section} count={counts.get(section.id) ?? 0} onPress={() => onOpenSection(section.id)} onLongPress={() => onSectionActions(section)} />)}</View> : null}
      <View style={styles.section}><SectionLabel title={childNoteParentId ? 'CHILD NOTES' : 'NOTES'} />{!scopedNotes.length ? <View style={styles.empty}><AppText variant="bodyStrong">No notes in this section</AppText><AppText variant="caption">Notes added here will appear in this section.</AppText></View> : scopedNotes.map((note) => renderNote(note, 'section'))}</View>
    </> : <>
      <View style={styles.section}><SectionLabel title="SECTIONS" action={showAllSections ? undefined : 'View all'} onAction={onOpenSectionBrowser} />{(showAllSections ? rootSections : rootSections.slice(0, 5)).map((section) => <SectionBrowseRow key={section.id} section={section} count={counts.get(section.id) ?? 0} onPress={() => onOpenSection(section.id)} onLongPress={() => onSectionActions(section)} />)}{notes.some((note) => !note.section_id) ? <SectionBrowseRow section={{ id: '__unsorted__', name: 'Unsorted', parent_id: null }} count={counts.get('__unsorted__') ?? 0} onPress={() => onOpenSection('__unsorted__')} /> : null}</View>
      <View style={styles.section}><SectionLabel title="NOTES" action="New note" onAction={onNewNote} />{!scopedNotes.length ? <View style={styles.empty}><AppText variant="bodyStrong">{hasActiveResultFilter ? 'No notes match these filters' : 'No notes yet'}</AppText><AppText variant="caption">{hasActiveResultFilter ? 'Clear filters to see the full library.' : 'Create a note to start building your workspace.'}</AppText>{hasActiveResultFilter ? <Pressable onPress={() => onSetQuickFilter('all')}><AppText variant="caption" style={{ color: theme.colors.accent }}>Clear filters</AppText></Pressable> : null}</View> : scopedNotes.map((note) => renderNote(note))}</View>
    </>}
  </View>;
}

function SectionBrowseRow({ section, count, onPress, onLongPress }: { section: MobileNoteSection; count: number; onPress: () => void; onLongPress?: () => void }) {
  const theme = useLedgerTheme();
  return <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.sectionRow, { opacity: pressed ? 0.68 : 1 }]}><View style={[styles.sectionDot, { backgroundColor: section.color ? theme.colors.accent : theme.colors.borderSubtle }]} /><AppText variant="body" numberOfLines={1} style={styles.flex}>{section.name}</AppText><AppText variant="caption">{count}</AppText><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={15} tintColor={theme.colors.textMuted} /></Pressable>;
}

function NotesSkeleton() {
  return <View style={styles.section}><Skeleton width={76} height={13} radius={4} /><Skeleton width="100%" height={50} radius={8} /><Skeleton width="100%" height={50} radius={8} /><Skeleton width={76} height={13} radius={4} /><Skeleton width="100%" height={50} radius={8} /><Skeleton width="100%" height={50} radius={8} /></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 25 },
  switcher: { alignSelf: 'flex-start', flexDirection: 'row', padding: 3, borderRadius: 9, gap: 2 },
  switcherItem: { minWidth: 58, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 7 },
  section: { gap: 9 },
  browseContent: { gap: 20 },
  sectionHeader: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 9 },
  backTitle: { flex: 1, color: '#666666' },
  searchBox: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11 },
  searchInput: { flex: 1, minHeight: 40, paddingVertical: 0, fontSize: 15 },
  quickFilters: { gap: 7, paddingRight: 8 },
  quickFilter: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8 },
  rowCopy: { minWidth: 0, flex: 1, gap: 3 },
  flex: { flex: 1 },
  meetingRow: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  meetingDate: { width: 86 },
  sectionRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionDot: { width: 7, height: 7, borderRadius: 2 },
  empty: { gap: 7, paddingVertical: 8 },
  inlineState: { gap: 7, paddingVertical: 8 },
  activeFilterRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  newNoteAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderRadius: 10 },
});
