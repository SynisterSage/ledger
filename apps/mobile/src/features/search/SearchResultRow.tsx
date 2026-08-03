import { Pressable, StyleSheet, View } from 'react-native';

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
          borderBottomColor: theme.colors.borderSubtle,
          opacity: pressed ? 0.72 : 1,
        },
      ]}>
      <View style={styles.content}>
        <AppText variant="body" style={styles.title}>
          {result.title}
        </AppText>
        <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
          {subtitle}
        </AppText>
        {result.snippet ? (
          <AppText variant="meta" style={{ color: theme.colors.textMuted }} numberOfLines={2}>
            {result.snippet}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  content: {
    gap: 4,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
  },
});
