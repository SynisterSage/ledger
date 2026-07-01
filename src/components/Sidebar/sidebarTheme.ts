const accentFocus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-accent)]/20';

export const sidebarTheme = {
  shellFallback:
    'border border-[color:var(--ledger-border-subtle)] shadow-[0_10px_28px_rgba(17,24,39,0.12)] outline outline-[rgba(17,24,39,0.06)]',
  shellRail: 'bg-transparent',
  surface:
    'rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]',
  surfaceSoft:
    'rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] shadow-[0_4px_12px_rgba(17,24,39,0.04)]',
  popover:
    'rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] shadow-[0_12px_32px_rgba(17,24,39,0.12)]',
  menu:
    'fixed z-50 rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] py-1 shadow-[0_12px_32px_rgba(17,24,39,0.12)]',
  menuItem:
    'w-full text-left px-4 py-2 text-sm text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] flex items-center gap-2',
  menuItemAccent:
    'w-full text-left px-4 py-2 text-sm text-[var(--ledger-accent)] transition hover:bg-[var(--ledger-surface-hover)] flex items-center gap-2',
  menuItemDanger:
    'w-full text-left px-4 py-2 text-sm text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.08)] flex items-center gap-2',
  railIcon:
    `inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-150 active:scale-95 ${accentFocus}`,
  railIconNeutral:
    'bg-transparent text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  railIconDanger:
    'bg-transparent text-[var(--ledger-danger)] hover:bg-[color:rgba(217,45,32,0.08)] hover:text-[var(--ledger-danger)]',
  buttonPrimary:
    'inline-flex items-center justify-center rounded-lg bg-[var(--ledger-accent)] text-white transition hover:bg-[var(--ledger-accent-hover)]',
  buttonSecondary:
    'inline-flex items-center justify-center rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]',
  buttonDanger:
    'inline-flex items-center justify-center rounded-lg border border-[color:rgba(217,45,32,0.18)] bg-[color:rgba(217,45,32,0.08)] text-[var(--ledger-danger)] transition hover:bg-[color:rgba(217,45,32,0.12)]',
  field:
    'rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-input-background)] text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:outline-none focus:ring-1 focus:ring-[color:var(--ledger-accent)]/10',
  fieldMuted:
    'rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-primary)] placeholder:text-[var(--ledger-placeholder)] focus:border-[color:var(--ledger-border-strong)] focus:outline-none focus:ring-1 focus:ring-[color:var(--ledger-accent)]/10',
  sectionLabel:
    'text-[11px] font-semibold text-[var(--ledger-text-muted)]',
  textPrimary: 'text-[var(--ledger-text-primary)]',
  textSecondary: 'text-[var(--ledger-text-secondary)]',
  textMuted: 'text-[var(--ledger-text-muted)]',
  subtleBorder: 'border-[color:var(--ledger-border-subtle)]',
  strongBorder: 'border-[color:var(--ledger-border-strong)]',
  accent: 'text-[var(--ledger-accent)]',
  selectedSurface: 'bg-[var(--ledger-surface-selected)]',
  hoverSurface: 'bg-[var(--ledger-surface-hover)]',
  mutedSurface: 'bg-[var(--ledger-surface-muted)]',
  inputSurface: 'bg-[var(--ledger-input-background)]',
} as const;
