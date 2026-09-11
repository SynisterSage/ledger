import { StyleSheet, View } from 'react-native';

import LogoMark from '../../assets/images/logo.svg';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type AuthHeaderProps = {
  title: string;
  subtitle?: string;
  align?: 'center' | 'left';
};

export function AuthHeader({ title, subtitle, align = 'center' }: AuthHeaderProps) {
  const theme = useLedgerTheme();
  const isLeftAligned = align === 'left';

  return (
    <View style={[styles.container, isLeftAligned && styles.containerLeft]}>
      <View style={styles.brandRow}>
        <LogoMark width={34} height={34} />
        <AppText
          variant="title"
          style={{
            fontSize: 28,
            lineHeight: 32,
            fontWeight: '400',
            color: theme.colors.textPrimary,
          }}
        >
          Ledger
        </AppText>
      </View>

      <AppText variant="screenTitle" style={[styles.title, isLeftAligned && styles.titleLeft]}>
        {title}
      </AppText>
      {subtitle ? (
        <AppText
          variant="body"
          style={[
            styles.subtitle,
            { color: theme.colors.textSecondary },
            isLeftAligned && styles.subtitleLeft,
          ]}
        >
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  containerLeft: {
    alignItems: 'stretch',
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
  titleLeft: {
    marginTop: 40,
    textAlign: 'left',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: 8,
    textAlign: 'center',
  },
  subtitleLeft: {
    textAlign: 'left',
  },
});
