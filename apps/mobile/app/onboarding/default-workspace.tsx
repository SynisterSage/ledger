import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { Row } from '@/components/Row';
import { listWorkspaces } from '@/api/workspaces';
import { useLedgerTheme } from '@/theme';

export default function DefaultWorkspaceScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const workspaces = listWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(workspaces[1]?.id ?? workspaces[0]?.id);

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing['2xl'] }}>
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="screenTitle">Default workspace</AppText>
          <AppText variant="body">Choose where quick captures should go.</AppText>
        </View>

        <View>
          {workspaces.map((workspace) => (
            <Row
              key={workspace.id}
              title={workspace.name}
              subtitle={workspace.id === selectedWorkspaceId ? 'Selected' : 'Tap to select'}
              onPress={() => setSelectedWorkspaceId(workspace.id)}
            />
          ))}
        </View>

        <AppButton title="Continue" onPress={() => router.push('/onboarding/notifications')} />
      </View>
    </Screen>
  );
}
