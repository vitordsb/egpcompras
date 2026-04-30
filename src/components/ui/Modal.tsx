import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Tamanho máximo do modal. Default: max-w-2xl */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Se true, fechar ao clicar fora (default true). */
  dismissible?: boolean;
  /** z-index do overlay (default 50). ConfirmModal usa 60+. */
  zIndex?: number;
  children: ReactNode;
}

const SIZE_CLS: Record<NonNullable<Props['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

/**
 * Modal centralizado, renderizado via portal no document.body.
 *
 * Vantagens vs <div fixed inset-0>:
 * - Imune a clipping de transform/overflow no ancestor
 * - Trava scroll do body automaticamente
 * - Fecha com Esc
 * - z-index consistente em todas as views
 */
export default function Modal({
  open, onClose, size = '2xl', dismissible = true, zIndex = 50, children,
}: Props) {
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open || !dismissible) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-slate-900/50 p-4"
      style={{ zIndex }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className={cn(
          'w-full max-h-[92vh] overflow-y-auto rounded-lg bg-white shadow-xl',
          SIZE_CLS[size]
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
