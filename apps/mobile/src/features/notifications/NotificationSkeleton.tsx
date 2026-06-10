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
        paddingVertical: theme.spacing.md,
      }}>
      <View style={{ flex: 1, gap: theme.spacing.xs }}>
        <Skeleton width="60%" height={18} radius={8} />
        <Skeleton width="84%" height={14} radius={8} />
      </View>
      <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs, paddingTop: 2 }}>
        <Skeleton width={68} height={20} radius={999} />
        <Skeleton width={48} height={12} radius={8} />
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
