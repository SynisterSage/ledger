import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type ToastVariant = 'default' | 'success' | 'error' | 'info';
type Toast = { id: string; message: string; variant?: ToastVariant };

type ToastContextShape = {
  show: (message: string, opts?: { variant?: ToastVariant; duration?: number }) => void;
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

  const show = useCallback((message: string, opts?: { variant?: ToastVariant; duration?: number }) => {
    const id = Math.random().toString(36).slice(2, 9);
    const variant = opts?.variant ?? 'default';
    const toast: Toast = { id, message, variant };
    setToasts((t) => [toast, ...t]);

    const duration = typeof opts?.duration === 'number' ? opts!.duration : 1600;
    window.setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

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
              className={`pointer-events-auto transform transition-all duration-200 ease-out flex items-center gap-3 px-4 py-2 rounded-lg shadow-lg border ${
                t.variant === 'success'
                  ? 'bg-white border-gray-200 text-gray-900'
                  : t.variant === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-white border-gray-200 text-gray-900'
              }`}
            >
              {t.variant === 'success' && <svg className="w-4 h-4 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6L9 17l-5-5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              <div className="text-sm font-medium">{t.message}</div>
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
};
