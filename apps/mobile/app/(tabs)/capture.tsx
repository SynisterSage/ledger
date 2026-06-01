import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { CaptureOptionList } from '@/features/capture/CaptureOptionList';
import { listCaptureOptions } from '@/api/captures';
import { useLedgerTheme } from '@/theme';

export default function CaptureScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();

  return (
    <Screen scroll>
      <AppText variant="screenTitle">Capture</AppText>
      <AppText variant="body" style={{ marginBottom: theme.spacing['2xl'] }}>
        Add something to Ledger.
      </AppText>
      <CaptureOptionList options={listCaptureOptions()} onSelect={(href) => router.push(href)} />
    </Screen>
  );
}
