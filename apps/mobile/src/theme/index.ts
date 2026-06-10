import { ledgerTokens } from './tokens';

export function useLedgerTheme() {
  const scheme = 'light' as const;
  const colors = ledgerTokens.colors.light;

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
