import { View, StyleSheet } from 'react-native';

type HeaderInsetFadeProps = {
  backgroundColor: string;
  height?: number;
};

const FADE_STEPS = 17;

export function HeaderInsetFade({ backgroundColor, height = 112 }: HeaderInsetFadeProps) {
  return (
    <View pointerEvents="none" style={[styles.wrap, { height }]}>
      {Array.from({ length: FADE_STEPS }).map((_, index) => {
        const opacity = 1 - (index + 1) / FADE_STEPS;
        return (
          <View
            key={index}
            style={{
              height: height / FADE_STEPS,
              backgroundColor,
              opacity: Math.max(0, opacity),
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    overflow: 'hidden',
  },
});
