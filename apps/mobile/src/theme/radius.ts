export const radius = {
  control: 12,
  surface: 16,
  sheet: 24,
  pill: 999,
  window: 18,
};

/**
 * Resolves the fallback geometry for a surface nested inside a rounded
 * container. Apple’s concentric rectangle uses the same relationship: the
 * inner radius follows the parent corner center, so its radius decreases by
 * the inset from the parent corner.
 *
 * This is the React Native fallback for platforms that cannot resolve a
 * container shape natively.
 */
export function concentricRadius(containerRadius: number, inset: number, minimumRadius = 0) {
  return Math.max(
    minimumRadius,
    Math.min(containerRadius, Math.max(0, containerRadius - Math.max(0, inset))),
  );
}

export type LedgerRadius = typeof radius;
