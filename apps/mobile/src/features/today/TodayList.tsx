import { View } from 'react-native';

import { Section } from '@/components/Section';

import type { TodayGroup } from '@/types/ledger';
import { useLedgerTheme } from '@/theme';

import { TodayItem } from './TodayItem';

type TodayListProps = {
  groups: TodayGroup[];
};

export function TodayList({ groups }: TodayListProps) {
  const theme = useLedgerTheme();

  return (
    <View style={{ gap: theme.spacing['2xl'] }}>
      {groups.map((group) => (
        <Section key={group.workspace.id} title={group.workspace.name}>
          {group.items.map((item) => (
            <TodayItem key={item.id} title={item.title} meta={item.meta} />
          ))}
        </Section>
      ))}
    </View>
  );
}
