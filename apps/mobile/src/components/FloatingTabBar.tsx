import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { AppText } from './AppText';

import { useSearchSheet } from '@/features/search/SearchSheetContext';
import { useAppPreferencesState } from '@/store/appPreferencesStore';
import { useLedgerTheme } from '@/theme';

const BAR_HEIGHT = 52;
const BAR_SIDE_INSET = 20;
const BAR_BOTTOM_GAP = 0;
const FADE_HEIGHT = 136;
const BLOCK_HEIGHT = 10;
const TRACK_PADDING = 4;
const SEARCH_WIDTH = 44;
const PILL_ANIMATION_DURATION = 240;

const routeLabelByName: Record<string, string> = {
  today: 'Today',
  calendar: 'Calendar',
  capture: 'Capture',
  notifications: 'Notifications',
};

type TabSymbolName = ComponentProps<typeof SymbolView>['name'];

const routeIconByName: Record<string, TabSymbolName> = {
  today: { ios: 'house.fill', android: 'home', web: 'home' },
  calendar: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  capture: { ios: 'plus.circle', android: 'add_circle_outline', web: 'add_circle_outline' },
  notifications: { ios: 'bell', android: 'notifications_none', web: 'notifications_none' },
};

function FadeStack() {
  const theme = useLedgerTheme();
  const fadeColor = theme.scheme === 'dark' ? theme.colors.background : theme.colors.tabBar;

  return (
    <View pointerEvents="none" style={[styles.fadeWrap, { height: FADE_HEIGHT }]}>
      {Array.from({ length: FADE_HEIGHT }).map((_, index) => {
        const opacity = Math.min(1, (index + 1) / FADE_HEIGHT);
        return (
          <View
            key={index}
            style={{
              height: 1,
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
  const { openSearch } = useSearchSheet();
  const appPreferences = useAppPreferencesState();
  const insets = useSafeAreaInsets();
  const [tabLayouts, setTabLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const pillX = useRef(new Animated.Value(0)).current;
  const pillWidth = useRef(new Animated.Value(0)).current;
  const reduceMotionEnabled = appPreferences.reduceMotionEnabled;
  const dockFadeColor = theme.scheme === 'dark' ? theme.colors.background : theme.colors.tabBar;
  const dockShadowColor = theme.scheme === 'dark' ? '#000000' : theme.colors.textPrimary;
  const dockShadowOpacity = theme.scheme === 'dark' ? 0.28 : theme.shadows.surface.opacity;
  const bottomInset = useMemo(() => Math.max(insets.bottom, 8), [insets.bottom]);
  const bottomOffset = bottomInset + BAR_BOTTOM_GAP;
  const dockHeight = bottomOffset + BAR_HEIGHT + FADE_HEIGHT + BLOCK_HEIGHT;
  const activeRouteKey = state.routes[state.index]?.key;
  const activeLayout = activeRouteKey ? tabLayouts[activeRouteKey] : undefined;

  useEffect(() => {
    if (!activeLayout) {
      return;
    }

    if (reduceMotionEnabled) {
      pillX.setValue(activeLayout.x);
      pillWidth.setValue(activeLayout.width);
      return;
    }

    Animated.parallel([
      Animated.timing(pillX, {
        toValue: activeLayout.x,
        duration: PILL_ANIMATION_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(pillWidth, {
        toValue: activeLayout.width,
        duration: PILL_ANIMATION_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [activeLayout, pillWidth, pillX, reduceMotionEnabled]);

  return (
    <View pointerEvents="box-none" style={styles.wrapper}>
      <View
        pointerEvents="none"
        style={[
          styles.dockShell,
          {
            height: dockHeight,
          },
        ]}
      >
        <FadeStack />
        <View
          style={[styles.dockBlock, { height: BLOCK_HEIGHT, backgroundColor: dockFadeColor }]}
        />
        <View style={[styles.dockCover, { backgroundColor: dockFadeColor }]} />
      </View>

      <View
        style={[
          styles.container,
          {
            left: BAR_SIDE_INSET,
            right: BAR_SIDE_INSET,
            bottom: bottomOffset,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.borderSubtle,
            shadowColor: dockShadowColor,
            shadowOpacity: dockShadowOpacity,
            shadowRadius: theme.shadows.surface.radius,
            shadowOffset: { width: 0, height: theme.shadows.surface.offsetY },
            elevation: theme.shadows.surface.elevation,
          },
        ]}
      >
        <View style={styles.track}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.activePill,
              {
                width: reduceMotionEnabled ? activeLayout?.width ?? 0 : pillWidth,
                ...(reduceMotionEnabled
                  ? { left: activeLayout?.x ?? 0 }
                  : { transform: [{ translateX: pillX }] }),
                backgroundColor: theme.colors.accent,
                opacity: activeLayout ? 1 : 0,
              },
            ]}
          />

          {state.routes.map((route: any, index: number) => {
            const isFocused = state.index === index;
            const options = descriptors[route.key]?.options ?? {};
            const title = routeLabelByName[route.name] ?? String(options.title ?? route.name);

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityState={isFocused ? { selected: true } : {}}
                onLayout={(event) => {
                  const { x, width } = event.nativeEvent.layout;
                  setTabLayouts((current) => {
                    const existing = current[route.key];
                    if (existing && existing.x === x && existing.width === width) {
                      return current;
                    }

                    return {
                      ...current,
                      [route.key]: { x, width },
                    };
                  });
                }}
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
                  size={20}
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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open search"
          onPress={() => {
            openSearch();
          }}
          style={({ pressed }) => [
            styles.searchButton,
            {
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <SymbolView
            name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
            size={20}
            weight="regular"
            tintColor={theme.colors.textPrimary}
            fallback={
              <AppText
                variant="body"
                style={{
                  fontSize: 18,
                  lineHeight: 18,
                  fontWeight: '400',
                  color: theme.colors.textPrimary,
                }}
              >
                ⌕
              </AppText>
            }
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
  },
  dockShell: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  fadeWrap: {
    overflow: 'hidden',
  },
  dockCover: {
    flex: 1,
  },
  dockBlock: {
    width: '100%',
  },
  container: {
    position: 'absolute',
    height: BAR_HEIGHT,
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
  searchButton: {
    width: SEARCH_WIDTH,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 0,
    marginRight: 0,
  },
});
