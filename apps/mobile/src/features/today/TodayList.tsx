import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Section } from '@/components/Section';
import { useLedgerTheme } from '@/theme';

import type {
  MobileCaptureSummary,
  MobileTodayItem,
  MobileUpcomingItem,
} from '@/types/ledger';

import { TodayItem } from './TodayItem';

type TodayListProps = {
  upcoming: MobileUpcomingItem[];
  today: MobileTodayItem[];
  captures: MobileCaptureSummary;
  showWorkspaceNames?: boolean;
};

export function TodayList({
  upcoming,
  today,
  captures,
  showWorkspaceNames = true,
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
                showWorkspaceNames && item.workspaceName
                  ? [item.workspaceName, item.timeLabel].filter(Boolean).join(' · ')
                  : item.timeLabel ?? 'Scheduled'
              }
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
              subtitle={
                showWorkspaceNames && item.workspaceName
                  ? [item.workspaceName, item.meta].filter(Boolean).join(' · ')
                  : [item.meta, item.dueLabel].filter(Boolean).join(' · ')
              }
            />
          ))
        ) : (
          <AppText variant="meta">Nothing due today.</AppText>
        )}
      </Section>

      <Section title="Captures">
        {hasCaptures ? (
          <View style={{ gap: theme.spacing.xs }}>
            <TodayItem
              title={`${captures.count} capture${captures.count === 1 ? '' : 's'} waiting`}
              subtitle="Waiting to be sorted"
            />
            {captures.items.map((item) => (
              <TodayItem
                key={item.id}
                title={item.title}
                subtitle={
                  showWorkspaceNames && item.workspaceName
                    ? [item.workspaceName, item.source].filter(Boolean).join(' · ')
                    : item.source
                }
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
