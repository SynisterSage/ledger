// Temporary mobile theme tokens.
// These mirror the Ledger desktop token structure until shared tokens are wired in.
// Palette direction: Option B / Graphite Workspace.
// Light mode uses warm stone/paper neutrals.
// Dark mode uses warm graphite/charcoal, not navy.

export const lightColors = {
  background: '#F7F4EF',
  backgroundMuted: '#EFEAE3',
  surface: '#FFFCF7',
  surfaceMuted: '#F1ECE4',
  selectedSurface: '#F4E7DE',

  textPrimary: '#171512',
  textSecondary: '#4F4A43',
  textMuted: '#766F65',

  borderSubtle: '#DED6CB',
  borderStrong: '#C8BDAF',

  accent: '#FF5F40',
  accentSoft: '#FFE1D7',

  danger: '#C24135',
  success: '#168A5B',
  warning: '#B86B16',

  inputBackground: '#FFFCF8',
  placeholder: '#9A9288',

  tabBar: '#F4EFE7',
  tabBarBorder: '#DED6CB',
};

export const darkColors = {
  background: '#11100E',
  backgroundMuted: '#171512',
  surface: '#1A1815',
  surfaceMuted: '#28251F',
  selectedSurface: '#332820',

  textPrimary: '#F7F2EA',
  textSecondary: '#D4CCC0',
  textMuted: '#A79D90',

  borderSubtle: '#38332B',
  borderStrong: '#51493D',

  accent: '#FF7A59',
  accentSoft: '#4B2B22',

  danger: '#F97066',
  success: '#32D583',
  warning: '#FDB022',

  inputBackground: '#181612',
  placeholder: '#81786C',

  tabBar: '#15130F',
  tabBarBorder: '#332E27',
};

export type LedgerColorScheme = 'light' | 'dark';
export type LedgerColors = typeof lightColors;

export const getLedgerColors = (scheme: LedgerColorScheme) =>
  scheme === 'dark' ? darkColors : lightColors;