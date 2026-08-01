import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

export const TODAY_HEADER_SCROLL_SPACE = 116;

type TodayHeaderProps = {
  workspaceLabel: string;
  workspaceLoading?: boolean;
  workspaceExpanded?: boolean;
  unreadCount?: number;
  onWorkspacePress: () => void;
  onSearchPress: () => void;
  onNotificationsPress: () => void;
  scrollY: Animated.Value;
};

function getInitials(label: string) {
  const words = label
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return 'L';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function formatTodayDate() {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

export function TodayHeader({
  workspaceLabel,
  workspaceLoading = false,
  workspaceExpanded = false,
  unreadCount = 0,
  onWorkspacePress,
  onSearchPress,
  onNotificationsPress,
  scrollY,
}: TodayHeaderProps) {
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  const translateY = scrollY.interpolate({
    inputRange: [0, 60],
    outputRange: [0, -24],
    extrapolate: 'clamp',
  });
  const opacity = scrollY.interpolate({
    inputRange: [0, 52, 72],
    outputRange: [1, 0.35, 0],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        {
          paddingTop: insets.top + 4,
          backgroundColor: theme.colors.background,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change workspace"
          hitSlop={8}
          onPress={onWorkspacePress}
          style={({ pressed }) => [styles.workspace, { opacity: pressed ? 0.66 : 1 }]}
        >
          <View style={[styles.avatar, { backgroundColor: theme.colors.surfaceMuted }]}>
            <AppText
              variant="caption"
              style={{ color: theme.colors.textSecondary, fontWeight: '600' }}
            >
              {getInitials(workspaceLabel)}
            </AppText>
          </View>
          <View style={styles.workspaceCopy}>
            <View style={styles.workspaceNameRow}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {workspaceLoading ? 'Loading…' : workspaceLabel}
              </AppText>
              <SymbolView
                name={{
                  ios: workspaceExpanded ? 'chevron.up' : 'chevron.down',
                  android: workspaceExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down',
                  web: workspaceExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down',
                }}
                size={12}
                weight="medium"
                tintColor={theme.colors.textMuted}
              />
            </View>
            <AppText variant="caption" style={{ color: theme.colors.textMuted }}>
              {formatTodayDate()}
            </AppText>
          </View>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search Ledger"
            hitSlop={10}
            onPress={onSearchPress}
            style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.55 : 1 }]}
          >
            <SymbolView
              name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
              size={19}
              weight="regular"
              tintColor={theme.colors.textSecondary}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open notifications"
            hitSlop={10}
            onPress={onNotificationsPress}
            style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.55 : 1 }]}
          >
            <SymbolView
              name={{ ios: 'bell', android: 'notifications_none', web: 'notifications_none' }}
              size={19}
              weight="regular"
              tintColor={theme.colors.textSecondary}
            />
            {unreadCount > 0 ? (
              <View style={[styles.badge, { backgroundColor: theme.colors.accent }]}>
                <AppText variant="caption" style={styles.badgeText}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -22,
    zIndex: 5,
    paddingHorizontal: 0,
    paddingBottom: 6,
  },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  workspace: {
    minHeight: 44,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  workspaceCopy: {
    minWidth: 0,
    gap: 1,
  },
  workspaceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconButton: {
    width: 30,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 3,
    right: -2,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '600',
  },
});
