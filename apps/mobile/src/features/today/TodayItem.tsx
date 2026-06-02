import { memo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

type TodayItemProps = {
  title: string;
  subtitle?: string | null;
  onPress?: () => void;
  onLongPress?: () => void;
};

function TodayItemBase({ title, subtitle, onPress, onLongPress }: TodayItemProps) {
  const theme = useLedgerTheme();
  const longPressTriggered = useRef(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens item details. Long press for actions."
      onLongPress={() => {
        longPressTriggered.current = true;
        onLongPress?.();
      }}
      onPress={() => {
        if (longPressTriggered.current) {
          return;
        }
        onPress?.();
      }}
      onPressOut={() => {
        setTimeout(() => {
          longPressTriggered.current = false;
        }, 0);
      }}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: theme.colors.borderSubtle,
          paddingVertical: theme.spacing.md,
          opacity: pressed ? 0.72 : 1,
        },
      ]}>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="body">{title}</AppText>
        {subtitle ? <AppText variant="meta">{subtitle}</AppText> : null}
      </View>
    </Pressable>
  );
}

export const TodayItem = memo(TodayItemBase);

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
