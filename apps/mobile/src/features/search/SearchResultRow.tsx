import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileSearchResult } from '@/types/ledger';
import { NoteRow, noteRowDataFromSummary } from '@/features/notes/NoteRow';

import { getSearchResultSubtitle } from './searchAdapters';

type SearchResultRowProps = {
  result: MobileSearchResult;
  onPress: () => void;
};

export function SearchResultRow({ result, onPress }: SearchResultRowProps) {
  const theme = useLedgerTheme();
  const subtitle = getSearchResultSubtitle(result);

  if (result.type === 'note') {
    return (
      <NoteRow
        note={noteRowDataFromSummary({
          id: result.id,
          workspace_id: result.workspace_id,
          title: result.title,
          preview: result.preview || result.snippet,
          mode: 'text',
          updated_at: result.updated_at ?? null,
          created_at: null,
          section_id: null,
          parent_id: null,
        }, { projectTitle: result.project_id ? 'Linked project' : null })}
        onPress={onPress}
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens result details."
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.colors.surfaceHover : 'transparent',
          borderRadius: theme.radius.control,
          opacity: pressed ? 0.72 : 1,
        },
      ]}>
      <View style={[styles.iconWrap, { backgroundColor: theme.colors.surfaceMuted }]} accessible={false}>
        <SymbolView name={getResultIcon(result)} size={18} tintColor={theme.colors.textMuted} />
      </View>
      <View style={styles.content}>
        <AppText variant="bodyStrong" numberOfLines={1} style={styles.title}>
          {result.title}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {subtitle}
        </AppText>
        {result.snippet ? (
          <AppText variant="caption" style={{ color: theme.colors.textMuted }} numberOfLines={1}>
            {result.snippet}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

function getResultIcon(result: MobileSearchResult) {
  switch (result.type) {
    case 'project':
      return { ios: 'folder' as const, android: 'folder' as const, web: 'folder' as const };
    case 'task':
      return { ios: 'checkmark.circle' as const, android: 'check_circle_outline' as const, web: 'check_circle_outline' as const };
    case 'reminder':
      return { ios: 'bell' as const, android: 'notifications_none' as const, web: 'notifications_none' as const };
    case 'event':
      return { ios: 'calendar' as const, android: 'calendar_today' as const, web: 'calendar_today' as const };
    default:
      return { ios: 'doc.text' as const, android: 'description' as const, web: 'description' as const };
  }
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 4,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  content: {
    minWidth: 0,
    flex: 1,
    gap: 4,
  },
  title: {
    flex: 1,
  },
});
