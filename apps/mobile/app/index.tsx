import { Redirect } from 'expo-router';

import { useBootState } from '@/store/bootStore';
import { useAuthState } from '@/store/sessionStore';

export default function Index() {
  const boot = useBootState();
  const auth = useAuthState();

  if (!boot.isBootReady || auth.isLoading) {
    return null;
  }

  return <Redirect href={auth.session ? '/(tabs)/today' : '/auth/welcome'} />;
}
