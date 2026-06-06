import { View } from 'react-native';

import { Section } from '@/components/Section';
import { Skeleton } from '@/components/Skeleton';
import { useLedgerTheme } from '@/theme';

function SkeletonRow() {
  const theme = useLedgerTheme();

  return (
    <View style={{ gap: theme.spacing.xs, paddingVertical: theme.spacing.md }}>
      <Skeleton width="58%" height={18} radius={8} />
      <Skeleton width="36%" height={14} radius={8} />
    </View>
  );
}

export function TodaySkeleton() {
  const theme = useLedgerTheme();

  return (
    <View style={{ gap: theme.spacing['3xl'] }}>
      <Section title="Upcoming">
        <SkeletonRow />
        <SkeletonRow />
      </Section>

      <Section title="Today">
        <SkeletonRow />
        <SkeletonRow />
      </Section>

      <Section title="Captures">
        <View style={{ gap: theme.spacing.sm }}>
          <Skeleton width="44%" height={18} radius={8} />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      </Section>

      <Section title="Notes">
        <SkeletonRow />
        <SkeletonRow />
      </Section>
    </View>
  );
}
