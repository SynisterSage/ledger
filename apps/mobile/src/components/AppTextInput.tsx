import { forwardRef, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type AppTextInputProps = TextInputProps & {
  label?: string;
  labelVariant?: 'sectionTitle' | 'bodyStrong' | 'body' | 'meta' | 'caption';
  rightAccessory?: ReactNode;
};

export const AppTextInput = forwardRef<TextInput, AppTextInputProps>(function AppTextInput(
  { label, labelVariant = 'body', rightAccessory, style, multiline, ...props },
  ref
) {
  const theme = useLedgerTheme();
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.container}>
      {label ? (
        <AppText variant={labelVariant} style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <View style={styles.inputRow}>
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
              backgroundColor: 'transparent',
              borderBottomColor: isFocused ? theme.colors.textPrimary : theme.colors.borderSubtle,
              minHeight: multiline ? 92 : 44,
              paddingHorizontal: 0,
              paddingVertical: multiline ? theme.spacing.sm : theme.spacing.xs,
            },
            rightAccessory ? styles.inputWithAccessory : null,
            multiline && styles.multiline,
            style,
          ]}
        />
        {rightAccessory ? <View style={styles.accessory}>{rightAccessory}</View> : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  label: {
    marginBottom: 4,
  },
  inputRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderBottomWidth: 1,
    fontSize: 16,
    lineHeight: 22,
    backgroundColor: 'transparent',
  },
  inputWithAccessory: {
    paddingRight: 36,
  },
  accessory: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  multiline: {
    textAlignVertical: 'top',
  },
});
