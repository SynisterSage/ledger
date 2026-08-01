import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileTodayItem, MobileTodayInteractionItem } from '@/types/ledger';

type FocusPickerSheetProps = {
  visible: boolean;
  focused: MobileTodayItem[];
  candidates: MobileTodayInteractionItem[];
  onClose: () => void;
  onSelect: (item: MobileTodayInteractionItem) => void;
  onRemove: (item: MobileTodayItem) => void;
  onMove: (item: MobileTodayItem, direction: -1 | 1) => void;
  onCreateTask: () => void;
};

export function FocusPickerSheet({
  visible,
  focused,
  candidates,
  onClose,
  onSelect,
  onRemove,
  onMove,
  onCreateTask,
}: FocusPickerSheetProps) {
  const theme = useLedgerTheme();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const filteredCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return candidates.filter((item) => !normalized || item.title.toLowerCase().includes(normalized));
  }, [candidates, query]);

  return (
    <AppBottomSheet
      visible={visible}
      onClose={() => {
        setQuery('');
        setEditing(false);
        onClose();
      }}
      title="Focus"
      snapPoints={['55%', '85%']}
      initialSnapPointIndex={1}
    >
      <View style={{ gap: theme.spacing.md }}>
        <View style={styles.toolbar}>
          <AppText variant="meta">Choose what matters today</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Done reordering focus' : 'Reorder focus items'}
            onPress={() => setEditing((current) => !current)}
            hitSlop={8}
          >
            <AppText variant="meta" style={{ color: theme.colors.accent }}>
              {editing ? 'Done' : 'Reorder'}
            </AppText>
          </Pressable>
        </View>

        {focused.length ? (
          <View>
            {focused.map((item, index) => (
              <View key={item.id} style={[styles.row, { borderBottomColor: theme.colors.borderSubtle }]}>
                <View style={styles.rowMain}>
                  <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                    {item.title}
                  </AppText>
                  {editing ? (
                    <View style={styles.reorderControls}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${item.title} up`}
                        disabled={index === 0}
                        onPress={() => onMove(item, -1)}
                        hitSlop={8}
                      >
                        <AppText variant="meta" style={{ color: index === 0 ? theme.colors.textMuted : theme.colors.textPrimary }}>
                          ↑
                        </AppText>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${item.title} down`}
                        disabled={index === focused.length - 1}
                        onPress={() => onMove(item, 1)}
                        hitSlop={8}
                      >
                        <AppText variant="meta" style={{ color: index === focused.length - 1 ? theme.colors.textMuted : theme.colors.textPrimary }}>
                          ↓
                        </AppText>
                      </Pressable>
                    </View>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.title} from Focus`}
                    onPress={() => onRemove(item)}
                    hitSlop={8}
                  >
                    <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
                      Remove
                    </AppText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="Search items to add to Focus"
          autoCorrect={false}
          placeholder="Search items"
          placeholderTextColor={theme.colors.placeholder}
          value={query}
          onChangeText={setQuery}
          style={[
            styles.search,
            {
              color: theme.colors.textPrimary,
              backgroundColor: theme.colors.inputBackground,
              borderColor: theme.colors.borderSubtle,
            },
          ]}
        />

        <View>
          {filteredCandidates.length ? (
            filteredCandidates.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Add ${item.title} to Focus`}
                onPress={() => onSelect(item)}
                style={({ pressed }) => [styles.row, { borderBottomColor: theme.colors.borderSubtle, opacity: pressed ? 0.6 : 1 }]}
              >
                <AppText variant="body" numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText variant="meta">
                  {'source' in item ? 'Capture' : item.type === 'task' ? 'Task' : item.type}
                </AppText>
              </Pressable>
            ))
          ) : (
            <AppText variant="meta" style={{ paddingVertical: theme.spacing.sm }}>
              No eligible items found.
            </AppText>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create new task for Focus"
          onPress={onCreateTask}
          style={({ pressed }) => [styles.create, { borderColor: theme.colors.borderSubtle, opacity: pressed ? 0.6 : 1 }]}
        >
          <AppText variant="body" style={{ color: theme.colors.accent }}>
            Create new task
          </AppText>
        </Pressable>
      </View>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    minHeight: 44,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  rowMain: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reorderControls: {
    flexDirection: 'row',
    gap: 14,
  },
  search: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  create: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
