import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { AppText } from './AppText';
import { useFloatingTabBarScroll } from './FloatingTabBarScrollContext';

import { useAppPreferencesState } from '@/store/appPreferencesStore';
import { useLedgerTheme } from '@/theme';

const BAR_HEIGHT_EXPANDED = 58;
const BAR_HEIGHT_COMPACT = 44;
const BAR_SIDE_INSET = 20;
const BAR_BOTTOM_GAP = 0;
const FADE_HEIGHT = 188;
const FADE_STEPS = 17;
const DOCK_FADE_OPACITY_SCALE = 0.72;
const TRACK_PADDING = 4;
const PILL_ANIMATION_DURATION = 240;

const routeLabelByName: Record<string, string> = {
  today: 'Today',
  calendar: 'Calendar',
  capture: 'Capture',
  projects: 'Projects',
  notes: 'Notes',
  notifications: 'Notifications',
};

type TabSymbolName = ComponentProps<typeof SymbolView>['name'];

const routeIconByName: Record<string, TabSymbolName> = {
  today: { ios: 'house.fill', android: 'home', web: 'home' },
  calendar: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  capture: { ios: 'plus.circle', android: 'add_circle_outline', web: 'add_circle_outline' },
  projects: { ios: 'folder', android: 'folder', web: 'folder' },
  notes: { ios: 'note.text', android: 'note', web: 'note' },
  notifications: { ios: 'bell', android: 'notifications_none', web: 'notifications_none' },
};

function FadeStack({ opacityScale = 1 }: { opacityScale?: number }) {
  const theme = useLedgerTheme();
  const fadeColor = theme.colors.background;

  return (
    <View pointerEvents="none" style={[styles.fadeWrap, { height: FADE_HEIGHT }]}>
      {Array.from({ length: FADE_STEPS }).map((_, index) => {
        const opacity = Math.min(1, ((index + 1) / FADE_STEPS) * opacityScale);
        return (
          <View
            key={index}
            style={{
              height: FADE_HEIGHT / FADE_STEPS,
              backgroundColor: fadeColor,
              opacity,
            }}
          />
        );
      })}
    </View>
  );
}

export function FloatingTabBar({ state, descriptors, navigation }: any) {
  const theme = useLedgerTheme();
  const appPreferences = useAppPreferencesState();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [trackWidth, setTrackWidth] = useState(0);
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const compactProgress = useSharedValue(0);
  const reduceMotionEnabled = appPreferences.reduceMotionEnabled;
  const { isCompact, resetScrollState } = useFloatingTabBarScroll();
  const dockShadowColor = theme.scheme === 'dark' ? '#000000' : theme.colors.textPrimary;
  const dockShadowOpacity = theme.scheme === 'dark' ? 0.28 : theme.shadows.surface.opacity;
  const activeRouteKey = state.routes[state.index]?.key;
  const isNotificationsRoute = state.routes[state.index]?.name === 'notifications';
  const bottomInset = useMemo(() => Math.max(insets.bottom, 8), [insets.bottom]);
  const bottomOffset = bottomInset + BAR_BOTTOM_GAP;
  const animatedBarStyle = useAnimatedStyle(() => ({
    height: BAR_HEIGHT_EXPANDED + (BAR_HEIGHT_COMPACT - BAR_HEIGHT_EXPANDED) * compactProgress.value,
  }));
  const animatedScrimStyle = useAnimatedStyle(() => ({
    bottom: bottomOffset,
    height: FADE_HEIGHT,
  }));
  const animatedPillStyle = useAnimatedStyle(() => ({
    width: pillWidth.value,
    transform: [{ translateX: pillX.value }],
  }));
  const visibleRoutes = state.routes.filter((route: any) => route.name !== 'notifications');
  const activeIndex = visibleRoutes.findIndex((route: any) => route.key === activeRouteKey);
  const slotWidth = visibleRoutes.length ? Math.max(0, trackWidth - TRACK_PADDING * 2) / visibleRoutes.length : 0;
  const activeX = TRACK_PADDING + Math.max(0, activeIndex) * slotWidth;

  useEffect(() => {
    resetScrollState();
  }, [activeRouteKey, resetScrollState]);

  useEffect(() => {
    if (reduceMotionEnabled) {
      compactProgress.value = isCompact ? 1 : 0;
      return;
    }

    compactProgress.value = withTiming(isCompact ? 1 : 0, { duration: 80 });
  }, [compactProgress, isCompact, reduceMotionEnabled]);

  useEffect(() => {
    if (slotWidth <= 0 || activeIndex < 0) {
      return;
    }

    if (reduceMotionEnabled) {
      pillX.value = activeX;
      pillWidth.value = slotWidth;
      return;
    }

    pillX.value = withTiming(activeX, { duration: PILL_ANIMATION_DURATION });
    pillWidth.value = withTiming(slotWidth, { duration: PILL_ANIMATION_DURATION });
  }, [activeIndex, activeX, slotWidth, pillWidth, pillX, reduceMotionEnabled]);

  // Keep hooks above this branch so the tab bar remains valid when the
  // Calendar switches between portrait and landscape presentations.
  if (width > height || isNotificationsRoute) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={styles.wrapper}>
      <Reanimated.View pointerEvents="none" style={[styles.scrim, animatedScrimStyle]}>
        <FadeStack opacityScale={DOCK_FADE_OPACITY_SCALE} />
      </Reanimated.View>

      <Reanimated.View
        style={[
          styles.container,
          animatedBarStyle,
          {
            left: BAR_SIDE_INSET,
            right: BAR_SIDE_INSET,
            bottom: bottomOffset,
            backgroundColor: theme.colors.background,
            borderColor: theme.colors.borderSubtle,
            shadowColor: dockShadowColor,
            shadowOpacity: dockShadowOpacity,
            shadowRadius: theme.shadows.surface.radius,
            shadowOffset: { width: 0, height: theme.shadows.surface.offsetY },
            elevation: theme.shadows.surface.elevation,
          },
        ]}
      >
        <View style={styles.track} onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}>
          <Reanimated.View
            pointerEvents="none"
            style={[
              styles.activePill,
              animatedPillStyle,
              {
                backgroundColor: theme.colors.accent,
                opacity: slotWidth > 0 && activeIndex >= 0 ? 1 : 0,
              },
            ]}
          />

          {visibleRoutes.map((route: any) => {
            const routeIndex = state.routes.findIndex((candidate: any) => candidate.key === route.key);
            const isFocused = state.index === routeIndex;
            const options = descriptors[route.key]?.options ?? {};
            const title = routeLabelByName[route.name] ?? String(options.title ?? route.name);

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityState={isFocused ? { selected: true } : {}}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });

                  if (!isFocused && !event.defaultPrevented) {
                    navigation.navigate(route.name);
                  }
                }}
                style={({ pressed }) => [
                  styles.tabButton,
                  {
                    paddingHorizontal: 0,
                    marginRight: 0,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                <SymbolView
                  name={routeIconByName[route.name] ?? { ios: 'circle', android: 'circle', web: 'circle' }}
                  size={isCompact ? 18 : 20}
                  weight={isFocused ? 'semibold' : 'regular'}
                  tintColor={isFocused ? '#FFFFFF' : theme.colors.textPrimary}
                  fallback={
                    <AppText
                      variant="body"
                      style={{
                        fontSize: 20,
                        lineHeight: 20,
                        color: isFocused ? '#FFFFFF' : theme.colors.textPrimary,
                      }}
                    >
                      •
                    </AppText>
                  }
                />
              </Pressable>
            );
          })}
        </View>

      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
    zIndex: 0,
  },
  fadeWrap: {
    overflow: 'hidden',
  },
  container: {
    position: 'absolute',
    height: BAR_HEIGHT_EXPANDED,
    zIndex: 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 0,
  },
  track: {
    flex: 1,
    height: '100%',
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    overflow: 'hidden',
    borderRadius: 999,
    padding: TRACK_PADDING,
  },
  activePill: {
    position: 'absolute',
    left: 0,
    top: TRACK_PADDING,
    bottom: TRACK_PADDING,
    borderRadius: 999,
  },
  tabButton: {
    flex: 1,
    height: '100%',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
