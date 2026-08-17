const LOW_VALUE_ACTIVITY_ACTIONS = new Set([
  'external_reference_resolved',
  'figma_linked_work_viewed',
  'notification_read',
  'notification_dismissed',
  'background_sync',
  'provider_poll',
]);

export const isMeaningfulActivityAction = (action) => {
  const value = String(action ?? '').trim();
  return Boolean(value) && !LOW_VALUE_ACTIVITY_ACTIONS.has(value);
};

export const normalizeActivityItem = (item) => ({
  id: String(item.id),
  type: String(item.type ?? 'activity'),
  label: String(item.label ?? 'Activity'),
  actor_id: item.actor_id ?? null,
  source: item.source ?? null,
  provider: item.provider ?? null,
  primary: item.primary ?? null,
  project_id: item.project_id ?? null,
  route: item.route ?? null,
  metadata: item.metadata ?? null,
  at: item.at ?? null,
});

export const dedupeActivityItems = (items) => {
  const byKey = new Map();
  for (const item of items) {
    const normalized = normalizeActivityItem(item);
    const primary = normalized.primary ?? {};
    const key = item.dedupe_key
      ?? `${normalized.type}:${primary.type ?? ''}:${primary.id ?? normalized.id}:${normalized.at ?? ''}`;
    if (!byKey.has(key)) byKey.set(key, normalized);
  }
  return [...byKey.values()].sort((left, right) => {
    const leftTime = left.at ? new Date(left.at).getTime() : 0;
    const rightTime = right.at ? new Date(right.at).getTime() : 0;
    return rightTime - leftTime;
  });
};
