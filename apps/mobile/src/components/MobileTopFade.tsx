import { StyleSheet, View } from 'react-native';

import { useLedgerTheme } from '@/theme';

// Match the long, soft fade used above the floating dock so content can pass
// behind the top inset without creating a hard color edge.
const MOBILE_TOP_FADE_HEIGHT = 136;
const MOBILE_TOP_FADE_STEPS = 17;

type MobileTopFadeProps = {
  topOffset: number;
  opacityScale?: number;
  height?: number;
};

export function MobileTopFade({ topOffset, opacityScale = 1, height = MOBILE_TOP_FADE_HEIGHT }: MobileTopFadeProps) {
  const theme = useLedgerTheme();

  return (
    <View pointerEvents="none" style={[styles.container, { top: topOffset, height }]}>
      {Array.from({ length: MOBILE_TOP_FADE_STEPS }).map((_, index) => {
        const opacity = (1 - (index + 1) / MOBILE_TOP_FADE_STEPS) * opacityScale;

        return (
          <View
            key={index}
            style={{
              height: height / MOBILE_TOP_FADE_STEPS,
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
