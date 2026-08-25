export const openLocalAISettings = () => {
  void window.desktopWindow?.openModule('settings', {
    kind: 'settings',
    focusSection: 'local_ai',
    focusContext: 'settings-anchor:settings-local-ai',
  });
};

export const LocalAIUnavailableState = ({
  title = 'Local AI model required',
  detail = 'Download a model to use this feature. AI processing stays on this device.',
  compact = true,
}: {
  title?: string;
  detail?: string;
  compact?: boolean;
}) => (
  <button
    type="button"
    onClick={openLocalAISettings}
    className={`${compact ? 'mt-1' : 'mt-2'} inline-flex h-5 w-5 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] text-[10px] font-semibold text-[var(--ledger-text-muted)] transition hover:border-[color:var(--ledger-border-strong)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]`}
    aria-label={`${title}. Open Local AI settings.`}
    title={`${title}. ${detail} Open Local AI settings.`}
  >
    !
  </button>
);
