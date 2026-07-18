export type DesktopThemeScheme = 'light' | 'dark';
export type DesktopThemePreference = DesktopThemeScheme | 'system';

type DesktopColorTokens = {
  background: string;
  backgroundMuted: string;
  surface: string;
  surfaceCard: string;
  surfaceMuted: string;
  menuBackground: string;
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
  card: '0 1px 2px rgba(0, 0, 0, 0.05)',
  surface: '0 14px 42px rgba(0, 0, 0, 0.08)',
  modal: '0 28px 80px rgba(0, 0, 0, 0.12)',
  popover: '0 16px 42px rgba(0, 0, 0, 0.12)',
  accent: '0 10px 26px rgba(255, 95, 64, 0.16)',
} as const;

const sharedStructure = {
  spacing: sharedSpacing,
  typography: sharedTypography,
  radius: sharedRadius,
  shadows: sharedShadows,
} as const;

/**
 * Linear-Inspired Color System
 *
 * Light mode:
 * - Clean, neutral white base
 * - High contrast, tech-forward
 * - Orange accent (#FF5F40) precisely applied
 *
 * Dark mode:
 * - True dark (#0F0F0F), not warm
 * - Elevated surfaces with luminance hierarchy
 * - Adjusted orange (#FF8C5F) for dark mode readability
 */
const lightColors: DesktopColorTokens = {
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

  glassWhite: 'rgba(255, 255, 255, 0.94)',
  glassCream: 'rgba(249, 249, 249, 0.90)',
  glassIconWhite: 'rgba(255, 255, 255, 0.78)',
  glassIconCream: 'rgba(249, 249, 249, 0.74)',
  glassBorder: 'rgba(229, 229, 229, 0.93)',
  glassOutline: 'rgba(0, 0, 0, 0.08)',
  glassShadow:
    '0 30px 90px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(0, 0, 0, 0.04)',
  glassIconShadow:
    '0 14px 38px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.85)',
  glassHighlight: 'rgba(255, 255, 255, 0.75)',
  glassSheen: 'rgba(255, 255, 255, 0.40)',

  glassSolidBackground: 'rgba(255, 255, 255, 0.97)',
  glassSolidBorder: 'rgba(229, 229, 229, 0.92)',

  modalBackdrop: 'rgba(10, 10, 10, 0.4)',

  scrollbarThumb: 'rgb(200 200 200)',
  scrollbarThumbHover: 'rgb(150 150 150)',
};

const darkColors: DesktopColorTokens = {
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

  glassWhite: 'rgba(26, 26, 26, 0.85)',
  glassCream: 'rgba(30, 30, 30, 0.92)',
  glassIconWhite: 'rgba(26, 26, 26, 0.75)',
  glassIconCream: 'rgba(30, 30, 30, 0.84)',
  glassBorder: 'rgba(100, 100, 100, 0.20)',
  glassOutline: 'rgba(100, 100, 100, 0.10)',
  glassShadow:
    '0 32px 90px rgba(0, 0, 0, 0.40), inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(100, 100, 100, 0.06)',
  glassIconShadow:
    '0 14px 38px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
  glassHighlight: 'rgba(100, 100, 100, 0.10)',
  glassSheen: 'rgba(100, 100, 100, 0.12)',

  glassSolidBackground: 'rgba(26, 26, 26, 0.96)',
  glassSolidBorder: 'rgba(100, 100, 100, 0.18)',

  modalBackdrop: 'rgba(15, 15, 15, 0.65)',

  scrollbarThumb: 'rgb(80 80 80)',
  scrollbarThumbHover: 'rgb(110 110 110)',
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

export const resolveDesktopThemeScheme = (
  preference: DesktopThemePreference | undefined,
  systemScheme: DesktopThemeScheme = getSystemDesktopThemeScheme()
): DesktopThemeScheme => {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }

  return systemScheme;
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
    '--ledger-menu-background': colors.menuBackground,
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
