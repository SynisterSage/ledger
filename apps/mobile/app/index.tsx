import { Redirect } from 'expo-router';

import { useAuthState } from '@/store/sessionStore';

export default function Index() {
  const auth = useAuthState();

  if (auth.isLoading) {
    return null;
  }

  return <Redirect href={auth.session ? '/(tabs)/today' : '/auth/welcome'} />;
}
