import { StyleSheet, View } from 'react-native';

import LogoMark from '../../assets/images/logo-white.svg';

import { useLedgerTheme } from '@/theme';

export function AppLoadingScreen() {
  const theme = useLedgerTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.accent,
        },
      ]}>
      <LogoMark width={48} height={48} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
