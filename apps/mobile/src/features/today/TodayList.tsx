import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Section } from '@/components/Section';
import { useLedgerTheme } from '@/theme';

import type {
  MobileCaptureSummary,
  MobileTodayInteractionItem,
  MobileTodayItem,
  MobileUpcomingItem,
} from '@/types/ledger';

import { TodayItem } from './TodayItem';

type TodayListProps = {
  upcoming: MobileUpcomingItem[];
  today: MobileTodayItem[];
  captures: MobileCaptureSummary;
  showWorkspaceNames?: boolean;
  onItemPress?: (item: MobileTodayInteractionItem) => void;
  onItemLongPress?: (item: MobileTodayInteractionItem) => void;
};

function formatUpcomingLabel(item: MobileUpcomingItem) {
  if (!item.startsAt) {
    return item.timeLabel ?? 'Scheduled';
  }

  const startDate = new Date(item.startsAt);
  if (Number.isNaN(startDate.getTime())) {
    return item.timeLabel ?? 'Scheduled';
  }

  const diffMs = startDate.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (absMs < hour) {
    const minutes = Math.max(1, Math.round(absMs / minute));
    return `${minutes}m`;
  }

  if (absMs < day) {
    const hours = Math.max(1, Math.round(absMs / hour));
    return `${hours}h`;
  }

  if (absMs < week) {
    const days = Math.max(1, Math.round(absMs / day));
    return days === 1 ? '1 day' : `${days} days`;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(startDate);
}

function formatUpcomingTime(item: MobileUpcomingItem) {
  if (item.timeLabel) {
    return item.timeLabel;
  }

  if (!item.startsAt) {
    return null;
  }

  const startDate = new Date(item.startsAt);
  if (Number.isNaN(startDate.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(startDate);
}

function buildTodaySubtitle(item: MobileTodayItem, showWorkspaceNames: boolean) {
  if (item.type === 'focus') {
    const parts = [] as string[];
    if (showWorkspaceNames && item.workspaceName) {
      parts.push(item.workspaceName);
    }
    parts.push('Focus');
    parts.push(item.urgency ?? 'Low');
    return parts.join(' · ');
  }

  const parts: string[] = [];

  if (showWorkspaceNames && item.workspaceName) {
    parts.push(item.workspaceName);
  }

  if (item.type === 'project_action') {
    parts.push('Project');
    if (item.status === 'overdue') {
      parts.push('Overdue');
    } else if (item.timeLabel) {
      parts.push(item.timeLabel);
    } else {
      parts.push(item.dueLabel);
    }
  } else if (item.type === 'event') {
    parts.push('Event');
    if (item.timeLabel) {
      parts.push(item.timeLabel);
    }
  } else if (item.meta && item.meta !== item.dueLabel) {
    parts.push(item.meta);
  } else if (item.meta) {
    parts.push(item.meta);
  }

  if (item.type !== 'project_action' && item.type !== 'event' && item.timeLabel) {
    parts.push(item.timeLabel);
  } else if (item.dueLabel && !item.timeLabel) {
    const shouldAddDueLabel =
      item.meta !== item.dueLabel ||
      !item.meta;
    if (shouldAddDueLabel) {
      parts.push(item.dueLabel);
    }
  }

  const uniqueParts: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (uniqueParts[uniqueParts.length - 1] === part) continue;
    uniqueParts.push(part);
  }

  return uniqueParts.length ? uniqueParts.join(' · ') : null;
}

export function TodayList({
  upcoming,
  today,
  captures,
  showWorkspaceNames = true,
  onItemPress,
  onItemLongPress,
}: TodayListProps) {
  const theme = useLedgerTheme();
  const hasUpcoming = upcoming.length > 0;
  const hasToday = today.length > 0;
  const hasCaptures = captures.count > 0;

  return (
    <View style={{ gap: theme.spacing['3xl'] }}>
      <Section title="Upcoming">
        {hasUpcoming ? (
          upcoming.map((item) => (
            <TodayItem
              key={item.id}
              title={item.title}
              subtitle={
                [
                  showWorkspaceNames ? item.workspaceName : null,
                  `${formatUpcomingLabel(item)}${formatUpcomingTime(item) ? ` · ${formatUpcomingTime(item)}` : ''}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              }
              onPress={() => onItemPress?.(item)}
              onLongPress={() => onItemLongPress?.(item)}
            />
          ))
        ) : (
          <AppText variant="meta">Nothing upcoming.</AppText>
        )}
      </Section>

      <Section title="Today">
        {hasToday ? (
          today.map((item) => (
            <TodayItem
              key={item.id}
              title={item.title}
              subtitle={buildTodaySubtitle(item, showWorkspaceNames)}
              onPress={() => onItemPress?.(item)}
              onLongPress={() => onItemLongPress?.(item)}
            />
          ))
        ) : (
          <AppText variant="meta">Nothing due today.</AppText>
        )}
      </Section>

      <Section title="Captures">
        {hasCaptures ? (
          <View style={{ gap: theme.spacing.xs }}>
            {captures.items.map((item) => (
              <TodayItem
                key={item.id}
                title={item.title}
                subtitle={
                  showWorkspaceNames && item.workspaceName
                    ? [item.workspaceName, item.source].filter(Boolean).join(' · ')
                    : item.source
                }
                onPress={() => onItemPress?.(item)}
                onLongPress={() => onItemLongPress?.(item)}
              />
            ))}
          </View>
        ) : (
          <AppText variant="meta">No captures waiting.</AppText>
        )}
      </Section>
    </View>
  );
}
