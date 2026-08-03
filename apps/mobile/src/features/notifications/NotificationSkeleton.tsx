import { View } from 'react-native';

import { Skeleton } from '@/components/Skeleton';
import { useLedgerTheme } from '@/theme';

function SkeletonRow() {
  const theme = useLedgerTheme();
  return (
    <View style={styles.row}>
      <View style={styles.iconColumn}>
        <Skeleton width={22} height={22} radius={7} />
      </View>
      <View style={[styles.content, { borderBottomColor: theme.colors.borderSubtle }]}>
        <View style={styles.titleLine}>
          <Skeleton height={16} radius={5} style={styles.titleSkeleton} />
          <Skeleton width={24} height={12} radius={5} />
        </View>
        <Skeleton width="72%" height={12} radius={5} />
      </View>
    </View>
  );
}

export function NotificationSkeleton() {
  const theme = useLedgerTheme();
  return (
    <View style={[styles.container, { paddingTop: theme.spacing.md }]}>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </View>
  );
}

const styles = {
  container: { gap: 0 },
  row: { minHeight: 68, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, paddingVertical: 8 },
  iconColumn: { width: 24, alignItems: 'center' as const, paddingTop: 2 },
  content: { minWidth: 0, flex: 1, gap: 3, paddingBottom: 9, borderBottomWidth: 0.5 },
  titleLine: { minWidth: 0, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8 },
  titleSkeleton: { flex: 1 },
};
