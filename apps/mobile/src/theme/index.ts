import { useColorScheme } from 'react-native';

import { getLedgerColors, type LedgerColorScheme } from './colors';
import { ledgerTokens } from './tokens';

import { useAppPreferencesState } from '@/store/appPreferencesStore';

export function useLedgerTheme() {
  const preferredScheme = useColorScheme();
  const appPreferences = useAppPreferencesState();
  const schemePreference = appPreferences.themeMode;
  const scheme: LedgerColorScheme =
    schemePreference === 'system'
      ? preferredScheme === 'dark'
        ? 'dark'
        : 'light'
      : schemePreference;
  const colors = getLedgerColors(scheme);

  return {
    scheme,
    colors,
    spacing: ledgerTokens.spacing,
    typography: ledgerTokens.typography,
    radius: ledgerTokens.radius,
  };
}

export { ledgerTokens } from './tokens';
export * from './colors';
export * from './spacing';
export * from './typography';
export * from './radius';
