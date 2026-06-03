import { Redirect } from 'expo-router';

import { useBootState } from '@/store/bootStore';
import { useNotificationOnboardingState } from '@/store/notificationOnboardingStore';
import { useAuthState } from '@/store/sessionStore';

export default function Index() {
  const boot = useBootState();
  const auth = useAuthState();
  const notificationOnboarding = useNotificationOnboardingState();

  const notificationStateReady =
    !auth.session ||
    (notificationOnboarding.userId === auth.user?.id &&
      notificationOnboarding.isHydrated &&
      !notificationOnboarding.isLoading);

  if (!boot.isBootReady || auth.isLoading || notificationOnboarding.isLoading || !notificationStateReady) {
    return null;
  }

  if (!auth.session) {
    return <Redirect href="/auth/welcome" />;
  }

  if (!notificationOnboarding.isComplete) {
    return <Redirect href="/onboarding/notifications" />;
  }

  return <Redirect href="/(tabs)/today" />;
}
