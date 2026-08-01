import { darkColors, lightColors } from './colors';
import { radius } from './radius';
import { spacing } from './spacing';
import { typography } from './typography';

// React Native cannot consume the desktop CSS shadow strings directly. These
// values preserve the same restrained elevation hierarchy for native surfaces.
const shadows = {
  card: { color: '#000000', opacity: 0.05, radius: 2, offsetY: 1, elevation: 1 },
  surface: { color: '#000000', opacity: 0.08, radius: 14, offsetY: 8, elevation: 6 },
  modal: { color: '#000000', opacity: 0.12, radius: 28, offsetY: 14, elevation: 12 },
  popover: { color: '#000000', opacity: 0.12, radius: 16, offsetY: 8, elevation: 8 },
  accent: { color: '#FF5F40', opacity: 0.16, radius: 10, offsetY: 5, elevation: 4 },
} as const;

export const ledgerTokens = {
  colors: {
    light: lightColors,
    dark: darkColors,
  },
  spacing,
  typography,
  radius,
  shadows,
} as const;

export type LedgerTokens = typeof ledgerTokens;
