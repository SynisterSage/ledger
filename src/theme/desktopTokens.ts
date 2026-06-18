export type DesktopThemeScheme = 'light' | 'dark';

type DesktopColorTokens = {
  background: string;
  backgroundMuted: string;
  surface: string;
  surfaceCard: string;
  surfaceMuted: string;
  surfaceSelected: string;
  surfaceHover: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderSubtle: string;
  borderStrong: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  danger: string;
  success: string;
  warning: string;
  inputBackground: string;
  placeholder: string;
  tabBar: string;
  tabBarBorder: string;
  backdrop: string;
  shadow: string;
  glassWhite: string;
  glassCream: string;
  glassIconWhite: string;
  glassIconCream: string;
  glassBorder: string;
  glassOutline: string;
  glassShadow: string;
  glassIconShadow: string;
  glassHighlight: string;
  glassSheen: string;
  glassSolidBackground: string;
  glassSolidBorder: string;
  modalBackdrop: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
};

const sharedSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  screenX: 20,
  screenY: 24,
} as const;

const sharedTypography = {
  screenTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: 700,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: 700,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 400,
  },
  bodyStrong: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 600,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 400,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 400,
  },
  button: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: 600,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 600,
  },
} as const;

const sharedRadius = {
  control: 12,
  surface: 16,
  sheet: 24,
  pill: 999,
  window: 24,
} as const;

const sharedShadows = {
  card: '0 1px 2px rgba(20, 20, 18, 0.035)',
  surface: '0 14px 42px rgba(20, 20, 18, 0.075)',
  modal: '0 28px 80px rgba(20, 20, 18, 0.14)',
  popover: '0 16px 42px rgba(20, 20, 18, 0.13)',
  accent: '0 10px 26px rgba(255, 95, 64, 0.16)',
} as const;

const sharedStructure = {
  spacing: sharedSpacing,
  typography: sharedTypography,
  radius: sharedRadius,
  shadows: sharedShadows,
} as const;

/**
 * Option B: Graphite Workspace
 *
 * Light mode:
 * - warm stone/paper base
 * - less peach/cream than the previous system
 * - orange used as a precise accent
 *
 * Dark mode:
 * - warm graphite/charcoal
 * - not navy
 * - pairs better with Ledger orange
 */
const lightColors: DesktopColorTokens = {
  background: '#F7F4EF',
  backgroundMuted: '#EFEAE3',

  surface: '#FFFCF7',
  surfaceCard: '#FBF7F0',
  surfaceMuted: '#F1ECE4',
  surfaceSelected: '#F4E7DE',
  surfaceHover: '#E2DDD5',

  textPrimary: '#171512',
  textSecondary: '#4F4A43',
  textMuted: '#766F65',

  borderSubtle: '#DED6CB',
  borderStrong: '#C8BDAF',

  accent: '#FF5F40',
  accentHover: '#E95235',
  accentSoft: '#FFE1D7',

  danger: '#C24135',
  success: '#168A5B',
  warning: '#B86B16',

  inputBackground: '#FFFCF8',
  placeholder: '#9A9288',

  tabBar: '#F4EFE7',
  tabBarBorder: '#DED6CB',

  backdrop: 'rgba(23, 21, 18, 0.48)',
  shadow: 'rgba(23, 21, 18, 0.09)',

  glassWhite: 'rgba(255, 252, 247, 0.9)',
  glassCream: 'rgba(244, 239, 231, 0.86)',
  glassIconWhite: 'rgba(255, 252, 247, 0.72)',
  glassIconCream: 'rgba(244, 239, 231, 0.68)',
  glassBorder: 'rgba(222, 214, 203, 0.86)',
  glassOutline: 'rgba(200, 189, 175, 0.16)',
  glassShadow:
    '0 30px 90px rgba(23, 21, 18, 0.2), inset 0 1px 0 rgba(255, 252, 247, 0.86), inset 0 -1px 0 rgba(23, 21, 18, 0.045)',
  glassIconShadow:
    '0 14px 38px rgba(23, 21, 18, 0.13), inset 0 1px 0 rgba(255, 252, 247, 0.76)',
  glassHighlight: 'rgba(255, 252, 247, 0.58)',
  glassSheen: 'rgba(255, 252, 247, 0.28)',

  glassSolidBackground: 'rgba(255, 252, 247, 0.96)',
  glassSolidBorder: 'rgba(222, 214, 203, 0.9)',

  modalBackdrop: 'rgba(23, 21, 18, 0.48)',

  scrollbarThumb: 'rgb(190 181 169)',
  scrollbarThumbHover: 'rgb(150 141 130)',
};

const darkColors: DesktopColorTokens = {
  background: '#11100E',
  backgroundMuted: '#171512',

  surface: '#1A1815',
  surfaceCard: '#211F1B',
  surfaceMuted: '#28251F',
  surfaceSelected: '#332820',
  surfaceHover: '#2D2923',

  textPrimary: '#F7F2EA',
  textSecondary: '#D4CCC0',
  textMuted: '#A79D90',

  borderSubtle: '#38332B',
  borderStrong: '#51493D',

  accent: '#FF7A59',
  accentHover: '#FF6846',
  accentSoft: '#4B2B22',

  danger: '#F97066',
  success: '#32D583',
  warning: '#FDB022',

  inputBackground: '#181612',
  placeholder: '#81786C',

  tabBar: '#15130F',
  tabBarBorder: '#332E27',

  backdrop: 'rgba(8, 7, 6, 0.72)',
  shadow: 'rgba(0, 0, 0, 0.42)',

  glassWhite: 'rgba(26, 24, 21, 0.86)',
  glassCream: 'rgba(20, 18, 15, 0.9)',
  glassIconWhite: 'rgba(34, 31, 27, 0.72)',
  glassIconCream: 'rgba(24, 22, 18, 0.78)',
  glassBorder: 'rgba(247, 242, 234, 0.12)',
  glassOutline: 'rgba(247, 242, 234, 0.06)',
  glassShadow:
    '0 32px 90px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 252, 247, 0.045), inset 0 -1px 0 rgba(247, 242, 234, 0.035)',
  glassIconShadow:
    '0 14px 38px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 252, 247, 0.04)',
  glassHighlight: 'rgba(255, 252, 247, 0.045)',
  glassSheen: 'rgba(255, 252, 247, 0.06)',

  glassSolidBackground: 'rgba(26, 24, 21, 0.96)',
  glassSolidBorder: 'rgba(247, 242, 234, 0.12)',

  modalBackdrop: 'rgba(8, 7, 6, 0.76)',

  scrollbarThumb: 'rgb(81 73 61)',
  scrollbarThumbHover: 'rgb(116 105 90)',
};

export const desktopTokens = {
  colors: {
    light: lightColors,
    dark: darkColors,
  },
  ...sharedStructure,
} as const;

export type DesktopTokens = typeof desktopTokens;

export const getDesktopTokens = (scheme: DesktopThemeScheme = 'light') => ({
  colors: desktopTokens.colors[scheme],
  ...sharedStructure,
} as const);

export const getSystemDesktopThemeScheme = (): DesktopThemeScheme => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getDesktopCssVars = (scheme: DesktopThemeScheme = 'light'): Record<string, string> => {
  const tokens = getDesktopTokens(scheme);
  const colors = tokens.colors;

  return {
    '--ledger-background': colors.background,
    '--ledger-background-muted': colors.backgroundMuted,
    '--ledger-surface': colors.surface,
    '--ledger-surface-card': colors.surfaceCard,
    '--ledger-surface-muted': colors.surfaceMuted,
    '--ledger-surface-selected': colors.surfaceSelected,
    '--ledger-surface-hover': colors.surfaceHover,
    '--ledger-text-primary': colors.textPrimary,
    '--ledger-text-secondary': colors.textSecondary,
    '--ledger-text-muted': colors.textMuted,
    '--ledger-border-subtle': colors.borderSubtle,
    '--ledger-border-strong': colors.borderStrong,
    '--ledger-accent': colors.accent,
    '--ledger-accent-hover': colors.accentHover,
    '--ledger-accent-soft': colors.accentSoft,
    '--ledger-danger': colors.danger,
    '--ledger-success': colors.success,
    '--ledger-warning': colors.warning,
    '--ledger-input-background': colors.inputBackground,
    '--ledger-placeholder': colors.placeholder,
    '--ledger-tab-bar': colors.tabBar,
    '--ledger-tab-bar-border': colors.tabBarBorder,
    '--ledger-backdrop': colors.backdrop,
    '--ledger-shadow': colors.shadow,
    '--ledger-shadow-accent': tokens.shadows.accent,
    '--ledger-control-radius': `${tokens.radius.control}px`,
    '--ledger-surface-radius': `${tokens.radius.surface}px`,
    '--ledger-sheet-radius': `${tokens.radius.sheet}px`,
    '--ledger-pill-radius': `${tokens.radius.pill}px`,
    '--ledger-window-radius': `${tokens.radius.window}px`,
    '--ledger-screen-x': `${tokens.spacing.screenX}px`,
    '--ledger-screen-y': `${tokens.spacing.screenY}px`,
    '--ledger-sidebar-glass-white': colors.glassWhite,
    '--ledger-sidebar-glass-cream': colors.glassCream,
    '--ledger-sidebar-glass-icon-white': colors.glassIconWhite,
    '--ledger-sidebar-glass-icon-cream': colors.glassIconCream,
    '--ledger-sidebar-glass-border': colors.glassBorder,
    '--ledger-sidebar-glass-outline': colors.glassOutline,
    '--ledger-sidebar-glass-shadow': colors.glassShadow,
    '--ledger-sidebar-glass-icon-shadow': colors.glassIconShadow,
    '--ledger-sidebar-glass-highlight': colors.glassHighlight,
    '--ledger-sidebar-glass-sheen': colors.glassSheen,
    '--ledger-sidebar-glass-solid-background': colors.glassSolidBackground,
    '--ledger-sidebar-glass-solid-border': colors.glassSolidBorder,
    '--ledger-modal-backdrop': colors.modalBackdrop,
    '--ledger-scrollbar-thumb': colors.scrollbarThumb,
    '--ledger-scrollbar-thumb-hover': colors.scrollbarThumbHover,
  } as const;
};

export const applyDesktopCssVars = (target: HTMLElement, scheme: DesktopThemeScheme = 'light') => {
  const vars = getDesktopCssVars(scheme);

  Object.entries(vars).forEach(([name, value]) => {
    target.style.setProperty(name, value);
  });

  target.dataset.ledgerTheme = scheme;
  target.style.colorScheme = scheme;
};