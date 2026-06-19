import type { MobileTodayResponse } from '@/types/ledger';

function formatCount(count: number, singular: string, plural: string) {
  return count === 1 ? `one ${singular}` : `${count} ${plural}`;
}

function cleanText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function itemKind(value: string | null | undefined) {
  switch (cleanText(value)?.toLowerCase()) {
    case 'event':
      return 'event';
    case 'reminder':
      return 'reminder';
    case 'task':
      return 'task';
    case 'deadline':
      return 'deadline';
    case 'focus':
      return 'focus';
    case 'project_action':
      return 'project action';
    default:
      return null;
  }
}

function naturalList(values: string[]) {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return values.join(' and ');

  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function itemDescription(item: {
  type?: string | null;
  title?: string | null;
  timeLabel?: string | null;
  dateLabel?: string | null;
}, options: { prefersFullDate: boolean }) {
  const title = cleanText(item.title);
  if (!title) return null;

  const parts = [itemKind(item.type), title].filter(Boolean);
  const schedule = options.prefersFullDate
    ? cleanText(item.dateLabel) ?? cleanText(item.timeLabel)
    : cleanText(item.timeLabel) ?? cleanText(item.dateLabel);
  if (schedule) {
    parts.push(`at ${schedule}`);
  }

  return parts.join(' ');
}

export function buildLedgerTodaySiriSummary(todayResponse: MobileTodayResponse) {
  const upcoming = todayResponse.upcoming ?? [];
  const today = todayResponse.today ?? [];
  const capturesCount = Math.max(0, todayResponse.captures?.count ?? 0);
  const upcomingCount = upcoming.length;
  const todayCount = today.length;
  const totalCount = upcomingCount + todayCount + capturesCount;

  if (totalCount === 0) {
    return 'Nothing needs attention in Ledger today.';
  }

  const parts = [
    `You have ${formatCount(upcomingCount, 'upcoming item', 'upcoming items')}, ${formatCount(
      todayCount,
      'action',
      'actions',
    )}, and ${formatCount(capturesCount, 'capture', 'captures')} waiting in Ledger.`,
  ];

  const todayItems = today
    .slice(0, 2)
    .map((item) => itemDescription(item, { prefersFullDate: false }))
    .filter((item): item is string => Boolean(item));
  const upcomingItems = upcoming
    .slice(0, 2)
    .map((item) => itemDescription(item, { prefersFullDate: true }))
    .filter((item): item is string => Boolean(item));

  if (todayItems.length > 0) {
    parts.push(`Today: ${naturalList(todayItems)}.`);
  }

  if (upcomingItems.length > 0) {
    parts.push(`Upcoming: ${naturalList(upcomingItems)}.`);
  }

  if (upcomingCount === 0 && todayCount <= 1 && capturesCount === 0 && todayCount === 1) {
    parts[0] = 'Today looks light in Ledger. You have one action due.';
  } else if (todayCount === 0 && capturesCount === 0 && upcomingCount === 1) {
    parts[0] = 'Today looks light in Ledger. You have one upcoming item and no actions due.';
  }

  if (totalCount > 3) {
    const actionTitles = today
      .map((item) => cleanText(item.title))
      .filter((title): title is string => Boolean(title))
      .slice(0, 2);

    if (upcomingCount > 0 && actionTitles.length > 0) {
      parts.push(`You also have ${actionTitles.join(' and ')}.`);
    }

    parts.push('Open Ledger to see the full list.');
  }

  return parts.join(' ');
}
