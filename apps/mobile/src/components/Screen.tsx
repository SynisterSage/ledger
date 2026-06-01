import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLedgerTheme } from '@/theme';

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
};

export function Screen({ children, scroll = false, contentStyle }: ScreenProps) {
  const theme = useLedgerTheme();

  const containerStyle = [
    styles.container,
    { backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing.screenX, paddingTop: theme.spacing.screenY },
    contentStyle,
  ];

  if (scroll) {
    return (
      <SafeAreaView style={containerStyle} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: theme.spacing['3xl'] }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return <SafeAreaView style={containerStyle}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
