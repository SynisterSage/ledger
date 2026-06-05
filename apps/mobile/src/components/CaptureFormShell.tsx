import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLedgerTheme } from '@/theme';

type CaptureFormShellProps = {
  children: ReactNode;
  footer: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

export function CaptureFormShell({ children, footer, contentStyle }: CaptureFormShellProps) {
  const theme = useLedgerTheme();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}>
      <View style={styles.container}>
        <ScrollView
          style={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: theme.spacing['2xl'],
              paddingBottom: insets.bottom + theme.spacing.lg + 48,
            },
            contentStyle,
          ]}>
          <View style={{ gap: theme.spacing.lg }}>{children}</View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: theme.colors.background,
              borderTopColor: theme.colors.borderSubtle,
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: insets.bottom - 30,
              paddingTop: 30,
            },
          ]}>
          {footer}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
