import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type ToastVariant = 'default' | 'success' | 'error' | 'info';
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
  actions?: ToastAction[];
};

type ToastContextShape = {
  show: (
    message: string,
    opts?: { detail?: string; variant?: ToastVariant; duration?: number; actions?: ToastAction[] }
  ) => string;
  dismiss: (id: string) => void;
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

  const show = useCallback(
    (
      message: string,
      opts?: { detail?: string; variant?: ToastVariant; duration?: number; actions?: ToastAction[] }
    ) => {
      const id = Math.random().toString(36).slice(2, 9);
      const variant = opts?.variant ?? 'default';
      const toast: Toast = {
        id,
        message,
        detail: opts?.detail ?? undefined,
        variant,
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

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container - top center */}
      <div className="pointer-events-none fixed inset-x-0 top-6 flex items-start justify-center z-50">
        <div className="flex flex-col gap-2 items-center">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto transform transition-all duration-200 ease-out flex flex-col gap-2 px-4 py-3 rounded-lg shadow-lg border min-w-[280px] max-w-[360px] ${
                t.variant === 'success'
                  ? 'bg-white border-gray-200 text-gray-900'
                  : t.variant === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-white border-gray-200 text-gray-900'
              }`}
            >
              <div className="flex items-start gap-3">
                {t.variant === 'success' && (
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M20 6L9 17l-5-5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-5 text-gray-900">{t.message}</div>
                  {t.detail ? <div className="mt-0.5 text-sm leading-5 text-gray-500">{t.detail}</div> : null}
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
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        action.variant === 'destructive'
                          ? 'border-red-200 bg-white text-red-600 hover:bg-red-50'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
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
