import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';
import { importMobileLocalFile, listMobileLocalFiles, removeMobileLocalFile, type MobileLocalFile } from '@/features/files/mobileLocalFiles';
import { useAuthState } from '@/store/sessionStore';
import { useWorkspaceState } from '@/store/workspaceStore';

export default function FilesScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const auth = useAuthState();
  const workspaceState = useWorkspaceState();
  const userId = auth.user?.id ?? '';
  const workspaceId = workspaceState.selectedWorkspaceId ?? '';
  const [files, setFiles] = useState<MobileLocalFile[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !workspaceId) { setFiles([]); return; }
    setFiles(await listMobileLocalFiles(userId, workspaceId));
  }, [userId, workspaceId]);
  useEffect(() => { void load(); }, [load]);

  const importFile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (!result.canceled && result.assets[0] && userId && workspaceId) await importMobileLocalFile(result.assets[0], userId, workspaceId);
      await load();
    } catch {
      Alert.alert('Could not add file', 'Try selecting the file again.');
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (file: MobileLocalFile) => {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('File saved on this device', 'This device does not provide a share or preview action for this file.');
      return;
    }
    await Sharing.shareAsync(file.uri, { mimeType: file.mimeType ?? undefined, dialogTitle: file.name });
  };

  const deleteFile = (file: MobileLocalFile) => Alert.alert('Remove local file?', `${file.name} will be removed from Ledger on this device.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { if (userId && workspaceId) await removeMobileLocalFile(file.id, userId, workspaceId); await load(); } },
  ]);

  return <Screen scroll contentStyle={{ paddingTop: 18 }}>
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back"><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.colors.textPrimary} /></Pressable>
      <View style={styles.headerCopy}><AppText variant="screenTitle">Files & links</AppText><AppText variant="caption" style={{ color: theme.colors.textSecondary }}>Keep private files on the device you’re using.</AppText></View>
    </View>
    <View style={[styles.notice, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle }]}><SymbolView name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }} size={16} tintColor={theme.colors.accent} /><AppText variant="caption" style={{ color: theme.colors.textSecondary, flex: 1 }}>Files added here are copied into Ledger’s private app storage. They are not uploaded or synced.</AppText></View>
    <View style={styles.section}><View style={styles.sectionHeader}><AppText variant="sectionTitle">On this device</AppText><Pressable onPress={() => void importFile()} disabled={busy} accessibilityRole="button"><AppText variant="button" style={{ color: theme.colors.accent }}>{busy ? 'Adding…' : 'Add file'}</AppText></Pressable></View>{files.length ? files.map((file) => <View key={file.id} style={[styles.row, { borderBottomColor: theme.colors.borderSubtle }]}><Pressable onPress={() => void openFile(file)} style={styles.rowMain}><SymbolView name={{ ios: 'doc', android: 'description', web: 'description' }} size={18} tintColor={theme.colors.textMuted} /><View style={styles.rowCopy}><AppText variant="body" numberOfLines={1}>{file.name}</AppText><AppText variant="meta" style={{ color: theme.colors.textMuted }}>Private to this device</AppText></View></Pressable><Pressable onPress={() => deleteFile(file)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${file.name}`}><SymbolView name={{ ios: 'trash', android: 'delete_outline', web: 'delete' }} size={17} tintColor={theme.colors.textMuted} /></Pressable></View>) : <AppText variant="caption" style={{ color: theme.colors.textSecondary }}>No local files yet. Add a file when you need it beside a Ledger capture.</AppText>}</View>
    <View style={styles.section}><AppText variant="sectionTitle">Connected links</AppText><AppText variant="caption" style={{ color: theme.colors.textSecondary }}>Drive, Figma, and other connected content stays linked to its original service. Open it from the related note or project in Ledger.</AppText></View>
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 24 },
  headerCopy: { flex: 1, gap: 4 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, marginBottom: 28 },
  section: { gap: 12, marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowCopy: { flex: 1, gap: 2 },
});
