import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import Pdf from 'react-native-pdf';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { useLedgerTheme } from '@/theme';
import {
  listMobileLocalFiles,
  removeMobileLocalFile,
  saveMobileLocalText,
  type MobileLocalFile,
} from '@/features/files/mobileLocalFiles';
import { useAuthState } from '@/store/sessionStore';
import { useWorkspaceState } from '@/store/workspaceStore';

export default function MobileFileDetailScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuthState();
  const workspaceState = useWorkspaceState();
  const userId = auth.user?.id ?? '';
  const workspaceId = workspaceState.selectedWorkspaceId ?? '';
  const [file, setFile] = useState<MobileLocalFile | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!userId || !workspaceId || !id) return;
    void listMobileLocalFiles(userId, workspaceId).then((files) =>
      setFile(files.find((item) => item.id === id) ?? null)
    );
  }, [id, userId, workspaceId]);
  useEffect(() => {
    if (!file || !isTextLike(file)) {
      setTextPreview(null);
      return;
    }
    let canceled = false;
    void FileSystem.readAsStringAsync(file.uri)
      .then((text) => {
        if (!canceled) {
          setTextPreview(text);
          setDraft(text);
        }
      })
      .catch(() => {
        if (!canceled) setTextPreview(null);
      });
    return () => {
      canceled = true;
    };
  }, [file]);
  useEffect(() => {
    setImageFailed(false);
  }, [file]);

  const saveText = async () => {
    if (!file || !userId || !workspaceId || !isTextLike(file)) return;
    setSaving(true);
    try {
      const updated = await saveMobileLocalText(file.id, draft, userId, workspaceId);
      setFile(updated);
      setTextPreview(draft);
      setEditing(false);
    } catch (cause) {
      Alert.alert('Could not save file', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const openFile = async () => {
    if (!file) return;
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert(
        'Preview unavailable',
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

  const removeFile = () => {
    if (!file || !userId || !workspaceId) return;
    Alert.alert('Remove local file?', `${file.name} will be removed from Ledger on this device.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeMobileLocalFile(file.id, userId, workspaceId);
            router.back();
          } catch {
            Alert.alert('Could not remove file', 'Please try again.');
          }
        },
      },
    ]);
  };

  if (!file) {
    return (
      <Screen topFade={false} contentStyle={{ paddingTop: 18 }}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            size={22}
            tintColor={theme.colors.textPrimary}
          />
        </Pressable>
        <AppText variant="screenTitle" style={styles.title}>
          File unavailable
        </AppText>
        <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
          This file may have been removed or belongs to another workspace.
        </AppText>
      </Screen>
    );
  }

  return (
    <Screen scroll topFade={false} contentStyle={{ paddingTop: 18 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            size={22}
            tintColor={theme.colors.textPrimary}
          />
        </Pressable>
        <View style={styles.headerCopy}>
          <AppText variant="screenTitle" numberOfLines={2}>
            {file.name}
          </AppText>
          <AppText variant="caption" style={{ color: theme.colors.textSecondary }}>
            Local file details
          </AppText>
        </View>
      </View>
      <View
        style={[
          styles.previewCard,
          { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle },
        ]}
      >
        {isImage(file) && !imageFailed ? (
          <Image
            source={{ uri: file.uri }}
            style={styles.imagePreview}
            resizeMode="contain"
            onError={() => setImageFailed(true)}
          />
        ) : isImage(file) ? (
          <View style={styles.pdfFallback}>
            <SymbolView
              name={{ ios: 'photo', android: 'broken_image', web: 'broken_image' }}
              size={34}
              tintColor={theme.colors.accent}
            />
            <AppText variant="bodyStrong">Image preview unavailable</AppText>
            <AppText
              variant="caption"
              style={{ color: theme.colors.textSecondary, textAlign: 'center' }}
            >
              Use Open or share to view this image with another app.
            </AppText>
          </View>
        ) : isPdf(file) ? (
          <Pdf
            source={{ uri: file.uri, cache: true }}
            style={styles.pdfPreview}
            onError={() =>
              Alert.alert(
                'PDF preview unavailable',
                'Use Open or share to view this PDF with a native viewer.'
              )
            }
            enablePaging
            fitPolicy={0}
          />
        ) : textPreview !== null ? (
          <>
            {editing ? (
              <TextInput
                value={draft}
                onChangeText={setDraft}
                multiline
                style={[styles.textPreview, styles.editor]}
                textAlignVertical="top"
              />
            ) : (
              <ScrollTextPreview text={textPreview} theme={theme} />
            )}
            {isTextLike(file) ? (
              <Pressable
                onPress={() => (editing ? void saveText() : setEditing(true))}
                disabled={saving}
                style={[styles.secondaryButton, { borderColor: theme.colors.borderSubtle }]}
              >
                <AppText variant="button" style={{ color: theme.colors.textSecondary }}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Edit text'}
                </AppText>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <SymbolView
              name={{ ios: 'doc', android: 'description', web: 'description' }}
              size={34}
              tintColor={theme.colors.accent}
            />
            <AppText variant="bodyStrong" style={styles.previewTitle}>
              {isSpreadsheet(file) ? 'Spreadsheet preview' : 'Preview this file'}
            </AppText>
            <AppText
              variant="caption"
              style={{ color: theme.colors.textSecondary, textAlign: 'center' }}
            >
              {isSpreadsheet(file)
                ? 'Open or share this spreadsheet to view its sheets on your device.'
                : 'Ledger keeps the file private on this device. Use the device preview or share sheet to open it.'}
            </AppText>
          </>
        )}
        <Pressable
          onPress={() => void openFile()}
          style={[styles.primaryButton, { backgroundColor: theme.colors.accent }]}
        >
          <AppText variant="button" style={{ color: '#fff' }}>
            Open or share
          </AppText>
        </Pressable>
      </View>
      <View style={styles.section}>
        <AppText variant="sectionTitle">Details</AppText>
        <View style={[styles.details, { borderColor: theme.colors.borderSubtle }]}>
          <DetailRow label="Location" value="Private to this device" theme={theme} />
          <DetailRow label="Type" value={file.mimeType ?? 'File'} theme={theme} />
          <DetailRow
            label="Added"
            value={new Date(file.createdAt).toLocaleDateString()}
            theme={theme}
          />
        </View>
      </View>
      <Pressable onPress={removeFile} style={styles.removeButton}>
        <SymbolView
          name={{ ios: 'trash', android: 'delete_outline', web: 'delete' }}
          size={17}
          tintColor={theme.colors.textMuted}
        />
        <AppText variant="button" style={{ color: theme.colors.textSecondary }}>
          Remove from Ledger
        </AppText>
      </Pressable>
    </Screen>
  );
}

function DetailRow({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: ReturnType<typeof useLedgerTheme>;
}) {
  return (
    <View style={[styles.detailRow, { borderBottomColor: theme.colors.borderSubtle }]}>
      <AppText variant="meta" style={{ color: theme.colors.textMuted }}>
        {label}
      </AppText>
      <AppText variant="body" style={styles.detailValue} numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 26 },
  back: { marginTop: 5 },
  headerCopy: { flex: 1, gap: 4 },
  title: { marginTop: 20, marginBottom: 8 },
  previewCard: {
    alignItems: 'center',
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    gap: 10,
  },
  previewTitle: { marginTop: 4 },
  primaryButton: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 },
  section: { marginTop: 28, gap: 12 },
  details: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 14 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailValue: { flex: 1, textAlign: 'right' },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 28,
    paddingVertical: 12,
  },
  imagePreview: { width: '100%', height: 260, borderRadius: 10 },
  pdfPreview: { width: '100%', height: 360, borderRadius: 10, backgroundColor: '#fff' },
  pdfFallback: {
    width: '100%',
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  textPreview: {
    width: '100%',
    maxHeight: 300,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  editor: { minHeight: 220, color: '#111827', fontSize: 14 },
  secondaryButton: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
  },
});

function isImage(file: MobileLocalFile) {
  return file.mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}
function isPdf(file: MobileLocalFile) {
  return file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name);
}
function isSpreadsheet(file: MobileLocalFile) {
  return /\.(csv|xlsx?)$/i.test(file.name) || file.mimeType === 'text/csv';
}
function isTextLike(file: MobileLocalFile) {
  return file.mimeType?.startsWith('text/') || /\.(txt|md|csv)$/i.test(file.name);
}
function ScrollTextPreview({
  text,
  theme,
}: {
  text: string;
  theme: ReturnType<typeof useLedgerTheme>;
}) {
  return (
    <ScrollView style={styles.textPreview} nestedScrollEnabled>
      <AppText variant="meta" style={{ color: theme.colors.textPrimary }}>
        {text || 'This file is empty.'}
      </AppText>
    </ScrollView>
  );
}
