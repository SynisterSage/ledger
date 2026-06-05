import type { ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { AppText } from './AppText';
import { Skeleton } from './Skeleton';

import { useLedgerTheme } from '@/theme';

export const MOBILE_PAGE_HEADER_SCROLL_SPACE = 156;
export const MOBILE_PULL_TO_REFRESH_OFFSET = MOBILE_PAGE_HEADER_SCROLL_SPACE - 20;
const HEADER_COLLAPSE_DISTANCE = 64;
const HEADER_TRANSLATE_DISTANCE = 36;
const HEADER_TOP_SPACING = -16;

type MobilePageHeaderProps = {
  title: string;
  workspaceLabel?: string;
  onWorkspacePress?: () => void;
  workspaceExpanded?: boolean;
  onSettingsPress?: () => void;
  showSettings?: boolean;
  workspaceLoading?: boolean;
  scrollY: Animated.Value;
  rightAccessory?: ReactNode;
};

export function MobilePageHeader({
  title,
  workspaceLabel = 'All Workspaces',
  onWorkspacePress,
  workspaceExpanded = false,
  onSettingsPress,
  showSettings = true,
  workspaceLoading = false,
  scrollY,
  rightAccessory,
}: MobilePageHeaderProps) {
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();
  const translateY = scrollY.interpolate({
    inputRange: [0, HEADER_COLLAPSE_DISTANCE],
    outputRange: [0, -HEADER_TRANSLATE_DISTANCE],
    extrapolate: 'clamp',
  });
  const opacity = scrollY.interpolate({
    inputRange: [0, HEADER_COLLAPSE_DISTANCE - 8, HEADER_COLLAPSE_DISTANCE],
    outputRange: [1, 0.32, 0],
    extrapolate: 'clamp',
  });
  const handleWorkspacePress = onWorkspacePress ?? (() => {});
  const handleSettingsPress = onSettingsPress ?? (() => {});

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        {
          paddingTop: insets.top + HEADER_TOP_SPACING,
          opacity,
          transform: [{ translateY }],
        },
      ]}>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <View style={styles.titleCluster}>
            <AppText variant="screenTitle">{title}</AppText>
            {showSettings ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                hitSlop={8}
                onPress={handleSettingsPress}
                style={({ pressed }) => [
                  styles.iconButton,
                  {
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}>
                <SymbolView
                  name={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
                  size={20}
                  weight="regular"
                  tintColor={theme.colors.accent}
                />
              </Pressable>
            ) : null}
            {rightAccessory}
          </View>
        </View>

        {workspaceLoading ? (
          <View style={styles.workspaceLoadingWrap}>
            <Skeleton width={96} height={16} radius={8} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change workspace"
            hitSlop={8}
            onPress={handleWorkspacePress}
            style={({ pressed }) => [
              styles.workspaceButton,
              {
                opacity: pressed ? 0.72 : 1,
              },
            ]}>
            <AppText
              variant="body"
              style={{
                color: theme.colors.textSecondary,
                fontWeight: '400',
              }}>
              {workspaceLabel}
            </AppText>
            <SymbolView
              name={{
                ios: workspaceExpanded ? 'chevron.up' : 'chevron.down',
                android: workspaceExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down',
                web: workspaceExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down',
              }}
              size={11}
              weight="regular"
              tintColor={theme.colors.textSecondary}
            />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 5,
  },
  content: {
    alignItems: 'center',
    gap: 8,
  },
  titleRow: {
    width: '100%',
    alignItems: 'center',
  },
  titleCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: 1 }],
  },
  workspaceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  workspaceLoadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
  },
});
