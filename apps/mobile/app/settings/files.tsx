import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { useLedgerTheme } from '@/theme';
import {
  importMobileLocalFile,
  createMobileLocalFolder,
  listMobileLocalFiles,
  listMobileLocalFolders,
  moveMobileLocalFile,
  removeMobileLocalFolder,
  removeMobileLocalFile,
  renameMobileLocalFolder,
  type MobileLocalFile,
  type MobileLocalFolder,
} from '@/features/files/mobileLocalFiles';
import { useAuthState } from '@/store/sessionStore';
import { useWorkspaceState } from '@/store/workspaceStore';
import { getMobileConnectedLinks, type MobileConnectedLink } from '@/api/files';
import {
  hasIntegrationProviderIcon,
  IntegrationProviderIcon,
} from '@/features/projects/IntegrationProviderIcon';

export default function FilesScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const auth = useAuthState();
  const workspaceState = useWorkspaceState();
  const userId = auth.user?.id ?? '';
  const workspaceId = workspaceState.selectedWorkspaceId ?? '';
  const [files, setFiles] = useState<MobileLocalFile[]>([]);
  const [folders, setFolders] = useState<MobileLocalFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderAction, setFolderAction] = useState<MobileLocalFolder | null>(null);
  const [fileAction, setFileAction] = useState<MobileLocalFile | null>(null);
  const [folderEditor, setFolderEditor] = useState<'create' | 'rename' | null>(null);
  const [folderName, setFolderName] = useState('');
  const [links, setLinks] = useState<MobileConnectedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (!userId || !workspaceId) {
      setFiles([]);
      setFolders([]);
      setLinks([]);
      setLoading(false);
      return;
    }
    try {
      const [localFiles, localFolders, connectedLinks] = await Promise.all([
        listMobileLocalFiles(userId, workspaceId),
        listMobileLocalFolders(userId, workspaceId),
        getMobileConnectedLinks(workspaceId).catch(() => []),
      ]);
      setFiles(localFiles);
      setFolders(localFolders);
      setLinks(connectedLinks);
    } finally {
      setLoading(false);
    }
  }, [userId, workspaceId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const importFile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled && result.assets[0] && userId && workspaceId)
        await importMobileLocalFile(result.assets[0], userId, workspaceId, currentFolderId);
      await load();
    } catch {
      Alert.alert('Could not add file', 'Try selecting the file again.');
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (file: MobileLocalFile) => {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert(
        'File saved on this device',
        'This device does not provide a share or preview action for this file.'
      );
      return;
    }
    try {
      await Sharing.shareAsync(file.uri, {
        mimeType: file.mimeType ?? undefined,
        dialogTitle: file.name,
      });
    } catch {
      Alert.alert(
        'Could not open file',
        'This local copy is no longer accessible. Remove it and add the file again.'
      );
    }
  };

  const deleteFile = (file: MobileLocalFile) =>
    Alert.alert('Remove local file?', `${file.name} will be removed from Ledger on this device.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            if (userId && workspaceId) await removeMobileLocalFile(file.id, userId, workspaceId);
            await load();
          } catch {
            Alert.alert('Could not remove file', 'Please try again.');
          }
        },
      },
    ]);

  const saveFolder = async () => {
    if (!userId || !workspaceId || !folderName.trim()) return;
    setBusy(true);
    try {
      if (folderEditor === 'rename' && folderAction) {
        await renameMobileLocalFolder(folderAction.id, folderName, userId, workspaceId);
      } else {
        await createMobileLocalFolder(folderName, userId, workspaceId);
      }
      setFolderEditor(null);
      setFolderAction(null);
      setFolderName('');
      await load();
    } catch (error) {
      Alert.alert('Could not save folder', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = (folder: MobileLocalFolder) => {
    setFolderAction(null);
    Alert.alert('Delete folder?', 'Files in this folder will stay on this device and move to the top level.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          if (userId && workspaceId) await removeMobileLocalFolder(folder.id, userId, workspaceId);
          if (currentFolderId === folder.id) setCurrentFolderId(null);
          await load();
        } catch { Alert.alert('Could not delete folder', 'Please try again.'); }
      } },
    ]);
  };

  const moveFile = (file: MobileLocalFile) => {
    setFileAction(file);
  };

  const moveFileTo = async (folderId: string | null) => {
    if (!fileAction || !userId || !workspaceId) return;
    setBusy(true);
    try {
      await moveMobileLocalFile(fileAction.id, folderId, userId, workspaceId);
      setFileAction(null);
      await load();
    } catch {
      Alert.alert('Could not move file', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const visibleFiles = files.filter((file) => (file.folderId ?? null) === currentFolderId);
  const currentFolder = folders.find((folder) => folder.id === currentFolderId);
  const visibleFolders = currentFolderId ? [] : folders;

  // This page has a static title at the top; the shared scroll fade would sit
  // above it and wash out “Files & links” before the user has scrolled.
  return (
    <Screen scroll topFade={false} contentStyle={{ paddingTop: 18 }}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerBack}
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            size={22}
            tintColor={theme.colors.textPrimary}
          />
        </Pressable>
        <View style={styles.headerCopy}>
          <AppText variant="screenTitle">Files & links</AppText>
          <AppText variant="caption" style={{ color: theme.colors.textSecondary }}>
            Keep private files on the device you’re using.
          </AppText>
        </View>
      </View>
      <View
        style={[
          styles.notice,
          { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle },
        ]}
      >
        <SymbolView
          name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }}
          size={16}
          tintColor={theme.colors.accent}
        />
        <AppText variant="caption" style={{ color: theme.colors.textSecondary, flex: 1 }}>
          Files added here are copied into Ledger’s private app storage. They are not uploaded or
          synced.
        </AppText>
      </View>
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            {currentFolder ? <Pressable onPress={() => setCurrentFolderId(null)} hitSlop={8} accessibilityLabel="Back to all folders"><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={18} tintColor={theme.colors.textSecondary} /></Pressable> : null}
            <AppText variant="sectionTitle">{currentFolder?.name ?? 'On this device'}</AppText>
          </View>
          <View style={styles.headerActions}>
            {!currentFolder ? <Pressable onPress={() => { setFolderName(''); setFolderEditor('create'); }} accessibilityRole="button"><AppText variant="button" style={{ color: theme.colors.textSecondary }}>New folder</AppText></Pressable> : null}
            <Pressable onPress={() => void importFile()} disabled={busy} accessibilityRole="button">
            <AppText variant="button" style={{ color: theme.colors.accent }}>
              {busy ? 'Adding…' : 'Add file'}
            </AppText>
            </Pressable>
          </View>
        </View>
        {loading ? (
          <FilesLinksSkeleton theme={theme} />
        ) : visibleFolders.length || visibleFiles.length ? (
          <>
          {visibleFolders.map((folder) => (
            <Pressable key={folder.id} onPress={() => setCurrentFolderId(folder.id)} style={({ pressed }) => [styles.row, { borderBottomColor: theme.colors.borderSubtle, opacity: pressed ? 0.68 : 1 }]} accessibilityRole="button" accessibilityLabel={`Open folder ${folder.name}`}>
              <SymbolView name={{ ios: 'folder', android: 'folder', web: 'folder' }} size={19} tintColor={theme.colors.accent} />
              <View style={styles.rowCopy}><AppText variant="body" numberOfLines={1}>{folder.name}</AppText><AppText variant="meta" style={{ color: theme.colors.textMuted }}>{files.filter((file) => file.folderId === folder.id).length} files</AppText></View>
              <Pressable style={styles.rowAction} onPress={(event) => { event.stopPropagation(); setFolderAction(folder); }} hitSlop={4} accessibilityRole="button" accessibilityLabel={`More actions for ${folder.name}`}><SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={19} tintColor={theme.colors.textSecondary} /></Pressable>
            </Pressable>
          ))}
          {visibleFiles.map((file) => (
            <View
              key={file.id}
              style={[styles.row, { borderBottomColor: theme.colors.borderSubtle }]}
            >
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/settings/files/[id]', params: { id: file.id } })
                }
                style={styles.rowMain}
                onLongPress={() => moveFile(file)}
              >
                <SymbolView
                  name={{ ios: 'doc', android: 'description', web: 'description' }}
                  size={18}
                  tintColor={theme.colors.textMuted}
                />
                <View style={styles.rowCopy}>
                  <AppText variant="body" numberOfLines={1}>
                    {file.name}
                  </AppText>
                  <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
                    Private to this device
                  </AppText>
                </View>
              </Pressable>
              <Pressable
                onPress={() => moveFile(file)}
                style={styles.rowAction}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`Move ${file.name}`}
              >
                <SymbolView
                  name={{ ios: 'folder', android: 'folder', web: 'folder' }}
                  size={17}
                  tintColor={theme.colors.textSecondary}
                />
              </Pressable>
              <Pressable
                onPress={() => deleteFile(file)}
                style={styles.rowAction}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${file.name}`}
              >
                <SymbolView
                  name={{ ios: 'trash', android: 'delete_outline', web: 'delete' }}
                  size={17}
                  tintColor={theme.colors.textMuted}
                />
              </Pressable>
            </View>
          ))}
          </>
        ) : (
          <View
            style={[
              styles.emptyState,
              {
                backgroundColor: theme.colors.surfaceMuted,
                borderColor: theme.colors.borderSubtle,
              },
            ]}
          >
            <SymbolView
              name={{ ios: 'doc.badge.plus', android: 'note_add', web: 'note_add' }}
              size={22}
              tintColor={theme.colors.accent}
            />
            <View style={styles.emptyCopy}>
              <AppText variant="bodyStrong">No files saved here yet</AppText>
              <AppText variant="caption" style={{ color: theme.colors.textSecondary }}>
                Add a file when you need it beside a Ledger capture.
              </AppText>
            </View>
          </View>
        )}
      </View>
      {!currentFolder ? <View style={styles.section}>
        <AppText variant="sectionTitle">Connected links</AppText>
        {loading ? (
          <FilesLinksSkeleton theme={theme} />
        ) : links.length ? (
          links.map((link) => (
            <Pressable
              key={link.id}
              onPress={() =>
                link.external_url ? void Linking.openURL(link.external_url) : undefined
              }
              style={[styles.row, { borderBottomColor: theme.colors.borderSubtle }]}
            >
              {hasIntegrationProviderIcon(link.provider) ? (
                <IntegrationProviderIcon provider={link.provider} />
              ) : (
                <SymbolView
                  name={{ ios: 'link', android: 'link', web: 'link' }}
                  size={18}
                  tintColor={theme.colors.accent}
                />
              )}
              <View style={styles.rowCopy}>
                <AppText variant="body" numberOfLines={1}>
                  {linkTitle(link)}
                </AppText>
                <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
                  {providerLabel(link.provider)}
                </AppText>
              </View>
              <SymbolView
                name={{ ios: 'arrow.up.right', android: 'open_in_new', web: 'open_in_new' }}
                size={16}
                tintColor={theme.colors.textMuted}
              />
            </Pressable>
          ))
        ) : (
          <View
            style={[
              styles.emptyState,
              {
                backgroundColor: theme.colors.surfaceMuted,
                borderColor: theme.colors.borderSubtle,
              },
            ]}
          >
            <SymbolView
              name={{ ios: 'link', android: 'link', web: 'link' }}
              size={22}
              tintColor={theme.colors.accent}
            />
            <View style={styles.emptyCopy}>
              <AppText variant="bodyStrong">No connected links yet</AppText>
              <AppText variant="caption" style={{ color: theme.colors.textSecondary }}>
                Links from notes and projects will stay connected to their original service.
              </AppText>
            </View>
          </View>
        )}
      </View> : null}
      <AppBottomSheet visible={Boolean(folderEditor)} onClose={() => { setFolderEditor(null); setFolderAction(null); }} title={<AppText variant="sectionTitle">{folderEditor === 'rename' ? 'Rename folder' : 'New folder'}</AppText>} headerAccessory={<Pressable onPress={() => void saveFolder()} disabled={busy || !folderName.trim()} hitSlop={8} accessibilityLabel="Save folder"><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={22} tintColor={busy || !folderName.trim() ? theme.colors.textMuted : theme.colors.accent} /></Pressable>} snapPoints={['34%', '48%']} initialSnapPointIndex={0}>
        <View style={[styles.inputCard, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle }]}><TextInput autoFocus value={folderName} onChangeText={setFolderName} onSubmitEditing={() => void saveFolder()} placeholder="Folder name" placeholderTextColor={theme.colors.placeholder} style={[styles.folderInput, { color: theme.colors.textPrimary }]} /></View>
      </AppBottomSheet>
      <AppBottomSheet visible={Boolean(folderAction) && !folderEditor} onClose={() => setFolderAction(null)} title={<AppText variant="sectionTitle">{folderAction?.name ?? 'Folder'}</AppText>} snapPoints={['34%', '54%']} initialSnapPointIndex={0}>
        <View style={[styles.sheetCard, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle }]}>
          {folderAction && folders.some((folder) => folder.id === folderAction.id) ? <>
            <Pressable style={styles.actionRow} onPress={() => { setFolderName(folderAction.name); setFolderEditor('rename'); }}><AppText variant="body">Rename folder</AppText><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.colors.textMuted} /></Pressable>
            <Pressable style={styles.actionRow} onPress={() => deleteFolder(folderAction)}><AppText variant="body" style={{ color: theme.colors.danger }}>Delete folder</AppText></Pressable>
          </> : null}
        </View>
      </AppBottomSheet>
      <AppBottomSheet visible={Boolean(fileAction)} onClose={() => setFileAction(null)} title={<AppText variant="sectionTitle">Move file</AppText>} snapPoints={['42%', '72%']} initialSnapPointIndex={0}>
        <View style={[styles.sheetCard, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle }]}>
          <AppText variant="caption" style={styles.moveHint} numberOfLines={2}>{fileAction?.name ?? ''}</AppText>
          <Pressable style={styles.actionRow} onPress={() => void moveFileTo(null)} disabled={busy}><AppText variant="body">On this device</AppText>{!fileAction?.folderId ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={18} tintColor={theme.colors.accent} /> : null}</Pressable>
          {folders.filter((folder) => folder.id !== fileAction?.folderId).map((folder) => <Pressable key={folder.id} style={styles.actionRow} onPress={() => void moveFileTo(folder.id)} disabled={busy}><AppText variant="body" numberOfLines={1}>{folder.name}</AppText><SymbolView name={{ ios: 'folder', android: 'folder', web: 'folder' }} size={18} tintColor={theme.colors.accent} /></Pressable>)}
        </View>
      </AppBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 24 },
  headerBack: { marginTop: 7 },
  headerCopy: { flex: 1, gap: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    marginBottom: 28,
  },
  section: { gap: 12, marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowCopy: { flex: 1, gap: 2 },
  rowAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  inputCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 4 },
  folderInput: { minHeight: 48, paddingHorizontal: 12, fontSize: 17 },
  sheetCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 14 },
  actionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  moveHint: { paddingVertical: 12 },
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
  },
  emptyCopy: { flex: 1, gap: 4 },
  skeletonGroup: { gap: 10, paddingVertical: 8 },
  skeletonLine: { height: 12, borderRadius: 6, opacity: 0.65 },
});

function linkTitle(link: MobileConnectedLink) {
  const metadata = link.metadata ?? {};
  return String(
    metadata.title ??
      metadata.name ??
      metadata.fileName ??
      metadata.documentName ??
      link.external_type ??
      'Connected link'
  );
}

function providerLabel(value?: string | null) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized.includes('google_drive') || normalized === 'drive') return 'Google Drive';
  if (normalized.includes('github')) return 'GitHub';
  if (normalized.includes('figma')) return 'Figma';
  return normalized
    ? normalized.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
    : 'Connected service';
}

function FilesLinksSkeleton({ theme }: { theme: ReturnType<typeof useLedgerTheme> }) {
  return (
    <View accessibilityLabel="Loading files and links" style={styles.skeletonGroup}>
      <View
        style={[styles.skeletonLine, { backgroundColor: theme.colors.borderSubtle, width: '78%' }]}
      />
      <View
        style={[styles.skeletonLine, { backgroundColor: theme.colors.borderSubtle, width: '58%' }]}
      />
    </View>
  );
}
