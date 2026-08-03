import { Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { AppText } from './AppText';

import { useLedgerTheme } from '@/theme';

type CaptureHeaderProps = {
  title: string;
  rightAccessory?: ReactNode;
};

export function CaptureHeader({ title, rightAccessory }: CaptureHeaderProps) {
  const router = useRouter();
  const theme = useLedgerTheme();

  return (
    <View style={styles.headerRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        hitSlop={12}
        style={({ pressed }) => [
          styles.backButton,
          {
            backgroundColor: pressed ? theme.colors.surfaceSelected : 'transparent',
          },
        ]}
      >
        <SymbolView
          name="chevron.left"
          size={18}
          weight="regular"
          tintColor={theme.colors.textPrimary}
        />
      </Pressable>

      <AppText variant="screenTitle" style={styles.title}>
        {title}
      </AppText>
      {rightAccessory}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  backButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    width: 32,
    height: 32,
  },
  title: {
    flex: 1,
  },
});
