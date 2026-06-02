import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

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
  size?: 'md' | 'lg';
  containerStyle?: StyleProp<ViewStyle>;
};

export function AppButton({
  title,
  onPress,
  disabled,
  variant = 'primary',
  right,
  fullWidth = true,
  size = 'md',
  containerStyle,
}: AppButtonProps) {
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
        ? theme.colors.accent
        : 'transparent';

  const textColor =
    variant === 'primary'
      ? '#FFFFFF'
      : variant === 'secondary'
        ? theme.colors.accent
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
          borderRadius: size === 'lg' ? theme.radius.pill : theme.radius.control,
          opacity: disabled ? 0.5 : pressed ? 0.86 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        containerStyle,
      ]}>
      <View style={[styles.content, size === 'lg' ? styles.contentLarge : styles.contentMedium]}>
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
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  contentMedium: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  contentLarge: {
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
});
