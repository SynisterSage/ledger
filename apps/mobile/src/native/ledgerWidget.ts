import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

import type { MobileTodayResponse } from '@/types/ledger';

type LedgerWidgetBridge = {
  updateSnapshot?: (snapshot: Record<string, unknown>) => boolean;
};

const bridge = requireOptionalNativeModule<LedgerWidgetBridge>('LedgerWidget');
let bridgeDisabled = false;

export function updateLedgerWidgetSnapshot(today: MobileTodayResponse) {
  if (
    Platform.OS !== 'ios' ||
    bridgeDisabled ||
    !bridge ||
    typeof bridge.updateSnapshot !== 'function' ||
    !today ||
    !Array.isArray(today.today) ||
    !Array.isArray(today.upcoming)
  ) {
    return;
  }

  try {
    const focus = today.today.find((item) => item.type === 'focus');
    const next = [...today.upcoming]
      .sort((left, right) => {
        const leftTime = left.startsAt ? Date.parse(left.startsAt) : Number.POSITIVE_INFINITY;
        const rightTime = right.startsAt ? Date.parse(right.startsAt) : Number.POSITIVE_INFINITY;
        return leftTime - rightTime;
      })[0] ?? today.today.find((item) => item.type !== 'focus');

    const accepted = bridge.updateSnapshot({
      focusTitle: focus?.title ?? null,
      nextTitle: next?.title ?? null,
      nextMeta: next?.timeLabel ?? next?.dateLabel ?? (next && 'dueLabel' in next ? next.dueLabel : null),
      todayCount: today.today.filter((item) => item.type !== 'focus').length,
      upcomingCount: today.upcoming.length,
      hasData: true,
      updatedAt: new Date().toISOString(),
    });
    if (accepted === false) {
      bridgeDisabled = true;
    }
  } catch (error) {
    // The widget is optional. A missing or incompatible native bridge must
    // never take down the main React Native application.
    bridgeDisabled = true;
    console.warn('[ledger-widget] Native widget sync disabled:', error);
  }
}
