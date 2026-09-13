export type LensAutoRunMode = 'on_entry' | 'manual';

export type LensPreferences = {
  autoRun: LensAutoRunMode;
};

export const LENS_PREFERENCES_STORAGE_KEY = 'ledger:lens-preferences:v1';
export const LENS_PREFERENCES_CHANGED_EVENT = 'ledger:lens-preferences-changed';

export const defaultLensPreferences: LensPreferences = {
  autoRun: 'on_entry',
};

const normalizeLensPreferences = (value: unknown): LensPreferences => {
  if (!value || typeof value !== 'object') return defaultLensPreferences;
  const autoRun = (value as { autoRun?: unknown }).autoRun;
  return {
    autoRun: autoRun === 'manual' ? 'manual' : 'on_entry',
  };
};

export const loadLensPreferences = (): LensPreferences => {
  try {
    const raw = window.localStorage.getItem(LENS_PREFERENCES_STORAGE_KEY);
    return raw ? normalizeLensPreferences(JSON.parse(raw)) : defaultLensPreferences;
  } catch {
    return defaultLensPreferences;
  }
};

export const saveLensPreferences = (preferences: LensPreferences): LensPreferences => {
  const next = normalizeLensPreferences(preferences);
  try {
    window.localStorage.setItem(LENS_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent<LensPreferences>(LENS_PREFERENCES_CHANGED_EVENT, { detail: next }));
  } catch {
    // Preferences are personal UI state; keep the current renderer usable if storage is unavailable.
  }
  return next;
};

export const subscribeToLensPreferences = (onChange: (preferences: LensPreferences) => void) => {
  const handleCustomEvent = (event: Event) => {
    onChange(normalizeLensPreferences((event as CustomEvent<unknown>).detail));
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== LENS_PREFERENCES_STORAGE_KEY) return;
    try {
      onChange(event.newValue ? normalizeLensPreferences(JSON.parse(event.newValue)) : defaultLensPreferences);
    } catch {
      onChange(defaultLensPreferences);
    }
  };
  window.addEventListener(LENS_PREFERENCES_CHANGED_EVENT, handleCustomEvent);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(LENS_PREFERENCES_CHANGED_EVENT, handleCustomEvent);
    window.removeEventListener('storage', handleStorage);
  };
};
