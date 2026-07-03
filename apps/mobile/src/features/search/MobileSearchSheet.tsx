import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { AppButton } from '@/components/AppButton';
import { AppDetailSheet } from '@/components/AppDetailSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { useWorkspaceState, getWorkspaceLabel } from '@/store/workspaceStore';
import type { MobileSearchResult } from '@/types/ledger';
import { searchMobileLedger } from '@/api/search';
import { getMobileNote } from '@/api/notes';
import { useFollowUpSheet } from '@/features/followup/FollowUpSheetContext';
import { useQuickNoteSheet } from '@/features/quicknote/QuickNoteSheetContext';

import { SearchResultRow } from './SearchResultRow';
import {
  getSearchResultActions,
  getSearchResultBody,
  getSearchResultMetaRows,
  getSearchResultSubtitle,
} from './searchAdapters';
import { useSearchSheet } from './SearchSheetContext';

const CLOSE_DURATION = 180;
const BACKDROP_CLOSE_DURATION = 120;
const SHEET_DRAG_CLOSE_THRESHOLD = 72;

function SearchHeaderInput({
  value,
  onChangeText,
  onClear,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onClear: () => void;
}) {
  const theme = useLedgerTheme();
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.searchField, { borderColor: theme.colors.borderSubtle, backgroundColor: theme.colors.surface }]}>
      <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={16} weight="regular" tintColor={theme.colors.textMuted} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search Ledger"
        placeholderTextColor={theme.colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[styles.searchInput, { color: theme.colors.textPrimary }]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={onClear}>
          <SymbolView name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }} size={16} weight="regular" tintColor={theme.colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function SearchSheetShell({
  visible,
  title,
  onClose,
  headerAccessory,
  children,
}: {
  visible: boolean;
  title: React.ReactNode;
  onClose: () => void;
  headerAccessory?: React.ReactNode;
  children: React.ReactNode;
}) {
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const backdropProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const closeFallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sheetMaxHeight = Math.min(windowHeight * 0.92, windowHeight - insets.top - 12);
  const sheetTranslateY = Animated.add(
    progress.interpolate({
      inputRange: [0, 1],
      outputRange: [sheetMaxHeight, 0],
    }),
    dragY,
  );

  useEffect(() => {
    if (visible) {
      setMounted(true);
      closingRef.current = false;
      if (closeFallbackTimer.current) {
        clearTimeout(closeFallbackTimer.current);
        closeFallbackTimer.current = null;
      }
      dragY.setValue(0);
      progress.setValue(1);
      backdropProgress.setValue(1);
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
    Animated.timing(backdropProgress, {
      toValue: 0,
      duration: BACKDROP_CLOSE_DURATION,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [backdropProgress, dragY, progress, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });

    return () => subscription.remove();
  }, [onClose, visible]);

  const closeSheet = () => {
    if (!mounted || closingRef.current) return;

    closingRef.current = true;
    if (closeFallbackTimer.current) {
      clearTimeout(closeFallbackTimer.current);
    }
    Animated.parallel([
      Animated.timing(backdropProgress, {
        toValue: 0,
        duration: BACKDROP_CLOSE_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        toValue: 0,
        duration: CLOSE_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(dragY, {
        toValue: 0,
        duration: CLOSE_DURATION,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (closeFallbackTimer.current) {
        clearTimeout(closeFallbackTimer.current);
        closeFallbackTimer.current = null;
      }
      closingRef.current = false;
      onClose();
    });

    closeFallbackTimer.current = setTimeout(() => {
      closeFallbackTimer.current = null;
      closingRef.current = false;
      onClose();
    }, CLOSE_DURATION + 80);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_: GestureResponderEvent, gestureState: PanResponderGestureState) =>
        Math.abs(gestureState.dy) > 2,
      onPanResponderGrant: () => {
        dragY.setValue(0);
      },
      onPanResponderMove: (_: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        dragY.setValue(Math.max(0, gestureState.dy));
      },
      onPanResponderRelease: (_: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        if (gestureState.dy > SHEET_DRAG_CLOSE_THRESHOLD || gestureState.vy > 0.75) {
          closeSheet();
          return;
        }

        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
          speed: 18,
        }).start();
      },
    }),
  ).current;

  if (!mounted) {
    return null;
  }

  const backdropOpacity = backdropProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.16],
  });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={closeSheet}>
      <View style={styles.portal}>
        <Pressable accessibilityRole="button" onPress={closeSheet} style={styles.backdropPressable}>
          <Animated.View
            style={[
              styles.backdrop,
              {
                backgroundColor: theme.colors.textPrimary,
                opacity: backdropOpacity,
              },
            ]}
          />
        </Pressable>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.borderSubtle,
              height: sheetMaxHeight,
              transform: [{ translateY: sheetTranslateY }],
            },
          ]}>
          <View
            {...panResponder.panHandlers}
            style={styles.handleHitArea}
            accessibilityRole="adjustable"
            accessibilityLabel="Dismiss search">
            <View style={[styles.handle, { backgroundColor: theme.colors.borderSubtle }]} />
          </View>

          <View style={styles.header}>
            <View style={styles.headerText}>{title}</View>
            {headerAccessory ? <View>{headerAccessory}</View> : null}
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.content,
              {
                paddingHorizontal: theme.spacing.lg,
                paddingBottom: insets.bottom + theme.spacing.lg,
              },
            ]}>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function SearchDetailSheet({
  result,
  visible,
  onClose,
  onAction,
}: {
  result: MobileSearchResult | null;
  visible: boolean;
  onClose: () => void;
  onAction?: (actionId: string, result: MobileSearchResult, body?: string | null) => void;
}) {
  const [noteBody, setNoteBody] = useState<string | null>(null);
  const [isLoadingNote, setIsLoadingNote] = useState(false);
  const activeResult = result;

  useEffect(() => {
    if (!activeResult || visible! || activeResult.type !== 'note') {
      setNoteBody(null);
      setIsLoadingNote(false);
      return;
    }

    let cancelled = false;
    setIsLoadingNote(true);
    setNoteBody(null);

    void getMobileNote(activeResult.id)
      .then((note) => {
        if (cancelled) return;
        setNoteBody(htmlToPlainText(note.content_html ?? note.content ?? '') || null);
      })
      .catch(() => {
        if (cancelled) return;
        setNoteBody(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingNote(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeResult, visible]);

  if (!activeResult) return null;
  const currentResult = activeResult;

  const body =
    currentResult.type === 'note'
      ? noteBody ?? (isLoadingNote ? undefined : getSearchResultBody(currentResult) ?? undefined)
      : getSearchResultBody(currentResult) ?? undefined;

  return (
    <AppDetailSheet
      visible={visible}
      title={currentResult.title}
      subtitle={getSearchResultSubtitle(currentResult)}
      meta={getSearchResultMetaRows(currentResult)}
      body={body}
      actions={getSearchResultActions(currentResult)}
      onClose={onClose}
      onAction={(actionId) => {
        onAction?.(actionId, currentResult, body ?? null);
      }}
    />
  );
}

function htmlToPlainText(value: string) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function MobileSearchResultDetailSheet() {
  const { activeSearchResult, closeSearchResult } = useSearchSheet();
  const { openFollowUpSheet } = useFollowUpSheet();
  const { openQuickNoteSheet } = useQuickNoteSheet();
  const followUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (followUpTimerRef.current) {
        clearTimeout(followUpTimerRef.current);
        followUpTimerRef.current = null;
      }
      if (noteTimerRef.current) {
        clearTimeout(noteTimerRef.current);
        noteTimerRef.current = null;
      }
    };
  }, []);

  const openFollowUpFromSearch = (
    result: MobileSearchResult,
    body: string | null,
    sourceLabel: string,
  ) => {
    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current);
      followUpTimerRef.current = null;
    }

    closeSearchResult();

    followUpTimerRef.current = setTimeout(() => {
      const sourceType =
        result.type === 'event'
          ? 'calendar_event'
          : result.type === 'note'
            ? 'note'
            : result.type === 'task'
              ? 'task'
              : result.type === 'project'
                ? 'project'
                : result.type === 'reminder'
                  ? 'reminder'
                  : null;
      openFollowUpSheet({
        title: `Follow up: ${result.title}`,
        notes: body?.trim() || result.snippet?.trim() || result.preview?.trim() || null,
        workspaceId: result.workspace_id,
        projectId: result.project_id ?? null,
        sourceLabel,
        sourceTitle: result.title,
        sourceType,
        sourceId: result.source_id ?? result.id,
        onSaved: () => {
          closeSearchResult();
        },
      });
      followUpTimerRef.current = null;
    }, 220);
  };

  const openNoteFromSearch = (result: MobileSearchResult, sourceLabel: string) => {
    if (noteTimerRef.current) {
      clearTimeout(noteTimerRef.current);
      noteTimerRef.current = null;
    }

    closeSearchResult();

    noteTimerRef.current = setTimeout(() => {
      openQuickNoteSheet({
        sourceLabel,
        workspaceId: result.workspace_id,
        onSaved: () => {
          closeSearchResult();
        },
      });
      noteTimerRef.current = null;
    }, 220);
  };

  const handleSearchAction = (actionId: string, result: MobileSearchResult, body?: string | null) => {
    if (result.type === 'note' && actionId === 'add_follow_up') {
      openFollowUpFromSearch(result, body ?? null, 'From note');
      return;
    }

    if (result.type === 'event' && actionId === 'create_follow_up') {
      openFollowUpFromSearch(result, body ?? null, 'From event');
      return;
    }

    if (actionId === 'add_note' && result.type === 'event') {
      openNoteFromSearch(result, `From event · ${result.title}`);
      return;
    }

    if (result.type === 'project' && actionId === 'add_action') {
      openFollowUpFromSearch(result, body ?? null, 'From project');
      return;
    }

    if (actionId === 'add_note' && result.type === 'project') {
      openNoteFromSearch(result, `From project · ${result.title}`);
      return;
    }

    closeSearchResult();
  };

  return (
    <SearchDetailSheet
      result={activeSearchResult}
      visible={Boolean(activeSearchResult)}
      onClose={closeSearchResult}
      onAction={handleSearchAction}
    />
  );
}

export function MobileSearchSheet() {
  const theme = useLedgerTheme();
  const workspaceState = useWorkspaceState();
  const { isSearchOpen, closeSearch, openSearchResult } = useSearchSheet();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MobileSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRequestId = useRef(0);
  const clearStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options),
    [workspaceState.options, workspaceState.selectedWorkspaceId],
  );

  const scopeLabel = workspaceState.selectedWorkspaceId === 'all' ? 'All Workspaces' : workspaceLabel;

  useEffect(() => {
    if (clearStateTimer.current) {
      clearTimeout(clearStateTimer.current);
      clearStateTimer.current = null;
    }

    if (!isSearchOpen) {
      setQuery('');
      setResults([]);
      setError(null);
      setIsLoading(false);
    }
    return () => {
      if (clearStateTimer.current) {
        clearTimeout(clearStateTimer.current);
        clearStateTimer.current = null;
      }
    };
  }, [isSearchOpen]);

  useEffect(() => {
    const trimmed = query.trim();

    if (!isSearchOpen) return;
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    setIsLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      void searchMobileLedger(workspaceState.selectedWorkspaceId, trimmed)
        .then((nextResults) => {
          if (searchRequestId.current !== requestId) return;
          setResults(Array.isArray(nextResults) ? nextResults : []);
        })
        .catch((searchError) => {
          if (searchRequestId.current !== requestId) return;
          setResults([]);
          setError(searchError instanceof Error ? searchError.message : 'Couldn’t search Ledger.');
        })
        .finally(() => {
          if (searchRequestId.current !== requestId) return;
          setIsLoading(false);
        });
    }, 280);

    return () => clearTimeout(timer);
  }, [isSearchOpen, query, workspaceState.selectedWorkspaceId]);

  if (!isSearchOpen) {
    return null;
  }

  return (
    <>
      <SearchSheetShell
        visible={isSearchOpen}
        onClose={closeSearch}
        title={<SearchHeaderInput value={query} onChangeText={setQuery} onClear={() => setQuery('')} />}
        headerAccessory={
          <AppButton
            title="Close"
            variant="ghost"
            size="md"
            fullWidth={false}
            onPress={closeSearch}
            containerStyle={styles.closeButton}
          />
        }
        >
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
            {scopeLabel}
          </AppText>

          {!query.trim() ? (
            <View style={styles.stateWrap}>
              <AppText variant="body" style={[styles.stateText, { color: theme.colors.textSecondary }]}>
                Search across your Ledger workspaces.
              </AppText>
            </View>
          ) : query.trim().length < 2 ? (
            <View style={styles.stateWrap}>
              <AppText variant="body" style={[styles.stateText, { color: theme.colors.textSecondary }]}>
                Type at least 2 characters to search.
              </AppText>
            </View>
          ) : isLoading ? (
            <View style={styles.stateWrap}>
              <AppText variant="body" style={[styles.stateText, { color: theme.colors.textSecondary }]}>
                Searching…
              </AppText>
            </View>
          ) : error ? (
            <View style={styles.stateWrap}>
              <AppText variant="body" style={[styles.stateText, { color: theme.colors.textSecondary }]}>
                Couldn’t search Ledger.
              </AppText>
            </View>
          ) : results.length === 0 ? (
            <View style={styles.stateWrap}>
              <AppText variant="body" style={[styles.stateText, { color: theme.colors.textSecondary }]}>
                No results found.
              </AppText>
            </View>
          ) : (
            <View style={{ gap: theme.spacing.xs }}>
              {results.map((result) => (
                <SearchResultRow
                  key={`${result.type}-${result.id}`}
                  result={result}
                  onPress={() => {
                    openSearchResult(result);
                  }}
                />
              ))}
            </View>
          )}
        </View>
      </SearchSheetShell>
    </>
  );
}

const styles = StyleSheet.create({
  portal: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  backdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  searchField: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    paddingVertical: 0,
  },
  closeButton: {
    minWidth: 0,
  },
  handleHitArea: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    minHeight: 56,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  content: {
    gap: 12,
  },
  stateWrap: {
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 24,
  },
  stateText: {
    textAlign: 'center',
    lineHeight: 22,
  },
  detailTitle: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '400',
  },
});
