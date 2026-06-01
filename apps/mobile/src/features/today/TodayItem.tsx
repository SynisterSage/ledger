import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

type TodayItemProps = {
  title: string;
  subtitle: string;
};

export function TodayItem({ title, subtitle }: TodayItemProps) {
  const theme = useLedgerTheme();

  return (
    <View
      style={[
        styles.row,
        {
          borderBottomColor: theme.colors.borderSubtle,
          paddingVertical: theme.spacing.md,
        },
      ]}>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="body">{title}</AppText>
        <AppText variant="meta">{subtitle}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
