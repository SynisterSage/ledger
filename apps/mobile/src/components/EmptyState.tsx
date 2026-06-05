import type { ComponentProps, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

type IconName = ComponentProps<typeof SymbolView>['name'];

type EmptyStateProps = {
  iconName: IconName;
  title: string;
  description: string;
  style?: StyleProp<ViewStyle>;
  footer?: ReactNode;
};

export function EmptyState({ iconName, title, description, style, footer }: EmptyStateProps) {
  const theme = useLedgerTheme();

  return (
    <View
      style={[
        {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: theme.spacing.xl,
          gap: theme.spacing.lg,
        },
        style,
      ]}>
      <SymbolView
        name={iconName}
        size={28}
        weight="regular"
        tintColor={theme.colors.accent}
      />

      <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
        <AppText variant="bodyStrong" style={{ textAlign: 'center' }}>
          {title}
        </AppText>
        <AppText
          variant="meta"
          style={{
            textAlign: 'center',
            maxWidth: 280,
          }}>
          {description}
        </AppText>
      </View>

      {footer}
    </View>
  );
}
