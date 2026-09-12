import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';
import {
  importMobileLocalFile,
  listMobileLocalFiles,
  removeMobileLocalFile,
  type MobileLocalFile,
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
  const [links, setLinks] = useState<MobileConnectedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (!userId || !workspaceId) {
      setFiles([]);
      setLinks([]);
      setLoading(false);
      return;
    }
    try {
      const [localFiles, connectedLinks] = await Promise.all([
        listMobileLocalFiles(userId, workspaceId),
        getMobileConnectedLinks(workspaceId).catch(() => []),
      ]);
      setFiles(localFiles);
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
        await importMobileLocalFile(result.assets[0], userId, workspaceId);
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
          <AppText variant="sectionTitle">On this device</AppText>
          <Pressable onPress={() => void importFile()} disabled={busy} accessibilityRole="button">
            <AppText variant="button" style={{ color: theme.colors.accent }}>
              {busy ? 'Adding…' : 'Add file'}
            </AppText>
          </Pressable>
        </View>
        {loading ? (
          <FilesLinksSkeleton theme={theme} />
        ) : files.length ? (
          files.map((file) => (
            <View
              key={file.id}
              style={[styles.row, { borderBottomColor: theme.colors.borderSubtle }]}
            >
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/settings/files/[id]', params: { id: file.id } })
                }
                style={styles.rowMain}
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
                onPress={() => deleteFile(file)}
                hitSlop={8}
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
      <View style={styles.section}>
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
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 24 },
  headerBack: { marginTop: 7 },
  headerCopy: { flex: 1, gap: 4 },
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
