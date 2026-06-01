import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { WorkspaceLabel } from '@/components/WorkspaceLabel';
import { TodayList } from '@/features/today/TodayList';
import { listTodayGroups } from '@/api/today';
import { useLedgerTheme } from '@/theme';

export default function TodayScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const groups = listTodayGroups();

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing['2xl'] }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: theme.spacing.lg,
          }}>
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <AppText variant="screenTitle">Today</AppText>
            <WorkspaceLabel name="All Workspaces" />
          </View>
          <AppButton title="Settings" variant="ghost" fullWidth={false} onPress={() => router.push('/settings')} />
        </View>

        <TodayList groups={groups} />
      </View>
    </Screen>
  );
}
