import type { Config } from 'tailwindcss';
import { desktopTokens } from './src/theme/desktopTokens';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ledger: {
          background: desktopTokens.colors.background,
          backgroundMuted: desktopTokens.colors.backgroundMuted,
          surface: desktopTokens.colors.surface,
          surfaceMuted: desktopTokens.colors.surfaceMuted,
          surfaceSelected: desktopTokens.colors.surfaceSelected,
          textPrimary: desktopTokens.colors.textPrimary,
          textSecondary: desktopTokens.colors.textSecondary,
          textMuted: desktopTokens.colors.textMuted,
          borderSubtle: desktopTokens.colors.borderSubtle,
          borderStrong: desktopTokens.colors.borderStrong,
          accent: desktopTokens.colors.accent,
          accentHover: desktopTokens.colors.accentHover,
          accentSoft: desktopTokens.colors.accentSoft,
          danger: desktopTokens.colors.danger,
          success: desktopTokens.colors.success,
          warning: desktopTokens.colors.warning,
          inputBackground: desktopTokens.colors.inputBackground,
          placeholder: desktopTokens.colors.placeholder,
          tabBar: desktopTokens.colors.tabBar,
          tabBarBorder: desktopTokens.colors.tabBarBorder,
        },
      },
      fontFamily: {
        display: ['SF Pro Display', 'SF Pro Text', 'system-ui', 'sans-serif'],
        text: ['SF Pro Text', 'SF Pro Display', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        ledgerControl: `${desktopTokens.radius.control}px`,
        ledgerSurface: `${desktopTokens.radius.surface}px`,
        ledgerSheet: `${desktopTokens.radius.sheet}px`,
        ledgerWindow: `${desktopTokens.radius.window}px`,
      },
      boxShadow: {
        ledgerCard: desktopTokens.shadows.card,
        ledgerSurface: desktopTokens.shadows.surface,
        ledgerModal: desktopTokens.shadows.modal,
        ledgerPopover: desktopTokens.shadows.popover,
      },
      backdropBlur: {
        xs: '2px',
        sm: '4px',
        md: '12px',
        lg: '16px',
        xl: '24px',
      },
      backgroundColor: {
        glass: 'rgba(255, 255, 255, 0.7)',
        'glass-dark': 'rgba(0, 0, 0, 0.4)',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
} satisfies Config;
