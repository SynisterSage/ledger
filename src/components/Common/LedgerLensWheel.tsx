import type { SVGProps } from 'react';

export type LedgerLensWheelState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

type LedgerLensWheelProps = Omit<SVGProps<SVGSVGElement>, 'aria-label'> & {
  state?: LedgerLensWheelState;
  size?: number;
  label?: string;
};

const stateColor: Record<LedgerLensWheelState, string> = {
  idle: 'var(--ledger-text-muted)',
  loading: 'var(--ledger-accent)',
  ready: 'var(--ledger-accent)',
  unavailable: 'var(--ledger-text-muted)',
  error: 'var(--ledger-danger)',
};

/** A small Lens mark: an aperture inside a rotating Ledger-style evidence wheel. */
export function LedgerLensWheel({
  state = 'idle',
  size = 22,
  label = 'Lens',
  className = '',
  ...props
}: LedgerLensWheelProps) {
  const isLoading = state === 'loading';

  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`shrink-0 ${isLoading ? 'animate-[spin_2.8s_linear_infinite]' : ''} ${className}`}
      role="img"
      aria-label={label}
      style={{ color: stateColor[state], ...props.style }}
    >
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeOpacity="0.2" />
      <g stroke="currentColor" strokeLinecap="round" strokeWidth="1.65">
        <path d="M12 2.75v2.1" />
        <path d="M21.25 12h-2.1" />
        <path d="M12 21.25v-2.1" />
        <path d="M2.75 12h2.1" />
      </g>
      <g fill="currentColor">
        <rect x="10.55" y="5.8" width="2.9" height="3.55" rx="1.45" />
        <rect x="14.65" y="10.55" width="3.55" height="2.9" rx="1.45" />
        <rect x="10.55" y="14.65" width="2.9" height="3.55" rx="1.45" />
        <rect x="5.8" y="10.55" width="3.55" height="2.9" rx="1.45" />
      </g>
      <circle
        cx="12"
        cy="12"
        r="3.1"
        fill="var(--ledger-surface-card)"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    </svg>
  );
}
