import React from 'react';

type State = { hasError: boolean };

export class WebErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[ledger-web] renderer error', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--ledger-background)] px-6 py-12 text-center">
        <section className="w-full max-w-md rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-6 shadow-[var(--ledger-shadow)]">
          <p className="text-xs font-medium text-[var(--ledger-text-muted)]">Ledger</p>
          <h1 className="mt-2 text-xl font-medium text-[var(--ledger-text-primary)]">Ledger needs to reload</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ledger-text-muted)]">
            This page hit an unexpected error. Your saved workspace data is still on the server.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-lg bg-[var(--ledger-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--ledger-accent-hover)]"
          >
            Reload Ledger
          </button>
        </section>
      </main>
    );
  }
}
