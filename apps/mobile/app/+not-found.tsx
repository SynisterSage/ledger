import { Link } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';

export default function NotFoundScreen() {
  return (
    <Screen>
      <AppText variant="screenTitle">Page not found</AppText>
      <AppText variant="body">This route does not exist in the mobile scaffold.</AppText>
      <Link href="/auth/welcome" asChild>
        <AppButton title="Back to Ledger" />
      </Link>
    </Screen>
  );
}
