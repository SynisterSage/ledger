import { forwardRef, useState } from 'react';
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
  const [isFocused, setIsFocused] = useState(false);

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
        onFocus={(event) => {
          setIsFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setIsFocused(false);
          props.onBlur?.(event);
        }}
        placeholderTextColor={theme.colors.placeholder}
        style={[
          styles.input,
          {
            color: theme.colors.textPrimary,
            borderColor: theme.colors.borderSubtle,
            backgroundColor: isFocused ? theme.colors.surface : theme.colors.background,
            minHeight: multiline ? 92 : 44,
            paddingHorizontal: 0,
            paddingVertical: multiline ? theme.spacing.sm : theme.spacing.xs,
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
    marginBottom: 8,
  },
  input: {
    borderBottomWidth: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  multiline: {
    textAlignVertical: 'top',
  },
});
