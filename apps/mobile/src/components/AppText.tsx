import type { ReactNode } from 'react';
import { Text, type TextProps, StyleSheet } from 'react-native';

import { useLedgerTheme } from '@/theme';

type Variant = 'screenTitle' | 'title' | 'sectionTitle' | 'body' | 'bodyStrong' | 'meta' | 'caption' | 'button';

type AppTextProps = TextProps & {
  variant?: Variant;
  children: ReactNode;
};

const toneByVariant: Record<Variant, 'textPrimary' | 'textSecondary' | 'textMuted'> = {
  screenTitle: 'textPrimary',
  title: 'textPrimary',
  sectionTitle: 'textPrimary',
  body: 'textPrimary',
  bodyStrong: 'textPrimary',
  meta: 'textSecondary',
  caption: 'textMuted',
  button: 'textPrimary',
};

export function AppText({ variant = 'body', style, children, ...props }: AppTextProps) {
  const theme = useLedgerTheme();

  return (
    <Text
      {...props}
      style={[
        styles.base,
        theme.typography[variant],
        { color: theme.colors[toneByVariant[variant]] },
        style,
      ]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
  },
});
