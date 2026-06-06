import * as Haptics from 'expo-haptics';

import { getAppPreferencesState } from '@/store/appPreferencesStore';

function hapticsAllowed() {
  const state = getAppPreferencesState();
  return state.isHydrated ? state.hapticsEnabled : false;
}

export async function triggerImpactHaptic(style: Haptics.ImpactFeedbackStyle) {
  if (!hapticsAllowed()) {
    return;
  }

  try {
    await Haptics.impactAsync(style);
  } catch {
    // Ignore haptic failures on unsupported devices.
  }
}

export async function triggerLightHaptic() {
  await triggerImpactHaptic(Haptics.ImpactFeedbackStyle.Light);
}
