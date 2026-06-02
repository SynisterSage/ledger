import { StyleSheet, View } from 'react-native';

import { useLedgerTheme } from '@/theme';

export function BrandMark() {
  const theme = useLedgerTheme();

  return (
    <View style={[styles.mark, { backgroundColor: theme.colors.accent }]}>
      <View style={[styles.quadrant, styles.topLeft, { backgroundColor: theme.colors.accent }]} />
      <View style={[styles.quadrant, styles.topRight, { backgroundColor: '#FF8A4C' }]} />
      <View style={[styles.quadrant, styles.bottomLeft, { backgroundColor: '#FFB347' }]} />
      <View style={[styles.quadrant, styles.bottomRight, { backgroundColor: theme.colors.accentSoft }]} />
      <View style={styles.diagonalCut} />
      <View style={styles.centerCut} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    width: 48,
    height: 48,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  quadrant: {
    position: 'absolute',
    width: '50%',
    height: '50%',
  },
  topLeft: {
    left: 0,
    top: 0,
  },
  topRight: {
    right: 0,
    top: 0,
  },
  bottomLeft: {
    left: 0,
    bottom: 0,
  },
  bottomRight: {
    right: 0,
    bottom: 0,
  },
  diagonalCut: {
    position: 'absolute',
    width: '160%',
    height: 10,
    left: '-28%',
    top: '46%',
    backgroundColor: '#FFF7F0',
    transform: [{ rotate: '-45deg' }],
  },
  centerCut: {
    position: 'absolute',
    width: 10,
    height: '160%',
    left: '46%',
    top: '-28%',
    backgroundColor: '#FFF7F0',
    transform: [{ rotate: '-45deg' }],
  },
});
