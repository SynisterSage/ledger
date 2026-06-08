import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type ToastVariant = 'default' | 'success' | 'error' | 'info';
type ToastIcon = 'ledger' | 'alert';
type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
  variant?: 'default' | 'destructive';
};
type Toast = {
  id: string;
  message: string;
  detail?: string;
  variant?: ToastVariant;
  icon?: ToastIcon;
  actions?: ToastAction[];
};

type ToastContextShape = {
  show: (
    message: string,
    opts?: {
      detail?: string;
      variant?: ToastVariant;
      duration?: number;
      actions?: ToastAction[];
      icon?: ToastIcon;
    }
  ) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

const ToastContext = createContext<ToastContextShape | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const clear = useCallback(() => {
    setToasts([]);
  }, []);

  const show = useCallback(
    (
      message: string,
      opts?: {
        detail?: string;
        variant?: ToastVariant;
        duration?: number;
        actions?: ToastAction[];
        icon?: ToastIcon;
      }
    ) => {
      const id = Math.random().toString(36).slice(2, 9);
      const variant = opts?.variant ?? 'default';
      const toast: Toast = {
        id,
        message,
        detail: opts?.detail ?? undefined,
        variant,
        icon: opts?.icon,
        actions: opts?.actions ?? [],
      };
      setToasts((t) => [toast, ...t]);

      const duration =
        typeof opts?.duration === 'number'
          ? opts.duration
          : toast.actions?.length
            ? 7000
            : 1800;
      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ show, dismiss, clear }), [show, dismiss, clear]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-6 z-50 flex items-start justify-center">
        <div className="flex w-full flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto flex w-[320px] max-w-[calc(100vw-2rem)] transform flex-col gap-2 rounded-2xl border px-4 py-3 shadow-[0_12px_32px_rgba(17,24,39,0.12)] transition-all duration-200 ease-out ${
                t.variant === 'success'
                  ? 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-primary)]'
                  : t.variant === 'error'
                  ? 'border-[#FECACA] bg-[#FEF3F2] text-[#B42318]'
                  : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-primary)]'
              }`}
            >
              <div className="flex items-start gap-3">
                {t.icon === 'alert' && (
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--ledger-accent)] text-[11px] font-semibold leading-none text-white"
                  >
                    !
                  </span>
                )}
                {t.icon === 'ledger' && (
                  <img
                    src="/logo-color.svg"
                    alt="Ledger"
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                )}
                {t.variant === 'success' && (
                  <svg
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#12B76A]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                  >
                    <path d="M20 6L9 17l-5-5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-5">{t.message}</div>
                  {t.detail ? (
                    <div className="mt-0.5 text-sm leading-5 text-[var(--ledger-text-secondary)]">
                      {t.detail}
                    </div>
                  ) : null}
                </div>
              </div>
              {t.actions?.length ? (
                <div className="flex flex-wrap gap-2">
                  {t.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        void action.onClick();
                        dismiss(t.id);
                      }}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        action.variant === 'destructive'
                          ? 'border-[#FECACA] bg-white text-[#B42318] hover:bg-[#FEF3F2]'
                          : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-muted)]'
                      }`}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
};
