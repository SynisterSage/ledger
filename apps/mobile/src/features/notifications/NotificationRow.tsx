import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Row } from '@/components/Row';
import { WorkspaceLabel } from '@/components/WorkspaceLabel';
import { useLedgerTheme } from '@/theme';
import type { MobileNotificationCenterItem } from '@/types/ledger';

type NotificationRowProps = {
  item: MobileNotificationCenterItem;
  showWorkspaceName?: boolean;
};

function buildNotificationSubtitle(item: MobileNotificationCenterItem, showWorkspaceName: boolean) {
  const parts: string[] = [];

  if (showWorkspaceName && item.workspaceName) {
    parts.push(item.workspaceName);
  }

  if (item.context) {
    parts.push(item.context);
  }

  if (item.body) {
    parts.push(item.body);
  }

  if (item.scheduledFor) {
    const scheduledLabel = formatNotificationDateTime(item.scheduledFor);
    if (scheduledLabel) {
      parts.push(scheduledLabel);
    }
  }

  return parts.length ? parts.join(' · ') : item.title;
}

function formatNotificationDateTime(dateLike: string) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function NotificationRow({ item, showWorkspaceName = true }: NotificationRowProps) {
  const theme = useLedgerTheme();

  return (
    <View>
      <Row
        title={item.title}
        subtitle={buildNotificationSubtitle(item, showWorkspaceName)}
        right={showWorkspaceName && item.workspaceName ? <WorkspaceLabel name={item.workspaceName} /> : null}
      />
      <AppText variant="caption" style={{ marginTop: theme.spacing.xs }}>
        {item.actions.join('  •  ')}
      </AppText>
    </View>
  );
}
