import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { getMobileNoteVersions, restoreMobileNoteVersion, type MobileNoteVersion } from '@/api/notes';
import { useLedgerTheme } from '@/theme';

export function NoteVersionSheet({ visible, workspaceId, noteId, onClose, onRestored }: { visible: boolean; workspaceId: string; noteId: string; onClose: () => void; onRestored: (note: unknown) => void }) {
  const theme = useLedgerTheme();
  const [versions, setVersions] = useState<MobileNoteVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!visible) return; setError(null); void getMobileNoteVersions(workspaceId, noteId).then(setVersions).catch((err) => setError(err instanceof Error ? err.message : 'Could not load version history.')); }, [noteId, visible, workspaceId]);
  const restore = (version: MobileNoteVersion) => Alert.alert('Restore this version?', 'The current note will be checkpointed before the historical version replaces it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Restore', onPress: async () => { setBusy(true); try { const restored = await restoreMobileNoteVersion(workspaceId, noteId, version.id); onRestored(restored); onClose(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not restore version.'); } finally { setBusy(false); } } }]);
  return <AppBottomSheet visible={visible} onClose={onClose} title={<AppText variant="sectionTitle">Version history</AppText>} snapPoints={['68%', '88%']} initialSnapPointIndex={0}>{error ? <AppText variant="caption" style={{ color: theme.colors.danger }}>{error}</AppText> : null}<ScrollView contentContainerStyle={styles.content}><View style={[styles.card, { backgroundColor: theme.colors.surfaceMuted }]}>{versions.map((version) => <Pressable key={version.id} disabled={busy} onPress={() => restore(version)} style={styles.row}><AppText variant="body">{version.reason === 'before_edit' ? 'Before edit' : version.reason === 'restore_before' ? 'Before restore' : version.reason === 'delete' ? 'Before delete' : 'Autosave checkpoint'}</AppText><AppText variant="caption">{version.created_at ? new Date(version.created_at).toLocaleString() : 'Unknown time'}</AppText></Pressable>)}{!versions.length && !error ? <AppText variant="caption">No saved versions yet.</AppText> : null}</View></ScrollView></AppBottomSheet>;
}

const styles = StyleSheet.create({ content: { paddingBottom: 24 }, card: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 6 }, row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } });
