import { useColorScheme } from 'react-native';

import { ledgerTokens } from './tokens';

export function useLedgerTheme() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = ledgerTokens.colors[scheme];

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
