import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useEffect, useRef, useState } from 'react';

import { useLedgerTheme } from '@/theme';

export function AuthProductMockup({ height = 190, contained = false, bleed = false }: { height?: number; contained?: boolean; bleed?: boolean }) {
  const theme = useLedgerTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isDark = theme.scheme === 'dark';
  const [isLoaded, setIsLoaded] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.985)).current;
  // The current product exports are square transparent compositions, with the
  // angled phone already positioned inside the canvas.
  const aspectRatio = 1;
  const mockupHeight = contained
    ? Math.min(height * 1.1, (windowWidth - 40) / aspectRatio)
    : height * 1.34;

  useEffect(() => {
    setIsLoaded(false);
    opacity.stopAnimation();
    scale.stopAnimation();
    opacity.setValue(0);
    scale.setValue(0.985);
  }, [isDark, opacity, scale]);

  const revealImage = () => {
    if (isLoaded) return;
    setIsLoaded(true);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <View
      style={[styles.stage, { height, width: bleed ? windowWidth : '100%' }]}
      pointerEvents="none"
    >
      <Animated.Image
        source={
          isDark
            ? require('../../assets/images/auth-product-dark.png')
            : require('../../assets/images/auth-product-light.png')
        }
        resizeMode="contain"
        accessibilityLabel="Ledger calendar preview"
        onLoad={revealImage}
        onError={revealImage}
        style={[
          styles.image,
          contained ? styles.containedImage : bleed ? styles.bleedImage : styles.clippedImage,
          { height: mockupHeight, width: mockupHeight * aspectRatio, opacity, transform: [{ scale }] },
        ]}
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
