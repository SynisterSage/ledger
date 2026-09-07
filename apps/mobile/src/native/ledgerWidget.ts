import { NativeModules, Platform } from 'react-native';

import type { MobileTodayResponse } from '@/types/ledger';

type LedgerWidgetBridge = {
  updateSnapshot?: (snapshot: Record<string, unknown>) => void;
};

const bridge = NativeModules.LedgerWidgetBridge as LedgerWidgetBridge | undefined;

export function updateLedgerWidgetSnapshot(today: MobileTodayResponse) {
  if (Platform.OS !== 'ios' || !bridge?.updateSnapshot) return;

  const focus = today.today.find((item) => item.type === 'focus');
  const next = today.upcoming[0] ?? today.today.find((item) => item.type !== 'focus');

  bridge.updateSnapshot({
    focusTitle: focus?.title ?? null,
    nextTitle: next?.title ?? null,
    nextMeta: next?.timeLabel ?? next?.dateLabel ?? (next && 'dueLabel' in next ? next.dueLabel : null),
    todayCount: today.today.filter((item) => item.type !== 'focus').length,
    upcomingCount: today.upcoming.length,
    hasData: true,
    updatedAt: new Date().toISOString(),
  });
}
