import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

const BAR_HEIGHT = 52;
const BAR_SIDE_INSET = 20;
const BAR_BOTTOM_GAP = 0;
const FADE_HEIGHT = 136;
const BLOCK_HEIGHT = 10;
const TRACK_PADDING = 4;
const SEARCH_WIDTH = 28;
const TAB_HORIZONTAL_PADDING = 12;
const PILL_ANIMATION_DURATION = 240;
const LABEL_HIGHLIGHT_DELAY = 110;
const LABEL_HIGHLIGHT_DURATION = 150;

const AnimatedText = Animated.createAnimatedComponent(Text);

const routeLabelByName: Record<string, string> = {
  today: 'Today',
  capture: 'Capture',
  notifications: 'Notifications',
};

function FadeStack() {
  const theme = useLedgerTheme();

  return (
    <View pointerEvents="none" style={[styles.fadeWrap, { height: FADE_HEIGHT }]}>
      {Array.from({ length: FADE_HEIGHT }).map((_, index) => {
        const opacity = Math.min(1, (index + 1) / FADE_HEIGHT);
        return (
          <View
            key={index}
            style={{
              height: 1,
              backgroundColor: theme.colors.background,
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
  const insets = useSafeAreaInsets();
  const [tabLayouts, setTabLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const pillX = useRef(new Animated.Value(0)).current;
  const pillWidth = useRef(new Animated.Value(0)).current;
  const labelProgress = useRef<Record<string, Animated.Value>>({}).current;
  const bottomInset = useMemo(() => Math.max(insets.bottom, 8), [insets.bottom]);
  const bottomOffset = bottomInset + BAR_BOTTOM_GAP;
  const dockHeight = bottomOffset + BAR_HEIGHT + FADE_HEIGHT + BLOCK_HEIGHT;
  const activeRouteKey = state.routes[state.index]?.key;
  const activeLayout = activeRouteKey ? tabLayouts[activeRouteKey] : undefined;

  const getLabelProgress = useCallback((routeKey: string) => {
    if (!labelProgress[routeKey]) {
      labelProgress[routeKey] = new Animated.Value(routeKey === activeRouteKey ? 1 : 0);
    }

    return labelProgress[routeKey];
  }, [activeRouteKey, labelProgress]);

  useEffect(() => {
    if (!activeLayout) {
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
  }, [activeLayout, pillWidth, pillX]);

  useEffect(() => {
    state.routes.forEach((route: any) => {
      const progress = getLabelProgress(route.key);

      if (route.key === activeRouteKey) {
        Animated.timing(progress, {
          toValue: 1,
          duration: LABEL_HIGHLIGHT_DURATION,
          delay: LABEL_HIGHLIGHT_DELAY,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
        return;
      }

      Animated.timing(progress, {
        toValue: 0,
        duration: 110,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    });
  }, [activeRouteKey, getLabelProgress, state.routes]);

  return (
    <View pointerEvents="box-none" style={styles.wrapper}>
      <View
        pointerEvents="none"
        style={[
          styles.dockShell,
          {
            height: dockHeight,
          },
        ]}>
        <FadeStack />
        <View style={[styles.dockBlock, { height: BLOCK_HEIGHT, backgroundColor: theme.colors.background }]} />
        <View style={[styles.dockCover, { backgroundColor: theme.colors.background }]} />
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
            shadowColor: theme.colors.textPrimary,
          },
        ]}>
        <View style={styles.track}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.activePill,
              {
                width: pillWidth,
                transform: [{ translateX: pillX }],
                backgroundColor: theme.colors.accent,
                opacity: activeLayout ? 1 : 0,
              },
            ]}
          />

          {state.routes.map((route: any, index: number) => {
            const isFocused = state.index === index;
            const options = descriptors[route.key]?.options ?? {};
            const title = routeLabelByName[route.name] ?? String(options.title ?? route.name);
            const isLastTab = index === state.routes.length - 1;
            const labelProgressValue = getLabelProgress(route.key);
            const labelColor = labelProgressValue.interpolate({
              inputRange: [0, 1],
              outputRange: [theme.colors.textPrimary, '#FFFFFF'],
            });

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
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
                    paddingHorizontal: TAB_HORIZONTAL_PADDING,
                    marginRight: isLastTab ? 0 : 10,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}>
                <AnimatedText
                  style={[
                    theme.typography.button,
                    {
                      fontWeight: '600',
                      color: labelColor,
                    },
                  ]}>
                  {title}
                </AnimatedText>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            // Placeholder for the future mobile search surface.
          }}
          style={({ pressed }) => [
            styles.searchButton,
            {
              opacity: pressed ? 0.72 : 1,
            },
          ]}>
          <SymbolView
            name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
            size={16}
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
                }}>
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
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
    gap: 8,
  },
  track: {
    flexGrow: 0,
    flexShrink: 0,
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
