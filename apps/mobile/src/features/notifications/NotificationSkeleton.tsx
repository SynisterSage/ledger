import { View } from 'react-native';

import { Section } from '@/components/Section';
import { Skeleton } from '@/components/Skeleton';
import { useLedgerTheme } from '@/theme';

function SkeletonRow() {
  const theme = useLedgerTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      }}>
      <View style={{ flex: 1, gap: theme.spacing.xs }}>
        <Skeleton width="58%" height={18} radius={8} />
        <Skeleton width="78%" height={14} radius={8} />
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
          <Skeleton width={52} height={20} radius={999} />
          <Skeleton width={58} height={20} radius={999} />
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs, paddingTop: 2 }}>
        <Skeleton width={64} height={20} radius={999} />
        <Skeleton width={42} height={12} radius={8} />
      </View>
    </View>
  );
}

export function NotificationSkeleton() {
  const theme = useLedgerTheme();

  return (
    <View style={{ gap: theme.spacing['3xl'] }}>
      <Section title="Active">
        <SkeletonRow />
      </Section>

      <Section title="Earlier">
        <View style={{ gap: theme.spacing.sm }}>
          <SkeletonRow />
          <SkeletonRow />
        </View>
      </Section>
    </View>
  );
}
