const moduleWindowKinds = new Set([
  'new-tab',
  'circle',
  'calendar',
  'notes',
  'projects',
  'teams',
  'dashboard',
  'notifications',
  'settings',
  'inbox',
  'slack',
  'files',
  'quick-follow-up',
  'quick-task',
  'quick-note',
  'quick-event',
  'quick-reminder',
]);

const hasUnsafeControlCharacters = (value: string) => /[\u0000-\u001F\u007F]/.test(value);

export const isValidModuleWindowKind = (value: unknown): value is string =>
  typeof value === 'string' && moduleWindowKinds.has(value);

export const boundedOptionalString = (value: unknown, maxLength: number) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maxLength || hasUnsafeControlCharacters(value)) {
    return undefined;
  }
  return value;
};

export const boundedPerformanceDetails = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (!/^[a-zA-Z0-9_.-]{1,60}$/.test(key)) continue;
    if (item === null || typeof item === 'boolean') result[key] = item;
    else if (typeof item === 'number' && Number.isFinite(item)) result[key] = item;
    else if (typeof item === 'string' && item.length <= 200 && !hasUnsafeControlCharacters(item))
      result[key] = item;
  }
  return result;
};
