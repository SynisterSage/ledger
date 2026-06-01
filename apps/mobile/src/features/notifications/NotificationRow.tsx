import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Row } from '@/components/Row';
import { WorkspaceLabel } from '@/components/WorkspaceLabel';
import { useLedgerTheme } from '@/theme';

type NotificationRowProps = {
  title: string;
  workspace: string;
  meta: string;
  actions: string[];
};

export function NotificationRow({ title, workspace, meta, actions }: NotificationRowProps) {
  const theme = useLedgerTheme();

  return (
    <View>
      <Row title={title} subtitle={meta} right={<WorkspaceLabel name={workspace} />} />
      <AppText variant="caption" style={{ marginTop: theme.spacing.xs }}>
        {actions.join('  •  ')}
      </AppText>
    </View>
  );
}
