import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type AppTextInputProps = TextInputProps & {
  label?: string;
};

export const AppTextInput = forwardRef<TextInput, AppTextInputProps>(function AppTextInput(
  { label, style, multiline, ...props },
  ref
) {
  const theme = useLedgerTheme();

  return (
    <View style={styles.container}>
      {label ? (
        <AppText variant="meta" style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <TextInput
        ref={ref}
        {...props}
        multiline={multiline}
        placeholderTextColor={theme.colors.placeholder}
        style={[
          styles.input,
          {
            color: theme.colors.textPrimary,
            backgroundColor: theme.colors.inputBackground,
            borderColor: theme.colors.borderSubtle,
            borderRadius: theme.radius.control,
            minHeight: multiline ? theme.spacing['2xl'] * 5 : 48,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: multiline ? theme.spacing.lg : theme.spacing.md,
          },
          multiline && styles.multiline,
          style,
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  label: {
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  multiline: {
    textAlignVertical: 'top',
  },
});
