import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ActionMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'success' | 'info' | 'danger';
  separator?: boolean;
}

interface Props {
  items: ActionMenuItem[];
}

const VARIANT_CLS: Record<NonNullable<ActionMenuItem['variant']>, string> = {
  default: 'text-slate-700 hover:bg-slate-50',
  success: 'text-emerald-700 hover:bg-emerald-50',
  info:    'text-sky-700 hover:bg-sky-50',
  danger:  'text-red-600 hover:bg-red-50',
};

/**
 * Menu de ações (dropdown 3-dots) renderizado via portal.
 * Não sofre clipping do container pai — sempre visível e clicável.
 */
export default function ActionMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 176; // w-44
    // Alinha à direita do botão, com fallback se não couber
    let left = rect.right - menuWidth;
    if (left < 8) left = rect.left;
    setPos({ top: rect.bottom + 4, left });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onScroll() { setOpen(false); }
    function onResize() { setOpen(false); }
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M10 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM10 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM11.5 15.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z" />
        </svg>
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[81] w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
            role="menu"
          >
            {items.map((item, idx) => (
              <div key={idx}>
                {item.separator && idx > 0 && <div className="my-1 border-t border-slate-100" />}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { item.onClick(); setOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${VARIANT_CLS[item.variant ?? 'default']}`}
                >
                  {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
                  {item.label}
                </button>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}
