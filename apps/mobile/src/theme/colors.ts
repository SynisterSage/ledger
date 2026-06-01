// Temporary mobile theme tokens.
// These mirror the Ledger desktop token structure until shared tokens are wired in.
export const lightColors = {
  background: '#FFF9F4',
  backgroundMuted: '#FFF4EA',
  surface: '#FFFFFF',
  surfaceMuted: '#FAF5F0',
  selectedSurface: '#FFF0EA',
  textPrimary: '#111827',
  textSecondary: '#4B5563',
  textMuted: '#6B7280',
  borderSubtle: '#E8DDD4',
  borderStrong: '#D8C6B6',
  accent: '#FF5F40',
  accentSoft: '#FDBA74',
  danger: '#D92D20',
  success: '#12B76A',
  warning: '#DC6803',
  inputBackground: '#FFFDFB',
  placeholder: '#9CA3AF',
  tabBar: '#FFF8F1',
  tabBarBorder: '#E9DDCF',
};

export const darkColors = {
  background: '#0B1220',
  backgroundMuted: '#111A2E',
  surface: '#121B2E',
  surfaceMuted: '#17233B',
  selectedSurface: '#16253B',
  textPrimary: '#F8FAFC',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  borderSubtle: '#26324A',
  borderStrong: '#334155',
  accent: '#FF7A59',
  accentSoft: '#FDBA74',
  danger: '#F97066',
  success: '#32D583',
  warning: '#FDB022',
  inputBackground: '#111A2E',
  placeholder: '#64748B',
  tabBar: '#0E1729',
  tabBarBorder: '#22304A',
};

export type LedgerColorScheme = 'light' | 'dark';
export type LedgerColors = typeof lightColors;
