export const SETTINGS_STORAGE_KEY = 'ledger:settings:v1';

export const loadStoredHighContrastPreference = (): boolean => {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { highContrast?: unknown }) : null;
    return parsed?.highContrast === true;
  } catch {
    return false;
  }
};

export const loadStoredCompactDensityPreference = (): boolean => {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { compactDensity?: unknown }) : null;
    return parsed?.compactDensity === true;
  } catch {
    return false;
  }
};

export const applyHighContrastPreference = (root: HTMLElement, enabled: boolean) => {
  root.dataset.highContrast = enabled ? 'true' : 'false';
};

export const applyCompactDensityPreference = (root: HTMLElement, enabled: boolean) => {
  root.dataset.compactDensity = enabled ? 'true' : 'false';
};
