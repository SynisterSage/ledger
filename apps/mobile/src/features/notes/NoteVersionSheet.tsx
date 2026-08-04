import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { getMobileNoteVersions, restoreMobileNoteVersion, type MobileNoteVersion } from '@/api/notes';
import { useLedgerTheme } from '@/theme';

export function NoteVersionSheet({ visible, workspaceId, noteId, onClose, onRestored }: { visible: boolean; workspaceId: string; noteId: string; onClose: () => void; onRestored: (note: unknown) => void }) {
  const theme = useLedgerTheme();
  const [versions, setVersions] = useState<MobileNoteVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<MobileNoteVersion | null>(null);
  useEffect(() => { if (!visible) { setSelectedVersion(null); return; } setError(null); void getMobileNoteVersions(workspaceId, noteId).then(setVersions).catch((err) => setError(err instanceof Error ? err.message : 'Could not load version history.')); }, [noteId, visible, workspaceId]);
  const restore = async () => {
    if (!selectedVersion) return;
    setBusy(true);
    try {
      const restored = await restoreMobileNoteVersion(workspaceId, noteId, selectedVersion.id);
      onRestored(restored);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore version.');
    } finally {
      setBusy(false);
    }
  };
  const confirmRestore = () => {
    if (!selectedVersion || busy) return;
    Alert.alert(
      'Restore this version?',
      'The current note will be checkpointed before this historical version replaces it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', style: 'destructive', onPress: () => void restore() },
      ],
    );
  };
  const versionLabel = (version: MobileNoteVersion) => version.reason === 'before_edit' ? 'Before edit' : version.reason === 'restore_before' ? 'Before restore' : version.reason === 'delete' ? 'Before delete' : 'Autosave checkpoint';
  const previewText = selectedVersion ? String(selectedVersion.content_html ?? selectedVersion.content ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/div>|<\/h[1-6]>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\n\s*\n+/g, '\n\n').trim() : '';
  return <AppBottomSheet
    visible={visible}
    onClose={onClose}
    title={selectedVersion ? <View style={styles.sheetTitle}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to version history" disabled={busy} onPress={() => setSelectedVersion(null)} hitSlop={8}>
        <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={22} tintColor={theme.colors.textPrimary} />
      </Pressable>
      <AppText variant="sectionTitle">Preview version</AppText>
    </View> : <AppText variant="sectionTitle">Version history</AppText>}
    headerAccessory={selectedVersion ? <Pressable accessibilityRole="button" accessibilityLabel="Restore this version" disabled={busy} onPress={confirmRestore} hitSlop={8}>
      <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={24} tintColor={theme.colors.accent} />
    </Pressable> : undefined}
    snapPoints={['74%', '88%']}
    initialSnapPointIndex={0}
  >
    {error ? <AppText variant="caption" style={{ color: theme.colors.danger }}>{error}</AppText> : null}
    {selectedVersion ? <View style={styles.previewShell}>
      <AppText variant="sectionTitle" numberOfLines={2}>{selectedVersion.title || 'Untitled note'}</AppText>
      <AppText variant="caption" style={{ color: theme.colors.textMuted }}>{versionLabel(selectedVersion)} · {selectedVersion.created_at ? new Date(selectedVersion.created_at).toLocaleString() : 'Unknown time'}</AppText>
      <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}><AppText variant="body">{previewText || 'This version has no written content.'}</AppText></ScrollView>
    </View> : <ScrollView contentContainerStyle={styles.content}><View style={[styles.card, { backgroundColor: theme.colors.surfaceMuted }]}>{versions.map((version) => <Pressable key={version.id} disabled={busy} onPress={() => setSelectedVersion(version)} style={styles.row}><View style={styles.rowCopy}><AppText variant="body">{versionLabel(version)}</AppText><AppText variant="caption" style={{ color: theme.colors.textMuted }}>{version.title || 'Untitled note'}</AppText></View><AppText variant="caption">{version.created_at ? new Date(version.created_at).toLocaleString() : 'Unknown time'}</AppText></Pressable>)}{!versions.length && !error ? <AppText variant="caption">No saved versions yet.</AppText> : null}</View></ScrollView>}
  </AppBottomSheet>;
}

const styles = StyleSheet.create({ content: { paddingBottom: 24 }, card: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 6 }, row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, rowCopy: { flex: 1, minWidth: 0, gap: 2 }, sheetTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 }, previewShell: { flex: 1, gap: 8 }, previewScroll: { flex: 1, marginTop: 8, borderRadius: 16, backgroundColor: 'rgba(127,127,127,0.08)' }, previewContent: { padding: 16 } });
