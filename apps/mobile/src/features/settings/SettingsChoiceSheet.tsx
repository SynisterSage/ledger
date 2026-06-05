import type { ReactNode } from 'react';
import { SymbolView } from 'expo-symbols';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { Row } from '@/components/Row';
import { useLedgerTheme } from '@/theme';

export type SettingsChoiceOption = {
  value: string;
  title: string;
  subtitle?: string;
};

type SettingsChoiceSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: SettingsChoiceOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  footer?: ReactNode;
};

export function SettingsChoiceSheet({
  visible,
  title,
  subtitle,
  options,
  selectedValue,
  onSelect,
  onClose,
  footer,
}: SettingsChoiceSheetProps) {
  const theme = useLedgerTheme();

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      snapPoints={['42%', '62%']}
      initialSnapPointIndex={1}
      dragCloseThreshold={72}
      dragCloseVelocityThreshold={0.65}
      dragCloseSnapMargin={12}>
      {subtitle ? (
        <AppText variant="meta" style={{ marginBottom: theme.spacing.xs }}>
          {subtitle}
        </AppText>
      ) : null}
      {options.map((option) => {
        const selected = option.value === selectedValue;
        return (
          <Row
            key={option.value}
            title={option.title}
            subtitle={option.subtitle}
            onPress={() => {
              onSelect(option.value);
              onClose();
            }}
            right={
              selected ? (
                <SymbolView name="checkmark" size={15} weight="regular" tintColor={theme.colors.accent} />
              ) : null
            }
          />
        );
      })}
      {footer ? <>{footer}</> : null}
    </AppBottomSheet>
  );
}
