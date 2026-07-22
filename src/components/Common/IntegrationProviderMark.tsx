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
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label} className={className}>
        <path fill="#36C5F0" d="M6.1 14.3a2.1 2.1 0 1 1-2.1 2.1 2.1 2.1 0 0 1 2.1-2.1h2.1v-2.1H6.1Z" />
        <path fill="#2EB67D" d="M9.7 6.1a2.1 2.1 0 1 1-2.1-2.1 2.1 2.1 0 0 1 2.1 2.1v2.1h2.1V6.1Z" />
        <path fill="#ECB22E" d="M17.9 9.7a2.1 2.1 0 1 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1h-2.1v-2.1h2.1Z" />
        <path fill="#E01E5A" d="M14.3 17.9a2.1 2.1 0 1 1 2.1 2.1 2.1 2.1 0 0 1-2.1-2.1v-2.1h-2.1v2.1Z" />
      </svg>
    );
  }
  return <Globe size={size} aria-label={label} className={className} />;
}
