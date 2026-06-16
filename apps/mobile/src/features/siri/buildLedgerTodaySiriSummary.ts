import type { MobileTodayResponse } from '@/types/ledger';

function formatCount(count: number, singular: string, plural: string) {
  return count === 1 ? `one ${singular}` : `${count} ${plural}`;
}

function cleanText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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

  const nextUpcoming = upcoming[0];
  const nextUpcomingTitle = cleanText(nextUpcoming?.title);
  const nextUpcomingTime = cleanText(nextUpcoming?.timeLabel);

  if (nextUpcomingTitle) {
    parts.push(
      nextUpcomingTime
        ? `Your next item is ${nextUpcomingTitle} at ${nextUpcomingTime}.`
        : `Your next item is ${nextUpcomingTitle}.`,
    );
  } else {
    const firstTodayTitle = cleanText(today[0]?.title);
    if (firstTodayTitle) {
      parts.push(`First up: ${firstTodayTitle}.`);
    }
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
