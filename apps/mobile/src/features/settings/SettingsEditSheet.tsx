import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { concentricRadius, useLedgerTheme } from '@/theme';

export type SettingsEditSheetMode = 'display_name' | 'password';

type SettingsEditSheetProps = {
  visible: boolean;
  mode: SettingsEditSheetMode | null;
  initialDisplayName: string;
  onClose: () => void;
  onSaveDisplayName: (displayName: string) => Promise<void>;
  onSavePassword: (password: string) => Promise<void>;
};

export function SettingsEditSheet({ visible, mode, initialDisplayName, onClose, onSaveDisplayName, onSavePassword }: SettingsEditSheetProps) {
  const theme = useLedgerTheme();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDisplayName(initialDisplayName);
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setIsSaving(false);
  }, [initialDisplayName, mode, visible]);

  const title = mode === 'password' ? 'Security' : 'Display name';

  const handleSave = async () => {
    if (isSaving) return;
    if (mode === 'display_name') {
      const trimmed = displayName.trim();
      if (!trimmed) { setError('Enter a display name.'); return; }
      setError(null); setIsSaving(true);
      try { await onSaveDisplayName(trimmed); onClose(); }
      catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to update your name.'); }
      finally { setIsSaving(false); }
      return;
    }
    if (!password) { setError('Enter a new password.'); return; }
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setError(null); setIsSaving(true);
    try { await onSavePassword(password); onClose(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to update your password.'); }
    finally { setIsSaving(false); }
  };

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title={title} snapPoints={mode === 'password' ? ['68%', '90%'] : ['55%', '80%']} initialSnapPointIndex={1} maxHeight={560} avoidKeyboard>
      <View style={{ gap: theme.spacing.lg }}>
        {mode === 'display_name' ? (
          <>
            <View style={{ gap: theme.spacing.xs }}>
              <AppText variant="body" style={{ color: theme.colors.textSecondary }}>Your name as it appears in Ledger.</AppText>
              <AppText variant="body" style={{ color: theme.colors.textMuted }}>This updates your profile name on this account.</AppText>
            </View>
            <View style={[styles.inputCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: concentricRadius(theme.radius.sheet, theme.spacing.lg) }]}>
              <AppTextInput label="Display name" placeholder="Lex Ferguson" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" autoCorrect={false} style={styles.cardInput} />
            </View>
          </>
        ) : (
          <>
            <View style={{ gap: theme.spacing.xs }}>
              <AppText variant="body" style={{ color: theme.colors.textSecondary }}>Change your account password.</AppText>
              <AppText variant="body" style={{ color: theme.colors.textMuted }}>Use a password you do not use elsewhere.</AppText>
            </View>
            <View style={[styles.inputCard, { backgroundColor: theme.colors.surfaceMuted, borderRadius: concentricRadius(theme.radius.sheet, theme.spacing.lg), gap: theme.spacing.md }]}>
              <AppTextInput label="New password" placeholder="••••••••" secureTextEntry value={password} onChangeText={setPassword} autoCapitalize="none" style={styles.cardInput} />
              <AppTextInput label="Confirm password" placeholder="••••••••" secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} autoCapitalize="none" style={styles.cardInput} />
            </View>
          </>
        )}
        {error ? <AppText variant="caption" style={{ color: theme.colors.danger }}>{error}</AppText> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xl }}>
        <View style={{ flex: 1 }}>
          <AppButton title={isSaving ? 'Saving...' : mode === 'password' ? 'Save password' : 'Save name'} onPress={() => void handleSave()} disabled={isSaving} size="lg" />
        </View>
        <View style={{ flex: 1 }}>
          <AppButton title="Cancel" variant="secondary" onPress={onClose} disabled={isSaving} size="lg" />
        </View>
      </View>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  inputCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardInput: {
    borderBottomWidth: 0,
  },
});
