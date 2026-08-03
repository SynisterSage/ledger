import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

type TodaySectionProps = {
  title: string;
  count?: number;
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  onLayout?: (y: number) => void;
};

export function TodaySection({
  title,
  count,
  children,
  collapsed = false,
  onToggle,
  actionLabel,
  onAction,
  onLayout,
}: TodaySectionProps) {
  const theme = useLedgerTheme();

  return (
    <View
      onLayout={(event) => onLayout?.(event.nativeEvent.layout.y)}
      style={styles.section}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
          hitSlop={8}
          onPress={onToggle}
          style={({ pressed }) => [styles.titleButton, { opacity: pressed ? 0.62 : 1 }]}
        >
          {onToggle ? (
            <SymbolView
              name={{
                ios: collapsed ? 'chevron.right' : 'chevron.down',
                android: collapsed ? 'keyboard_arrow_right' : 'keyboard_arrow_down',
                web: collapsed ? 'keyboard_arrow_right' : 'keyboard_arrow_down',
              }}
              size={13}
              weight="medium"
              tintColor={theme.colors.textMuted}
            />
          ) : null}
          <AppText variant="label" style={{ letterSpacing: 0.5 }}>
            {title}
          </AppText>
          {typeof count === 'number' ? (
            <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
              {count}
            </AppText>
          ) : null}
        </Pressable>
        {actionLabel && onAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            hitSlop={8}
            onPress={onAction}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.55 : 1 }]}
          >
            <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>
              {actionLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {!collapsed ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingTop: 4,
    paddingBottom: 4,
  },
  header: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleButton: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  action: {
    minHeight: 30,
    justifyContent: 'center',
  },
  body: {
    paddingTop: 5,
    gap: 4,
  },
});
