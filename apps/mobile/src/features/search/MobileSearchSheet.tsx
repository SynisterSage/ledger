import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppButton } from '@/components/AppButton';
import { AppDetailSheet } from '@/components/AppDetailSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { useWorkspaceState, getWorkspaceLabel } from '@/store/workspaceStore';
import type { MobileSearchResult } from '@/types/ledger';
import { searchMobileLedger } from '@/api/search';

import { SearchResultRow } from './SearchResultRow';
import {
  getSearchResultActions,
  getSearchResultBody,
  getSearchResultMetaRows,
  getSearchResultSubtitle,
} from './searchAdapters';
import { useSearchSheet } from './SearchSheetContext';

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

function SearchDetailSheet({
  result,
  visible,
  onClose,
}: {
  result: MobileSearchResult | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!result) return null;

  return (
    <AppDetailSheet
      visible={visible}
      title={result.title}
      subtitle={getSearchResultSubtitle(result)}
      meta={getSearchResultMetaRows(result)}
      body={getSearchResultBody(result) ?? undefined}
      actions={getSearchResultActions(result)}
      onClose={onClose}
      onAction={() => {
        onClose();
      }}
    />
  );
}

export function MobileSearchResultDetailSheet() {
  const { activeSearchResult, closeSearchResult } = useSearchSheet();

  return (
    <SearchDetailSheet
      result={activeSearchResult}
      visible={Boolean(activeSearchResult)}
      onClose={closeSearchResult}
    />
  );
}

export function MobileSearchSheet() {
  const theme = useLedgerTheme();
  const { height: windowHeight } = useWindowDimensions();
  const workspaceState = useWorkspaceState();
  const { isSearchOpen, closeSearch, openSearchResult } = useSearchSheet();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MobileSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRequestId = useRef(0);

  const workspaceLabel = useMemo(
    () => getWorkspaceLabel(workspaceState.selectedWorkspaceId, workspaceState.options),
    [workspaceState.options, workspaceState.selectedWorkspaceId],
  );

  const scopeLabel = workspaceState.selectedWorkspaceId === 'all' ? 'All Workspaces' : workspaceLabel;

  useEffect(() => {
    if (!isSearchOpen) {
      setQuery('');
      setResults([]);
      setError(null);
      setIsLoading(false);
    }
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
      <AppBottomSheet
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
        snapPoints={['100%']}
        initialSnapPointIndex={0}
        maxHeight={Math.max(0, windowHeight - 70)}
        cornerRadius={36}
        contentStyle={{ paddingTop: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
            {scopeLabel}
          </AppText>

          {!query.trim() ? (
            <View style={styles.stateWrap}>
              <AppText variant="body" style={{ paddingTop: theme.spacing.sm + 150, color: theme.colors.textSecondary}}>
                Search across your Ledger workspaces.
              </AppText>
            </View>
          ) : query.trim().length < 2 ? (
            <View style={styles.stateWrap}>
              <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
                Type at least 2 characters to search.
              </AppText>
            </View>
          ) : isLoading ? (
            <View style={styles.stateWrap}>
              <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
                Searching…
              </AppText>
            </View>
          ) : error ? (
            <View style={styles.stateWrap}>
              <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
                Couldn’t search Ledger.
              </AppText>
            </View>
          ) : results.length === 0 ? (
            <View style={styles.stateWrap}>
              <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
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
      </AppBottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
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
  stateWrap: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '400',
  },
});
