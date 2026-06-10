import { AppDetailSheet } from '@/components/AppDetailSheet';
import type { MobileNotificationCenterItem } from '@/types/ledger';

import {
  getNotificationActions,
  getNotificationDetailBody,
  getNotificationDetailMetaRows,
  getNotificationSubtitle,
} from './notificationAdapters';

type NotificationDetailSheetProps = {
  visible: boolean;
  item: MobileNotificationCenterItem | null;
  showWorkspaceNames?: boolean;
  onClose: () => void;
  onAction: (actionId: string, item: MobileNotificationCenterItem) => void;
};

export function NotificationDetailSheet({
  visible,
  item,
  showWorkspaceNames = true,
  onClose,
  onAction,
}: NotificationDetailSheetProps) {
  if (!item) {
    return null;
  }

  return (
    <AppDetailSheet
      visible={visible}
      title={item.title}
      subtitle={getNotificationSubtitle(item, showWorkspaceNames)}
      meta={getNotificationDetailMetaRows(item)}
      body={getNotificationDetailBody(item)}
      actions={getNotificationActions(item)}
      onAction={(actionId) => onAction(actionId, item)}
      onClose={onClose}
    />
  );
}
