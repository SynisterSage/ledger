import type { ComponentProps } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

type IconName = ComponentProps<typeof SymbolView>['name'];

export type MobileEmptyStateKind =
  | 'first-use'
  | 'no-results'
  | 'informational'
  | 'permission'
  | 'unavailable'
  | 'error';

export type MobileEmptyStateAction = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
  variant?: 'primary' | 'secondary' | 'link';
};

type EmptyStateProps = {
  iconName: IconName;
  title: string;
  description: string;
  kind?: MobileEmptyStateKind;
  primaryAction?: MobileEmptyStateAction;
  secondaryAction?: MobileEmptyStateAction;
  density?: 'regular' | 'compact';
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({
  iconName,
  title,
  description,
  kind = 'informational',
  primaryAction,
  secondaryAction,
  density = 'regular',
  style,
}: EmptyStateProps) {
  const theme = useLedgerTheme();
  const compact = density === 'compact';
  const actions = [primaryAction, secondaryAction].filter(Boolean) as MobileEmptyStateAction[];

  const renderAction = (action: MobileEmptyStateAction, index: number) => (
    <AppButton
      key={`${action.label}-${index}`}
      title={action.label}
      onPress={action.onPress}
      accessibilityLabel={action.accessibilityLabel}
      testID={action.testID}
      variant={action.variant === 'link' ? 'ghost' : action.variant ?? (action === primaryAction ? 'primary' : 'secondary')}
      fullWidth={false}
      size={compact ? 'md' : 'lg'}
      containerStyle={{ alignSelf: 'center' }}
    />
  );

  return (
    <View
      testID={`empty-state-${kind}`}
      style={[
        styles.container,
        styles.regularContainer,
        {
          gap: compact ? theme.spacing.md : theme.spacing.lg,
          paddingHorizontal: compact ? theme.spacing.lg : theme.spacing.xl,
          paddingVertical: compact ? theme.spacing.lg : undefined,
        },
        style,
        styles.centered,
      ]}>
      <SymbolView
        name={iconName}
        size={compact ? 22 : 28}
        weight="regular"
        tintColor={theme.colors.accent}
      />

      <View
        accessible
        accessibilityLabel={`${title}. ${description}`}
        accessibilityRole="summary"
        style={[styles.copy, { gap: theme.spacing.xs }]}
      >
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

      {actions.length ? (
        <View style={[styles.actions, { gap: theme.spacing.sm }]}>{actions.map(renderAction)}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  regularContainer: {
    flex: 1,
    minHeight: 220,
  },
  copy: {
    alignItems: 'center',
  },
  actions: {
    alignItems: 'center',
    width: '100%',
  },
});
