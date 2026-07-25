import { RotateCw } from 'lucide-react';

export type ExternalProviderOperation = {
  id: string;
  status: 'pending' | 'validating' | 'running' | 'waiting_for_provider' | 'completed' | 'partially_completed' | 'failed' | 'cancelled';
  progress?: number;
  error_message?: string | null;
  result_metadata?: Record<string, unknown>;
};

const labels: Record<ExternalProviderOperation['status'], string> = {
  pending: 'Pending', validating: 'Validating', running: 'Running', waiting_for_provider: 'Waiting for Google Drive', completed: 'Completed', partially_completed: 'Partially completed', failed: 'Failed', cancelled: 'Cancelled',
};

export function ExternalProviderOperationStatus({ operation, onRetry }: { operation: ExternalProviderOperation; onRetry?: () => void }) {
  const terminal = ['completed', 'cancelled'].includes(operation.status);
  return <div className="rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-3 py-2 text-xs">
    <div className="flex items-center justify-between gap-3"><span className="font-medium text-[var(--ledger-text-primary)]">{labels[operation.status]}</span><span className="text-[var(--ledger-text-muted)]">{operation.progress ?? 0}%</span></div>
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--ledger-border-subtle)]"><div className="h-full rounded-full bg-[var(--ledger-accent)] transition-all" style={{ width: `${Math.max(0, Math.min(100, operation.progress ?? 0))}%` }} /></div>
    {operation.error_message && <p className="mt-2 text-[var(--ledger-danger)]">{operation.error_message}</p>}
    {!terminal && (operation.status === 'failed' || operation.status === 'partially_completed') && onRetry && <button type="button" onClick={onRetry} className="mt-2 inline-flex items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] px-2 py-1 text-[11px] hover:bg-[var(--ledger-surface-hover)]"><RotateCw size={12} />Retry failed items</button>}
  </div>;
}
