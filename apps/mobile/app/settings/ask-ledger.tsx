import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppButton } from '@/components/AppButton';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { SettingsChoiceSheet } from '@/features/settings/SettingsChoiceSheet';
import {
  getMobileAISettings,
  listMobileAIModels,
  MOBILE_AI_PROVIDERS,
  removeMobileAIKey,
  selectMobileAIProvider,
  setMobileAICloudConsent,
  setMobileAIKey,
  setMobileAIModel,
  testMobileAIProvider,
  type MobileAIProvider,
  type MobileAIProviderState,
  type MobileAISelection,
} from '@/features/askLedger/mobileAIProvider';
import { concentricRadius, useLedgerTheme } from '@/theme';

export default function AskLedgerSettingsScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const [selected, setSelected] = useState<MobileAISelection>(null);
  const [cloudConsent, setCloudConsent] = useState(false);
  const [providers, setProviders] = useState<MobileAIProviderState[]>([]);
  const [providerSheetVisible, setProviderSheetVisible] = useState(false);
  const [editingProvider, setEditingProvider] = useState<MobileAIProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [modelSheetProvider, setModelSheetProvider] = useState<MobileAIProvider | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const provider = useMemo(() => providers.find((item) => item.provider === editingProvider) ?? null, [editingProvider, providers]);
  const selectedLabel = selected
    ? MOBILE_AI_PROVIDERS.find((item) => item.id === selected)?.label ?? selected
    : 'Not configured';

  const refresh = async () => {
    const settings = await getMobileAISettings();
    setSelected(settings.selected);
    setCloudConsent(settings.cloudConsent);
    setProviders(settings.providers);
  };

  const toggleCloudConsent = async (enabled: boolean) => {
    try {
      const settings = await setMobileAICloudConsent(enabled);
      setSelected(settings.selected);
      setCloudConsent(settings.cloudConsent);
      setProviders(settings.providers);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not update cloud AI consent.');
    }
  };

  useEffect(() => { void refresh(); }, []);

  const saveKey = async () => {
    if (!editingProvider || busy) return;
    setBusy(true); setStatus(null);
    try { await setMobileAIKey(editingProvider, apiKey); setApiKey(''); setEditingProvider(null); await refresh(); setStatus('Provider connected.'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save the provider.'); }
    finally { setBusy(false); }
  };

  const removeKey = (item: MobileAIProviderState) => {
    Alert.alert(`Remove ${MOBILE_AI_PROVIDERS.find((entry) => entry.id === item.provider)?.label ?? item.provider}?`, 'The key will be removed from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await removeMobileAIKey(item.provider); await refresh(); } },
    ]);
  };

  const testProvider = async (item: MobileAIProviderState) => {
    setBusy(true); setStatus(null);
    const result = await testMobileAIProvider(item.provider);
    setStatus(result.ok ? `${MOBILE_AI_PROVIDERS.find((entry) => entry.id === item.provider)?.label ?? item.provider} is connected.` : result.error ?? 'Connection failed.');
    setBusy(false);
  };

  const openModelPicker = async (item: MobileAIProviderState) => {
    setModelsLoading(true);
    setStatus(null);
    try {
      const models = await listMobileAIModels(item.provider);
      setModelOptions(models.length ? models : [item.model]);
      setModelSheetProvider(item.provider);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load models.');
    } finally {
      setModelsLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
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
            <AppText variant="screenTitle">AI settings</AppText>
            <AppText variant="caption" style={{ color: theme.colors.textSecondary }}>
              Choose where Ask Ledger runs and manage providers on this device.
            </AppText>
          </View>
        </View>

        <View style={{ gap: 28 }}>
          <Section title="Active provider" card>
            <Pressable onPress={() => setProviderSheetVisible(true)} style={{ padding: 16 }}>
              <AppText variant="body">{selectedLabel}</AppText>
              <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>Ask Ledger uses this provider for generation.</AppText>
            </Pressable>
            <View style={{ padding: 16, gap: 12 }}>
              <AppText variant="meta" style={{ color: theme.colors.textSecondary }}>Cloud providers send selected Ledger context to that provider. You control the API key and pay the provider directly.</AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <AppText variant="body" style={{ flex: 1 }}>{cloudConsent ? 'Cloud provider consent enabled' : 'Enable cloud provider consent'}</AppText>
                <Switch
                  value={cloudConsent}
                  onValueChange={(value) => void toggleCloudConsent(value)}
                  accessibilityLabel="Cloud provider consent"
                  trackColor={{ false: theme.colors.borderSubtle, true: theme.colors.accent }}
                  thumbColor={theme.colors.surface}
                  ios_backgroundColor={theme.colors.borderSubtle}
                />
              </View>
            </View>
          </Section>

          <Section title="Providers" card>
            {providers.map((item) => {
              const label = MOBILE_AI_PROVIDERS.find((entry) => entry.id === item.provider)?.label ?? item.provider;
              return (
                <View key={item.provider} style={{ padding: 16, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <View style={{ flex: 1, gap: 2 }}><AppText variant="body">{label}</AppText><AppText variant="meta" style={{ color: theme.colors.textSecondary }}>{item.connected ? `Connected · ••••${item.keySuffix}` : 'Not connected'}</AppText></View>
                    <Pressable onPress={() => { setEditingProvider(item.provider); setApiKey(''); setStatus(null); }}><AppText variant="body" style={{ color: theme.colors.accent }}>{item.connected ? 'Replace' : 'Connect'}</AppText></Pressable>
                  </View>
                  {item.connected ? <View style={{ gap: 10 }}><Pressable onPress={() => void openModelPicker(item)} disabled={modelsLoading}><AppText variant="meta" style={{ color: theme.colors.textSecondary }}>Model · {item.model}</AppText></Pressable><View style={{ flexDirection: 'row', gap: 18 }}><Pressable onPress={() => void testProvider(item)} disabled={busy}><AppText variant="meta" style={{ color: theme.colors.accent }}>Test connection</AppText></Pressable><Pressable onPress={() => removeKey(item)}><AppText variant="meta" style={{ color: theme.colors.danger }}>Remove</AppText></Pressable></View></View> : null}
                </View>
              );
            })}
          </Section>

          {status ? <AppText variant="meta" style={{ color: status.includes('connected') ? theme.colors.accent : theme.colors.danger }}>{status}</AppText> : null}
        </View>
      </Screen>

      <SettingsChoiceSheet visible={providerSheetVisible} title="Active provider" subtitle="Choose a connected BYOP provider. Ledger sends only the selected context to it." selectedValue={selected ?? ''} options={providers.filter((item) => item.connected).map((item) => ({ value: item.provider, title: MOBILE_AI_PROVIDERS.find((entry) => entry.id === item.provider)?.label ?? item.provider }))} onSelect={(value) => void selectMobileAIProvider(value as MobileAIProvider).then(refresh).catch((error) => setStatus(error instanceof Error ? error.message : 'Could not select the provider.'))} onClose={() => setProviderSheetVisible(false)} />

      <SettingsChoiceSheet
        visible={modelSheetProvider !== null}
        title="Provider model"
        subtitle="Choose a text model available to your provider key."
        selectedValue={providers.find((item) => item.provider === modelSheetProvider)?.model ?? ''}
        options={modelOptions.map((model) => ({ value: model, title: model }))}
        onSelect={(model) => {
          if (!modelSheetProvider) return;
          void setMobileAIModel(modelSheetProvider, model).then(refresh).catch((error) => setStatus(error instanceof Error ? error.message : 'Could not select the model.'));
        }}
        onClose={() => setModelSheetProvider(null)}
        maxHeight={640}
      />

      <AppBottomSheet visible={Boolean(editingProvider)} onClose={() => setEditingProvider(null)} title={provider?.connected ? 'Replace API key' : 'Connect provider'} snapPoints={['68%', '90%']} initialSnapPointIndex={1} avoidKeyboard>
        {editingProvider ? (
        <View style={{ gap: 18 }}>
          <View style={{ gap: 6 }}>
            <AppText variant="caption" style={{ color: theme.colors.textSecondary }}>
              Your key stays on this device and is used only for your selected provider.
            </AppText>
          </View>
          <View style={{ backgroundColor: theme.colors.surfaceMuted, borderRadius: concentricRadius(theme.radius.sheet, theme.spacing.lg), padding: 16 }}>
            <AppTextInput label="API key" placeholder="Paste your provider key" value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false} style={{ borderBottomWidth: 0, marginVertical: 0 }} />
          </View>
          <AppButton title={busy ? 'Saving…' : 'Save key'} onPress={() => void saveKey()} disabled={busy || !apiKey.trim()} size="lg" />
        </View>
        ) : null}
      </AppBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 24 },
  headerBack: { marginTop: 7 },
  headerCopy: { flex: 1, gap: 4 },
});
