export const typography = {
  screenTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700' as const,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700' as const,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  bodyStrong: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as const,
  },
  button: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600' as const,
  },
};

export type LedgerTypography = typeof typography;
