import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type AppButtonVariant = 'primary' | 'secondary' | 'ghost';

type AppButtonProps = {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: AppButtonVariant;
  right?: ReactNode;
  fullWidth?: boolean;
};

export function AppButton({ title, onPress, disabled, variant = 'primary', right, fullWidth = true }: AppButtonProps) {
  const theme = useLedgerTheme();

  const backgroundColor =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'secondary'
        ? theme.colors.surface
        : 'transparent';

  const borderColor =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'secondary'
        ? theme.colors.borderStrong
        : 'transparent';

  const textColor =
    variant === 'primary'
      ? '#FFFFFF'
      : variant === 'secondary'
        ? theme.colors.textPrimary
        : theme.colors.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderColor,
          borderRadius: theme.radius.control,
          opacity: disabled ? 0.5 : pressed ? 0.86 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
      ]}>
      <View style={styles.content}>
        <AppText variant="button" style={{ color: textColor }}>
          {title}
        </AppText>
        {right}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
  },
  content: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
});
