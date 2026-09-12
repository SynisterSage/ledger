import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useLedgerTheme } from '@/theme';

export function AuthProductMockup({ height = 190, contained = false, bleed = false }: { height?: number; contained?: boolean; bleed?: boolean }) {
  const theme = useLedgerTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isDark = theme.scheme === 'dark';
  // The current product exports are square transparent compositions, with the
  // angled phone already positioned inside the canvas.
  const aspectRatio = 1;
  const mockupHeight = contained
    ? Math.min(height * 1.1, (windowWidth - 40) / aspectRatio)
    : height * 1.34;

  return (
    <View
      style={[styles.stage, { height, width: bleed ? windowWidth : '100%' }]}
      pointerEvents="none"
    >
      <Image
        source={
          isDark
            ? require('../../../../public/iphone_4x_dark.webp')
            : require('../../../../public/group_4x_light.webp')
        }
        resizeMode="contain"
        accessibilityLabel="Ledger calendar preview"
        style={[styles.image, contained ? styles.containedImage : bleed ? styles.bleedImage : styles.clippedImage, { height: mockupHeight, width: mockupHeight * aspectRatio }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: '100%',
    overflow: 'hidden',
    alignSelf: 'center',
  },
  image: {
    position: 'absolute',
  },
  clippedImage: {
    right: -76,
    top: -38,
  },
  bleedImage: {
    right: -260,
    top: -36,
  },
  containedImage: {
    right: 0,
    bottom: 0,
    top: 0,
  },
});
