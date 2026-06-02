import { StyleSheet, View } from 'react-native';

import { useLedgerTheme } from '@/theme';

const MOBILE_TOP_FADE_HEIGHT = 10;

type MobileTopFadeProps = {
  topOffset: number;
};

export function MobileTopFade({ topOffset }: MobileTopFadeProps) {
  const theme = useLedgerTheme();

  return (
    <View pointerEvents="none" style={[styles.container, { top: topOffset, height: MOBILE_TOP_FADE_HEIGHT }]}>
      {Array.from({ length: MOBILE_TOP_FADE_HEIGHT }).map((_, index) => {
        const opacity = 1 - index / MOBILE_TOP_FADE_HEIGHT;

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

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
    zIndex: 2,
  },
});
