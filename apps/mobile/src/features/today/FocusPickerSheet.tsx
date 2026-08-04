import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

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
  onQuickAdd: (title: string) => Promise<void>;
};

function candidateTypeLabel(item: MobileTodayInteractionItem) {
  if ('source' in item) return 'Capture';
  if (item.type === 'project_action') return 'Project action';
  if (item.type === 'task') return 'Task';
  if (item.type === 'event') return 'Event';
  if (item.type === 'reminder') return 'Reminder';
  if (item.type === 'deadline') return 'Deadline';
  return item.type;
}

export function FocusPickerSheet({
  visible,
  focused,
  candidates,
  onClose,
  onSelect,
  onRemove,
  onMove,
  onQuickAdd,
}: FocusPickerSheetProps) {
  const theme = useLedgerTheme();
  const [quickTitle, setQuickTitle] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  return (
    <AppBottomSheet
      visible={visible}
        onClose={() => {
          setQuickTitle('');
          setQuickError(null);
          setEditing(false);
          onClose();
      }}
      title="Focus"
      snapPoints={['55%', '85%']}
      initialSnapPointIndex={1}
      dragCloseThreshold={48}
      dragCloseVelocityThreshold={0.55}
    >
      <View style={{ gap: theme.spacing.md }}>
        <View
          style={[styles.quickAdd, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}
        >
          <View style={styles.quickAddHeader}>
            <AppText variant="bodyStrong">Quick add focus</AppText>
            <AppText variant="caption">{focused.length}/3</AppText>
          </View>
          <View style={styles.quickAddRow}>
            <TextInput
              accessibilityLabel="Quick focus title"
              autoCorrect
              editable={!quickSaving && focused.length < 3}
              onChangeText={(value) => { setQuickTitle(value); setQuickError(null); }}
              onSubmitEditing={() => {
                const title = quickTitle.trim();
                if (!title || quickSaving || focused.length >= 3) return;
                setQuickSaving(true);
                void onQuickAdd(title).then(() => setQuickTitle('')).catch((error: unknown) => setQuickError(error instanceof Error ? error.message : 'Could not add focus.')).finally(() => setQuickSaving(false));
              }}
              placeholder={focused.length >= 3 ? 'Focus limit reached' : 'What matters today?'}
              placeholderTextColor={theme.colors.placeholder}
              returnKeyType="done"
              value={quickTitle}
              style={[styles.quickInput, { color: theme.colors.textPrimary, borderColor: 'transparent', backgroundColor: 'transparent' }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add quick focus"
              disabled={!quickTitle.trim() || quickSaving || focused.length >= 3}
              onPress={() => {
                const title = quickTitle.trim();
                if (!title) return;
                setQuickSaving(true);
                void onQuickAdd(title).then(() => setQuickTitle('')).catch((error: unknown) => setQuickError(error instanceof Error ? error.message : 'Could not add focus.')).finally(() => setQuickSaving(false));
              }}
              style={({ pressed }) => [styles.quickButton, { backgroundColor: theme.colors.accent, opacity: pressed || quickSaving || !quickTitle.trim() || focused.length >= 3 ? 0.5 : 1 }]}
            >
              <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={20} tintColor={theme.colors.onAccent} />
            </Pressable>
          </View>
          {quickError ? <AppText variant="caption" style={{ color: theme.colors.danger }}>{quickError}</AppText> : null}
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}>
          {candidates.length ? (
            candidates.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Add ${item.title} to Focus`}
                onPress={() => onSelect(item)}
                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
              >
                <AppText variant="body" numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText variant="meta">
                  {candidateTypeLabel(item)}
                </AppText>
              </Pressable>
            ))
          ) : (
            <AppText variant="meta" style={styles.empty}>
              No eligible items found.
            </AppText>
          )}
        </View>

        {focused.length ? (
          <View style={styles.toolbar}>
            <AppText variant="meta">Choose what matters today</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Done reordering focus' : 'Reorder focus items'}
              accessibilityState={{ selected: editing }}
              onPress={() => setEditing((current) => !current)}
              hitSlop={8}
              style={styles.reorderButton}
            >
              <SymbolView
                name={editing
                  ? { ios: 'checkmark', android: 'check', web: 'check' }
                  : { ios: 'arrow.up.arrow.down', android: 'swap_vert', web: 'swap_vert' }}
                size={18}
                tintColor={theme.colors.accent}
              />
            </Pressable>
          </View>
        ) : null}

        {focused.length ? (
          <View style={[styles.card, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.window }]}>
            {focused.map((item, index) => (
              <View key={item.id} style={styles.row}>
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
  reorderButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    minHeight: 52,
    paddingVertical: 8,
    paddingHorizontal: 16,
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
  card: {
    overflow: 'hidden',
  },
  empty: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  quickAdd: {
    padding: 16,
    gap: 10,
  },
  quickAddHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickInput: {
    flex: 1,
    minHeight: 48,
    borderWidth: 0,
    paddingHorizontal: 0,
    fontSize: 18,
    lineHeight: 24,
  },
  quickButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
