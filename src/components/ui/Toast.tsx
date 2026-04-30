import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextValue {
  success: (title: string, description?: string) => void;
  error:   (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info:    (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _counter = 0;

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
};

const STYLES: Record<ToastType, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error:   'border-red-200    bg-red-50    text-red-800',
  warning: 'border-amber-200  bg-amber-50  text-amber-800',
  info:    'border-blue-200   bg-blue-50   text-blue-800',
};

const ICON_STYLES: Record<ToastType, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  error:   'bg-red-100    text-red-700',
  warning: 'bg-amber-100  text-amber-700',
  info:    'bg-blue-100   text-blue-700',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 4500);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div className={cn(
      'flex items-start gap-3 rounded-lg border px-4 py-3 shadow-md text-sm animate-in slide-in-from-right-full duration-200',
      STYLES[toast.type]
    )}>
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold', ICON_STYLES[toast.type])}>
        {ICONS[toast.type]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium">{toast.title}</p>
        {toast.description && <p className="mt-0.5 opacity-80">{toast.description}</p>}
      </div>
      <button type="button" onClick={() => onDismiss(toast.id)} className="shrink-0 opacity-50 hover:opacity-100 text-base leading-none">×</button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((type: ToastType, title: string, description?: string) => {
    const id = ++_counter;
    setToasts((prev) => [...prev.slice(-4), { id, type, title, description }]);
  }, []);

  const ctx: ToastContextValue = {
    success: (t, d) => add('success', t, d),
    error:   (t, d) => add('error',   t, d),
    warning: (t, d) => add('warning', t, d),
    info:    (t, d) => add('info',    t, d),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-80">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
