import { Globe } from 'lucide-react';
import { FigmaMark } from './FigmaMark';

export type IntegrationProviderKey = 'github' | 'slack' | 'figma' | 'browser' | null;

export const normalizeIntegrationProvider = (...values: unknown[]): IntegrationProviderKey => {
  const value = values.map((entry) => String(entry ?? '').trim().toLowerCase()).join(' ');
  if (value.includes('github')) return 'github';
  if (value.includes('slack')) return 'slack';
  if (value.includes('figma')) return 'figma';
  if (value.includes('browser') || value.includes('extension') || value.includes('web_capture')) return 'browser';
  return null;
};

const providerLabels: Record<Exclude<IntegrationProviderKey, null>, string> = {
  github: 'GitHub',
  slack: 'Slack',
  figma: 'Figma',
  browser: 'Browser extension',
};

export function IntegrationProviderMark({
  provider,
  size = 13,
  className = '',
}: {
  provider?: IntegrationProviderKey | string | null;
  size?: number;
  className?: string;
}) {
  const key = normalizeIntegrationProvider(provider);
  if (!key) return null;
  const label = providerLabels[key];

  if (key === 'github') {
    return <img src="/github-mark.svg" alt={label} title={label} className={className} style={{ width: size, height: size }} />;
  }
  if (key === 'figma') return <span role="img" aria-label={label} className={className}><FigmaMark size={size} /></span>;
  if (key === 'slack') {
    return <img src="/slack.svg" alt={label} title={label} className={className} style={{ width: size, height: size }} />;
  }
  return <Globe size={size} aria-label={label} className={className} />;
}
