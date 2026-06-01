import { Redirect } from 'expo-router';

import { MOCK_AUTHENTICATED } from '@/store/sessionStore';

export default function Index() {
  return <Redirect href={MOCK_AUTHENTICATED ? '/(tabs)/today' : '/auth/welcome'} />;
}
