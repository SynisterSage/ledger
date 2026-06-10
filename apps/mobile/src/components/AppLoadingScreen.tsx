import { Image, StyleSheet, View } from 'react-native';

import SplashIcon from '../../assets/images/splash-icon.png';

import { useLedgerTheme } from '@/theme';

export function AppLoadingScreen() {
  const theme = useLedgerTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.background,
        },
      ]}>
      <Image source={SplashIcon} style={styles.icon} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 128,
    height: 128,
  },
});
