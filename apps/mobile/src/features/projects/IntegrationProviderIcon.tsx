import { StyleSheet, View } from 'react-native';
import GithubMark from '../../../assets/integrations/github-mark.svg';
import FigmaMark from '../../../assets/integrations/figma.svg';
import DriveMark from '../../../assets/integrations/drive.svg';

type IntegrationProviderIconProps = {
  provider?: string | null;
};

function providerKey(value?: string | null) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized.includes('github')) return 'github';
  if (normalized.includes('figma')) return 'figma';
  if (normalized.includes('google_drive') || normalized === 'drive') return 'google_drive';
  return null;
}

export function hasIntegrationProviderIcon(provider?: string | null) {
  return Boolean(providerKey(provider));
}

export function IntegrationProviderIcon({ provider }: IntegrationProviderIconProps) {
  const key = providerKey(provider);
  if (!key) return null;

  return <View style={styles.frame} accessibilityLabel={key === 'google_drive' ? 'Google Drive' : key === 'github' ? 'GitHub' : 'Figma'}>
    {key === 'github' ? <GithubMark width={17} height={17} /> : null}
    {key === 'figma' ? <FigmaMark width={12} height={18} /> : null}
    {key === 'google_drive' ? <DriveMark width={19} height={17} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
});
