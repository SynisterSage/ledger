/**
 * Mobile deliberately consumes the same semantic palette as Electron.
 * Keep these values in lockstep with src/theme/desktopTokens.ts. The shape is
 * React-Native friendly, while the names stay shared across Ledger surfaces.
 */
export const lightColors = {
  background: '#FFFFFF',
  backgroundMuted: '#F9F9F9',
  surface: '#FFFFFF',
  surfaceCard: '#FAFAFA',
  surfaceMuted: '#F5F5F5',
  menuBackground: '#FFFFFF',
  surfaceSelected: '#F0F0F0',
  surfaceHover: '#F8F8F8',

  textPrimary: '#0A0A0A',
  textSecondary: '#666666',
  textMuted: '#999999',

  borderSubtle: '#E5E5E5',
  borderStrong: '#D0D0D0',

  accent: '#FF5F40',
  accentHover: '#E85430',
  accentSoft: '#FFE8DC',

  danger: '#D92D20',
  success: '#12B76A',
  warning: '#DC6803',

  inputBackground: '#FAFAFA',
  placeholder: '#A0A0A0',

  tabBar: '#F5F5F5',
  tabBarBorder: '#E0E0E0',
  backdrop: 'rgba(10, 10, 10, 0.4)',
  shadow: 'rgba(0, 0, 0, 0.06)',
};

export const darkColors = {
  background: '#0F0F0F',
  backgroundMuted: '#161616',
  surface: '#1A1A1A',
  surfaceCard: '#1F1F1F',
  surfaceMuted: '#262626',
  menuBackground: '#242424',
  surfaceSelected: '#2A2A2A',
  surfaceHover: '#202020',

  textPrimary: '#F5F5F5',
  textSecondary: '#B0B0B0',
  textMuted: '#808080',

  borderSubtle: '#333333',
  borderStrong: '#404040',

  accent: '#FF8C5F',
  accentHover: '#FF7A4D',
  accentSoft: '#FFAB8F',

  danger: '#F97066',
  success: '#32D583',
  warning: '#FDB022',

  inputBackground: '#161616',
  placeholder: '#666666',

  tabBar: '#0F0F0F',
  tabBarBorder: '#2A2A2A',
  backdrop: 'rgba(15, 15, 15, 0.6)',
  shadow: 'rgba(0, 0, 0, 0.3)',
};

export type LedgerColorScheme = 'light' | 'dark';
export type LedgerColors = typeof lightColors;

export const getLedgerColors = (scheme: LedgerColorScheme) =>
  scheme === 'dark' ? darkColors : lightColors;
