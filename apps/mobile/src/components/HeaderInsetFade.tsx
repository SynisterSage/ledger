import { View, StyleSheet } from 'react-native';

type HeaderInsetFadeProps = {
  backgroundColor: string;
  height?: number;
};

export function HeaderInsetFade({ backgroundColor, height = 112 }: HeaderInsetFadeProps) {
  return (
    <View pointerEvents="none" style={[styles.wrap, { height }]}>
      {Array.from({ length: height }).map((_, index) => {
        const opacity = 1 - (index + 1) / height;
        return (
          <View
            key={index}
            style={{
              height: 1,
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
