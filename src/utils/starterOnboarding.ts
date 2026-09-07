export type StarterOnboardingReturn = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  step: string;
  createdAt: number;
};

export const STARTER_ONBOARDING_RETURN_STORAGE_KEY = 'ledger:starter-onboarding-return:v1';

export const rememberStarterOnboardingReturn = (value: Omit<StarterOnboardingReturn, 'createdAt'>) => {
  try {
    window.localStorage.setItem(
      STARTER_ONBOARDING_RETURN_STORAGE_KEY,
      JSON.stringify({ ...value, createdAt: Date.now() })
    );
  } catch {
    // Onboarding should still open the requested feature if storage is unavailable.
  }
};

export const readStarterOnboardingReturn = (): StarterOnboardingReturn | null => {
  try {
    const raw = window.localStorage.getItem(STARTER_ONBOARDING_RETURN_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StarterOnboardingReturn> | null;
    if (
      typeof value?.workspaceId !== 'string' ||
      typeof value.projectId !== 'string' ||
      typeof value.taskId !== 'string' ||
      typeof value.step !== 'string' ||
      typeof value.createdAt !== 'number'
    ) {
      return null;
    }
    if (Date.now() - value.createdAt > 2 * 60 * 60 * 1000) return null;
    return value as StarterOnboardingReturn;
  } catch {
    return null;
  }
};

export const clearStarterOnboardingReturn = () => {
  try {
    window.localStorage.removeItem(STARTER_ONBOARDING_RETURN_STORAGE_KEY);
  } catch {
    // No-op when storage is unavailable.
  }
};
