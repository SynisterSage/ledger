import { StyleSheet, View } from 'react-native';

import LogoMark from '../../assets/images/logo.svg';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type AuthHeaderProps = {
  title: string;
};

export function AuthHeader({ title }: AuthHeaderProps) {
  const theme = useLedgerTheme();

  return (
    <View style={styles.container}>
      <View style={styles.brandRow}>
        <LogoMark width={34} height={34} />
        <AppText
          variant="title"
          style={{
            fontSize: 28,
            lineHeight: 32,
            fontWeight: '400',
            color: theme.colors.textPrimary,
          }}>
          Ledger
        </AppText>
      </View>

      <AppText variant="screenTitle" style={styles.title}>
        {title}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    marginTop: 56,
    textAlign: 'center',
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '400',
    letterSpacing: -0.6,
  },
});
