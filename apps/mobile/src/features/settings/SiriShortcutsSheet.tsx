import { Alert } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { Row } from '@/components/Row';
import { useLedgerTheme } from '@/theme';

type SiriShortcutsSheetProps = {
  visible: boolean;
  onClose: () => void;
};

const shortcuts = [
  {
    title: 'Add Reminder',
    subtitle: '“Hey Siri, add a Ledger reminder.”',
  },
  {
    title: 'Add Task',
    subtitle: '“Hey Siri, add a Ledger task.”',
  },
  {
    title: 'Create Event',
    subtitle: '“Hey Siri, create a Ledger event.”',
  },
  {
    title: 'Save Note',
    subtitle: '“Hey Siri, save a Ledger note.”',
  },
];

export function SiriShortcutsSheet({ visible, onClose }: SiriShortcutsSheetProps) {
  const theme = useLedgerTheme();

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      title="Siri Shortcuts"
      snapPoints={['42%', '66%']}
      initialSnapPointIndex={1}
      dragCloseThreshold={72}
      dragCloseVelocityThreshold={0.65}
      dragCloseSnapMargin={12}>
      <AppText variant="meta" style={{ marginBottom: theme.spacing.xs }}>
        Preview the Siri phrases Ledger will support on iPhone.
      </AppText>
      {shortcuts.map((shortcut) => (
        <Row
          key={shortcut.title}
          title={shortcut.title}
          subtitle={shortcut.subtitle}
          onPress={() => {
            Alert.alert('Coming soon', 'Siri Shortcuts will be available in the native iOS build.');
          }}
          right={<SymbolView name="chevron.right" size={14} weight="regular" tintColor={theme.colors.textMuted} />}
        />
      ))}
    </AppBottomSheet>
  );
}
