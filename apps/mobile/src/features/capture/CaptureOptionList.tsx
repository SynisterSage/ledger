import { View } from 'react-native';

import type { CaptureOption } from '@/types/ledger';
import { useLedgerTheme } from '@/theme';

import { CaptureOptionRow } from './CaptureOptionRow';

type CaptureOptionListProps = {
  options: CaptureOption[];
  onSelect: (href: CaptureOption['href']) => void;
};

export function CaptureOptionList({ options, onSelect }: CaptureOptionListProps) {
  const theme = useLedgerTheme();

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {options.map((option) => (
        <CaptureOptionRow key={option.id} title={option.title} subtitle={option.subtitle} onPress={() => onSelect(option.href)} />
      ))}
    </View>
  );
}
