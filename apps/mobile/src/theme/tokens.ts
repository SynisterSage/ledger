import { darkColors, lightColors } from './colors';
import { radius } from './radius';
import { spacing } from './spacing';
import { typography } from './typography';

export const ledgerTokens = {
  colors: {
    light: lightColors,
    dark: darkColors,
  },
  spacing,
  typography,
  radius,
} as const;

export type LedgerTokens = typeof ledgerTokens;
