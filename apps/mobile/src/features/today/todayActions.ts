import type { MobileTodayInteractionItem } from '@/types/ledger';

export type TodayItemAction = {
  id: string;
  label: string;
  role?: 'default' | 'destructive';
  disabled?: boolean;
  perform: () => Promise<void> | void;
};

export type TodayActionContext = {
  onAction: (actionId: string, item: MobileTodayInteractionItem) => Promise<void> | void;
  onOpen?: (item: MobileTodayInteractionItem) => void;
  includeDestructive?: boolean;
};

function action(
  id: string,
  label: string,
  item: MobileTodayInteractionItem,
  context: TodayActionContext,
  role?: TodayItemAction['role'],
): TodayItemAction {
  return {
    id,
    label,
    role,
    perform: () => context.onAction(id, item),
  };
}

export function getTodayItemActions(
  item: MobileTodayInteractionItem,
  context: TodayActionContext,
): TodayItemAction[] {
  const open = context.onOpen
    ? [{ id: 'open', label: 'Open', perform: () => context.onOpen?.(item) }]
    : [];
  const destructive = context.includeDestructive === false;

  if ('source' in item) {
    return [
      ...open,
      action('convert_task', 'Convert to task', item, context),
      action('convert_reminder', 'Convert to reminder', item, context),
      action('convert_note', 'Convert to note', item, context),
      action('convert_event', 'Convert to event', item, context),
      action('archive', 'Archive', item, context),
      ...(destructive ? [] : [action('delete', 'Delete', item, context, 'destructive')]),
    ];
  }

  switch (item.type) {
    case 'focus':
      return [
        ...open,
        action('mark_done', 'Mark as done', item, context),
        action('move_tomorrow', 'Move to tomorrow', item, context),
        action('remove_focus', 'Remove from Focus', item, context),
        action('edit', 'Edit', item, context),
        ...(destructive ? [] : [action('delete', 'Delete', item, context, 'destructive')]),
      ];
    case 'note':
      return [
        ...open,
        action('add_follow_up', 'Add follow-up', item, context),
        action('edit', 'Edit', item, context),
        ...(destructive ? [] : [action('delete', 'Delete', item, context, 'destructive')]),
      ];
    case 'event':
      return [
        ...open,
        action('complete', 'Mark as done', item, context),
        action('add_note', 'Add note', item, context),
        action('create_follow_up', 'Create follow-up', item, context),
        action('reschedule', 'Reschedule', item, context),
        ...(destructive
          ? []
          : [
              action('dismiss_today', 'Dismiss from Today', item, context, 'destructive'),
              action('delete', 'Delete', item, context, 'destructive'),
            ]),
      ];
    case 'reminder':
      return [
        ...open,
        action('complete', 'Mark as done', item, context),
        action('snooze_hour', 'Snooze 1 hour', item, context),
        action('snooze_tomorrow', 'Snooze tomorrow', item, context),
        action('edit', 'Edit', item, context),
        ...(destructive ? [] : [action('delete', 'Delete', item, context, 'destructive')]),
      ];
    case 'task':
      return [
        ...open,
        action('complete', 'Mark as done', item, context),
        action('move_tomorrow', 'Move to tomorrow', item, context),
        action('add_focus', 'Add to focus', item, context),
        action('edit', 'Edit', item, context),
        ...(destructive ? [] : [action('delete', 'Delete', item, context, 'destructive')]),
      ];
    case 'project_action':
      return [
        ...open,
        action('complete', 'Mark as done', item, context),
        action('move_tomorrow', 'Move to tomorrow', item, context),
        action('open_project', 'Open project', item, context),
        action('edit', 'Edit', item, context),
        ...(destructive ? [] : [action('delete', 'Delete', item, context, 'destructive')]),
      ];
    case 'project':
      return [
        ...open,
        action('open_project', 'Open project', item, context),
        action('edit', 'Edit', item, context),
        ...(destructive ? [] : [action('delete', 'Delete', item, context, 'destructive')]),
      ];
    default:
      return open;
  }
}

export function getTodayItemSwipeActions(item: MobileTodayInteractionItem) {
  if ('source' in item) {
    return { right: 'archive', left: null } as const;
  }

  switch (item.type) {
    case 'focus':
      return { right: 'mark_done', left: 'remove_focus' } as const;
    case 'task':
    case 'project_action':
      return { right: 'complete', left: 'move_tomorrow' } as const;
    case 'reminder':
      return { right: 'complete', left: 'snooze_hour' } as const;
    case 'event':
      return { right: 'complete', left: 'reschedule' } as const;
    default:
      return { right: null, left: null } as const;
  }
}
