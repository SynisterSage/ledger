import { Image, StyleSheet, View } from 'react-native';

import { useLedgerTheme } from '@/theme';

export function AuthProductMockup({ height = 190 }: { height?: number }) {
  const theme = useLedgerTheme();
  const isDark = theme.scheme === 'dark';
  const mockupHeight = height * 1.34;
  const aspectRatio = isDark ? 720 / 1016 : 720 / 814;

  return (
    <View style={[styles.stage, { height }]} pointerEvents="none">
      <Image
        source={
          isDark
            ? require('../../assets/images/welcome-product-dark.png')
            : require('../../assets/images/welcome-product-light.png')
        }
        resizeMode="contain"
        accessibilityLabel="Ledger calendar preview"
        style={[styles.image, { height: mockupHeight, width: mockupHeight * aspectRatio }]}
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
    right: -76,
    top: -38,
  },
});
