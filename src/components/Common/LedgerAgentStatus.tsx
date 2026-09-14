import {
  CheckCircle2,
  FileSearch,
  ListChecks,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export type LedgerAgentPhase =
  | 'searching'
  | 'reading'
  | 'thinking'
  | 'preparing'
  | 'ready'
  | 'executing';

const phaseIcon = {
  searching: Search,
  reading: FileSearch,
  thinking: Sparkles,
  preparing: ListChecks,
  ready: CheckCircle2,
  executing: ShieldCheck,
} satisfies Record<LedgerAgentPhase, typeof Search>;

export function LedgerAgentStatus({
  phase,
  label,
  detail,
  active = false,
  compact = false,
  className = '',
}: {
  phase: LedgerAgentPhase;
  label: string;
  detail?: string;
  active?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const Icon = phaseIcon[phase];
  return (
    <div
      className={`flex min-w-0 items-center gap-2 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[color:color-mix(in_srgb,var(--ledger-surface-muted)_72%,transparent)] px-2.5 py-2 ${className}`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--ledger-surface)] text-[var(--ledger-text-muted)] ${
          active ? 'text-[var(--ledger-accent)]' : ''
        }`}
      >
        {active ? (
          <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
        ) : (
          <Icon size={12} aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-[var(--ledger-text-secondary)]">
          {label}
        </span>
        {!compact && detail ? (
          <span className="mt-0.5 block truncate text-[10px] leading-4 text-[var(--ledger-text-muted)]">
            {detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}
