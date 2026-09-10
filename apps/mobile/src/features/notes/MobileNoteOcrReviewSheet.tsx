import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

export function MobileNoteOcrReviewSheet({ visible, busy, text, error, onChangeText, onClose, onInsert }: { visible: boolean; busy: boolean; text: string; error: string | null; onChangeText: (value: string) => void; onClose: () => void; onInsert: () => void }) {
  const theme = useLedgerTheme();
  return <AppBottomSheet visible={visible} onClose={onClose} title={<AppText variant="sectionTitle">Scan text from image</AppText>} snapPoints={['64%', '88%']} initialSnapPointIndex={1}>
    <View style={styles.content}>
      {busy ? <View style={styles.loading}><ActivityIndicator color={theme.colors.accent} /><AppText variant="caption">Reading the image on this device…</AppText></View> : error ? <AppText variant="caption" style={{ color: theme.colors.danger }}>{error}</AppText> : <>
        <AppText variant="caption" style={styles.hint}>Review the transcription before adding it to this note.</AppText>
        <TextInput multiline textAlignVertical="top" value={text} onChangeText={onChangeText} placeholder="No text found" placeholderTextColor={theme.colors.placeholder} style={[styles.input, { color: theme.colors.textPrimary, backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle }]} />
      </>}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondary}><AppText variant="body">Cancel</AppText></Pressable>
        <Pressable accessibilityRole="button" disabled={busy || !text.trim() || Boolean(error)} onPress={onInsert} style={[styles.primary, { backgroundColor: theme.colors.accent, opacity: busy || !text.trim() || Boolean(error) ? 0.45 : 1 }]}><AppText variant="bodyStrong" style={{ color: '#fff' }}>Insert into note</AppText></Pressable>
      </View>
    </View>
  </AppBottomSheet>;
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: 14 },
  hint: { color: '#64748B' },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  input: { flex: 1, minHeight: 220, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, fontSize: 16, lineHeight: 24 },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  secondary: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  primary: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 14 },
});
