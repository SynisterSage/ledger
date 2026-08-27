export const NORMAL_RAIL_ITEM_IDS = [
  'search',
  'ask-ledger',
  'overview',
  'calendar',
  'projects',
  'notes',
] as const;

export type NormalRailItemId = (typeof NORMAL_RAIL_ITEM_IDS)[number];

export const normalizeNormalRailOrder = (value: unknown): NormalRailItemId[] => {
  const requested = Array.isArray(value) ? value : [];
  const order = requested.filter(
    (item): item is NormalRailItemId =>
      typeof item === 'string' &&
      (NORMAL_RAIL_ITEM_IDS as readonly string[]).includes(item)
  );

  return [
    ...order,
    ...NORMAL_RAIL_ITEM_IDS.filter((item) => !order.includes(item)),
  ];
};
