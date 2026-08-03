import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type {
  MobileCaptureSummary,
  MobileTodayInteractionItem,
  MobileTodayItem,
  MobileTodayNoteItem,
  MobileTodayProject,
  MobileTodayMention,
  MobileTodayTeamActivity,
  MobileUpcomingItem,
} from '@/types/ledger';

import { TodayItemRow, type TodayItemStatus, type TodayItemType } from './TodayItemRow';
import { TodaySection } from './TodaySection';
import { getTodayItemActions, getTodayItemSwipeActions } from './todayActions';

type TodaySectionKey =
  | 'focus'
  | 'next-up'
  | 'attention'
  | 'today'
  | 'projects'
  | 'intake'
  | 'notes'
  | 'team-activity';

type TodayListProps = {
  upcoming: MobileUpcomingItem[];
  today: MobileTodayItem[];
  captures: MobileCaptureSummary;
  projects?: MobileTodayProject[];
  notes?: MobileTodayNoteItem[];
  mentions?: MobileTodayMention[];
  teamActivity?: MobileTodayTeamActivity[];
  isTeamWorkspace?: boolean;
  showWorkspaceNames?: boolean;
  collapsedSections?: Partial<Record<TodaySectionKey, boolean>>;
  onToggleSection?: (section: TodaySectionKey) => void;
  onSectionLayout?: (section: TodaySectionKey, y: number) => void;
  onItemPress?: (item: MobileTodayInteractionItem) => void;
  onItemLongPress?: (item: MobileTodayInteractionItem) => void;
  onItemAction?: (actionId: string, item: MobileTodayInteractionItem) => void;
  onItemComplete?: (item: MobileTodayInteractionItem) => void;
  focusOrder?: string[];
  onViewDay?: () => void;
  onAddFocus?: () => void;
  onQuickNote?: () => void;
  onTeamItemPress?: (sourceType: 'mention' | 'team_activity', sourceId: string | null) => void;
  surfaceSection?: 'today' | 'attention' | 'next-up' | null;
};

function formatDateTimeLabel(dateLike: string | null | undefined) {
  if (!dateLike) return null;
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatTime(dateLike: string | null | undefined, fallback: string | null = null) {
  if (!dateLike) return fallback;
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatShortDate(dateLike: string | null | undefined) {
  if (!dateLike) return null;
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}

function compactMetadata(values: Array<string | null | undefined>) {
  return values.filter(Boolean).slice(0, 3) as string[];
}

function isSameLocalDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function isTomorrowLocalDay(date: Date, now: Date) {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isSameLocalDay(date, tomorrow);
}

function isCurrentEvent(item: MobileTodayInteractionItem, now = new Date()) {
  if ('source' in item || item.type !== 'event' || !item.startsAt) return false;
  const start = new Date(item.startsAt);
  const end = item.endsAt ? new Date(item.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
  return start.getTime() <= now.getTime() && end.getTime() > now.getTime();
}

function durationLabel(item: MobileUpcomingItem | MobileTodayItem) {
  if (!item.startsAt || !item.endsAt) return null;
  const minutes = Math.max(0, Math.round((new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60000));
  if (!minutes) return null;
  return minutes >= 60 ? `${Math.round(minutes / 60)} hr` : `${minutes} min`;
}

function startsInLabel(item: MobileUpcomingItem | MobileTodayItem, now = new Date()) {
  if (!item.startsAt) return null;
  const minutes = Math.round((new Date(item.startsAt).getTime() - now.getTime()) / 60000);
  if (minutes > 0 && minutes <= 60) return `In ${minutes} min`;
  if (minutes <= 0 && isCurrentEvent(item, now)) return `NOW · Ends ${formatTime(item.endsAt) ?? 'soon'}`;
  return formatTime(item.startsAt, item.timeLabel);
}

function itemType(item: MobileTodayInteractionItem): TodayItemType {
  if ('source' in item) return 'intake';
  if (item.type === 'note') return 'note';
  if (item.type === 'deadline') return 'project';
  if (item.type === 'focus') return 'task';
  return item.type;
}

function rowStatus(item: MobileTodayInteractionItem): TodayItemStatus {
  if ('source' in item || item.type === 'note' || item.type === 'deadline') return 'default';
  if (item.type === 'focus') return 'focused';
  if (item.status === 'overdue') return 'overdue';
  if (item.type === 'event' && (item.status === 'active' || isCurrentEvent(item))) return 'active';
  return 'default';
}

function rowMetadata(
  item: MobileTodayInteractionItem,
  showWorkspaceNames: boolean,
  fallback?: string | null,
) {
  const workspace = showWorkspaceNames && item.workspaceName ? item.workspaceName : null;
  const usefulFallback = 'status' in item && item.status === 'overdue' ? null : fallback;
  if ('source' in item) {
    return compactMetadata([
      item.source,
      item.suggestedProjectName ? `Suggested: ${item.suggestedProjectName}` : null,
      item.submittedByName ? `Submitted by ${item.submittedByName}` : null,
      item.suggestedAssigneeName ? `Reviewer: ${item.suggestedAssigneeName}` : null,
      workspace,
    ]);
  }
  if (item.type === 'note') {
    return compactMetadata([
      'Note',
      item.authorName ? `By ${item.authorName}` : null,
      item.lastEditorName ? `Edited by ${item.lastEditorName}` : null,
      workspace,
      formatDateTimeLabel(item.updatedAt ?? item.createdAt),
    ]);
  }
  if (item.type === 'project') {
    return compactMetadata([
      workspace,
      item.attentionReason ?? item.nextAction ?? item.projectStatus,
      item.itemsDueToday ? `${item.itemsDueToday} due today` : null,
      item.ownerName ? `Owner: ${item.ownerName}` : null,
    ]);
  }
  if (item.type === 'deadline') return compactMetadata([workspace, item.dateLabel]);
  if (item.type === 'focus') return compactMetadata([workspace, item.urgency, item.dueLabel]);
  if (item.type === 'project_action') {
    return compactMetadata([workspace, item.status === 'overdue' ? 'Overdue' : item.meta || 'Project action']);
  }
  return compactMetadata([
    workspace,
    usefulFallback,
    'status' in item && String(item.status) === 'overdue'
      ? 'Overdue'
      : 'dueLabel' in item && item.dueLabel === 'Today'
        ? 'Today'
        : null,
    'assignedToCurrentUser' in item && item.assignedToCurrentUser
      ? 'Assigned to you'
      : 'assignedToUserName' in item && item.assignedToUserName
        ? item.assignedToUserName
        : null,
  ]);
}

function rowTrailingLabel(item: MobileTodayInteractionItem) {
  if ('source' in item || item.type === 'note') return null;
  if (item.type === 'focus' || item.status === 'overdue') return null;
  if (item.type === 'deadline') return item.timeLabel;
  if (item.type === 'project') return item.dueLabel;
  return 'timeLabel' in item
    ? item.timeLabel ?? ('dueLabel' in item ? item.dueLabel : null) ?? item.dateLabel ?? startsInLabel(item)
    : 'dueLabel' in item
      ? item.dueLabel
      : null;
}

function rowLeadingLabel(item: MobileTodayInteractionItem) {
  return null;
}

function nextUpMetadata(item: MobileUpcomingItem | MobileTodayItem, showWorkspaceNames: boolean) {
  const now = new Date();
  const date = item.startsAt ? new Date(item.startsAt) : null;
  const dateLabel = date && !isSameLocalDay(date, now) ? formatShortDate(item.startsAt) : null;
  return compactMetadata([
    showWorkspaceNames ? item.workspaceName : null,
    dateLabel,
    durationLabel(item),
  ]);
}

function itemRow(
  item: MobileTodayInteractionItem,
  metadata: string[],
  onItemPress?: (item: MobileTodayInteractionItem) => void,
  onItemLongPress?: (item: MobileTodayInteractionItem) => void,
  onItemComplete?: (item: MobileTodayInteractionItem) => void,
  onItemAction?: (actionId: string, item: MobileTodayInteractionItem) => void,
) {
  const swipeActions = getTodayItemSwipeActions(item);
  const availableActions = getTodayItemActions(item, { onAction: () => undefined });
  const swipeAction = (id: string | null) => {
    if (!id) return undefined;
    const definition = availableActions.find((candidate) => candidate.id === id);
    return definition
      ? { label: definition.label, onPress: () => onItemAction?.(id, item) }
      : undefined;
  };

  return (
    <TodayItemRow
      key={item.id}
      type={itemType(item)}
      title={item.title}
      metadata={metadata}
      progress={'type' in item && item.type === 'project' ? item.progress : undefined}
      projectType={'projectType' in item ? item.projectType : undefined}
      projectColor={'projectColor' in item ? item.projectColor : undefined}
      leadingLabel={rowLeadingLabel(item)}
      trailingLabel={rowTrailingLabel(item)}
      status={rowStatus(item)}
      onPress={() => onItemPress?.(item)}
      onLongPress={() => onItemLongPress?.(item)}
      onOverflow={() => onItemLongPress?.(item)}
      swipeRight={swipeAction(swipeActions.right)}
      swipeLeft={swipeAction(swipeActions.left)}
    />
  );
}

export function TodayList({
  upcoming,
  today,
  captures,
  projects = [],
  notes = [],
  mentions = [],
  teamActivity = [],
  isTeamWorkspace = false,
  showWorkspaceNames = true,
  collapsedSections = {},
  onToggleSection,
  onSectionLayout,
  onItemPress,
  onItemLongPress,
  onItemComplete,
  onItemAction,
  focusOrder = [],
  onViewDay,
  onAddFocus,
  onQuickNote,
  onTeamItemPress,
  surfaceSection = null,
}: TodayListProps) {
  const theme = useLedgerTheme();
  const [now, setNow] = useState(() => new Date());
  const [attentionExpanded, setAttentionExpanded] = useState(false);
  const [intakeExpanded, setIntakeExpanded] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const focusItems = today
    .filter((item) => item.type === 'focus')
    .sort((left, right) => {
      const leftIndex = focusOrder.indexOf(left.id);
      const rightIndex = focusOrder.indexOf(right.id);
      return (
        (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
      );
    })
    .slice(0, 5);
  const timedTodayItems = today.filter((item) => item.type !== 'focus' && Boolean(item.startsAt));
  const timedItems = [...upcoming, ...timedTodayItems].filter((item) => {
    if (!item.startsAt) return false;
    const date = new Date(item.startsAt);
    return isSameLocalDay(date, now) || isTomorrowLocalDay(date, now);
  });
  const remainingTodayItems = timedItems.filter((item) => {
    const date = new Date(item.startsAt ?? 0);
    return isSameLocalDay(date, now) && (date.getTime() >= now.getTime() || isCurrentEvent(item, now));
  });
  const nextUpItems = (remainingTodayItems.length ? remainingTodayItems : timedItems.filter((item) => isTomorrowLocalDay(new Date(item.startsAt ?? 0), now)).slice(0, 1))
    .sort((left, right) => {
      const leftTime = new Date(left.startsAt ?? 0).getTime();
      const rightTime = new Date(right.startsAt ?? 0).getTime();
      return leftTime - rightTime;
    })
    .slice(0, 3);
  const eventSurfaceItems = [...today.filter((item) => item.type === 'event'), ...upcoming.filter((item) => item.type === 'event')]
    .filter((item) => item.startsAt && new Date(item.startsAt).getTime() >= now.getTime())
    .sort((left, right) => new Date(left.startsAt ?? 0).getTime() - new Date(right.startsAt ?? 0).getTime())
    .slice(0, 3);
  const displayedNextUpItems = surfaceSection === 'next-up' ? eventSurfaceItems : nextUpItems;
  const nextUpIds = new Set(nextUpItems.map((item) => item.id));
  const allAttentionItems: MobileTodayInteractionItem[] = [
    ...today
      .filter((item) => item.status === 'overdue' && item.type !== 'focus')
      .slice(0, 5),
    ...projects.filter((project) => Boolean(project.attentionReason)),
  ];
  const attentionItems = attentionExpanded ? allAttentionItems : allAttentionItems.slice(0, 5);
  const attentionIds = new Set(attentionItems.map((item) => item.id));
  const todayItems = today.filter(
    (item) =>
      item.type !== 'focus' &&
      item.type !== 'project_action' &&
      !attentionIds.has(item.id) &&
      !nextUpIds.has(item.id),
  );
  const projectItems = projects.slice(0, 5);
  const intakeItems = captures.items.slice(0, intakeExpanded ? captures.items.length : 3);
  const noteItems = notes.slice(0, 3);

  const collapsed = (section: TodaySectionKey) => Boolean(collapsedSections[section]);
  const toggle = (section: TodaySectionKey) => onToggleSection?.(section);
  const layout = (section: TodaySectionKey) => (y: number) => onSectionLayout?.(section, y);
  const show = (section: TodaySectionKey) => !surfaceSection || surfaceSection === section;

  return (
    <View style={{ gap: theme.spacing.lg }}>
      {show('focus') ? <TodaySection
        title="Focus"
        count={focusItems.length}
        collapsed={collapsed('focus')}
        onToggle={() => toggle('focus')}
        actionLabel="Add"
        onAction={onAddFocus}
        onLayout={layout('focus')}
      >
        {focusItems.length ? (
          focusItems.map((item) =>
            itemRow(
              item,
              rowMetadata(item, showWorkspaceNames),
              onItemPress,
              onItemLongPress,
              onItemComplete,
              onItemAction,
            ),
          )
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose what matters today. Add to Focus"
            onPress={onAddFocus}
            style={({ pressed }) => [
              { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
              Choose what matters today
            </AppText>
            <AppText variant="body" style={{ color: theme.colors.accent }}>
              +
            </AppText>
          </Pressable>
        )}
      </TodaySection> : null}

      {show('next-up') && displayedNextUpItems.length ? (
        <TodaySection
          title="Next up"
          count={displayedNextUpItems.length}
          collapsed={collapsed('next-up')}
          onToggle={() => toggle('next-up')}
          actionLabel="View day"
          onAction={onViewDay}
          onLayout={layout('next-up')}
        >
          {displayedNextUpItems.map((item) =>
            itemRow(
              item,
              nextUpMetadata(item, showWorkspaceNames),
              onItemPress,
              onItemLongPress,
              onItemComplete,
              onItemAction,
            ),
          )}
        </TodaySection>
      ) : null}

      {show('attention') && (attentionItems.length || (isTeamWorkspace && mentions.length)) ? (
        <TodaySection
          title="Needs attention"
          count={attentionItems.length + (isTeamWorkspace ? mentions.length : 0)}
          collapsed={collapsed('attention')}
          onToggle={() => toggle('attention')}
          onLayout={layout('attention')}
        >
          {isTeamWorkspace
            ? mentions.map((mention) => (
                <TodayItemRow
                  key={mention.id}
                  type="note"
                  title={mention.title}
                  metadata={mention.metadata}
                  status={mention.unread ? 'focused' : 'default'}
                  onPress={() => onTeamItemPress?.('mention', mention.sourceId)}
                  accessibilityLabel={`${mention.title}. ${mention.metadata.join('. ')}`}
                />
              ))
            : null}
          {attentionItems.map((item) =>
            itemRow(
              item,
              rowMetadata(item, showWorkspaceNames, 'type' in item && item.type === 'project' ? item.meta : null),
              onItemPress,
              onItemLongPress,
              onItemComplete,
              onItemAction,
            ),
          )}
          {allAttentionItems.length > 5 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={attentionExpanded ? 'Show fewer attention items' : `Show ${allAttentionItems.length - 5} more attention items`}
              onPress={() => setAttentionExpanded((current) => !current)}
              style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
            >
              <AppText variant="meta" style={{ color: theme.colors.accent }}>
                {attentionExpanded ? 'Show less' : `Show ${allAttentionItems.length - 5} more`}
              </AppText>
            </Pressable>
          ) : null}
        </TodaySection>
      ) : null}

      {show('today') && todayItems.length ? (
        <TodaySection
          title="Today"
          count={todayItems.length}
          collapsed={collapsed('today')}
          onToggle={() => toggle('today')}
          onLayout={layout('today')}
        >
          {todayItems.map((item) =>
            itemRow(
              item,
              rowMetadata(item, showWorkspaceNames, item.type === 'project_action' ? item.meta : null),
              onItemPress,
              onItemLongPress,
              onItemComplete,
              onItemAction,
            ),
          )}
        </TodaySection>
      ) : null}

      {show('projects') && projectItems.length ? (
        <TodaySection
          title="Projects"
          count={projectItems.length}
          collapsed={collapsed('projects')}
          onToggle={() => toggle('projects')}
          onLayout={layout('projects')}
        >
          {projectItems.map((item) =>
            itemRow(
              item,
              rowMetadata(item, showWorkspaceNames, item.meta),
              onItemPress,
              onItemLongPress,
              onItemComplete,
              onItemAction,
            ),
          )}
        </TodaySection>
      ) : null}

      {show('intake') && intakeItems.length ? (
        <TodaySection
          title="Intake"
          count={captures.count}
          collapsed={collapsed('intake')}
          onToggle={() => toggle('intake')}
          actionLabel={captures.items.length > 3 ? (intakeExpanded ? 'Show less' : 'View all') : undefined}
          onAction={() => setIntakeExpanded((current) => !current)}
          onLayout={layout('intake')}
        >
          {intakeItems.map((item) =>
            itemRow(
              item,
              rowMetadata(item, showWorkspaceNames),
              onItemPress,
              onItemLongPress,
              onItemComplete,
              onItemAction,
            ),
          )}
        </TodaySection>
      ) : null}

      {show('notes') && noteItems.length ? (
        <TodaySection
          title="Recent notes"
          count={noteItems.length}
          collapsed={collapsed('notes')}
          onToggle={() => toggle('notes')}
          actionLabel="Quick note"
          onAction={onQuickNote}
          onLayout={layout('notes')}
        >
          {noteItems.map((item) =>
            itemRow(
              item,
              rowMetadata(item, showWorkspaceNames),
              onItemPress,
              onItemLongPress,
              onItemComplete,
              onItemAction,
            ),
          )}
        </TodaySection>
      ) : null}

      {show('team-activity') && isTeamWorkspace && teamActivity.length ? (
        <TodaySection
          title="Team activity"
          count={teamActivity.length}
          collapsed={collapsed('team-activity')}
          onToggle={() => toggle('team-activity')}
          actionLabel="View all"
          onAction={() => onTeamItemPress?.('team_activity', null)}
          onLayout={layout('team-activity')}
        >
          {teamActivity.map((activity) => (
            <TodayItemRow
              key={activity.id}
              type="note"
              title={activity.title}
              metadata={activity.metadata}
              trailingLabel={formatDateTimeLabel(activity.createdAt)}
              onPress={() => onTeamItemPress?.('team_activity', activity.sourceId)}
              accessibilityLabel={`${activity.title}. ${activity.metadata.join('. ')}`}
            />
          ))}
        </TodaySection>
      ) : null}
    </View>
  );
}
