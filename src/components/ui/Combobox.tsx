// Combobox searchable simples — substitui o <select> nativo quando a lista
// de opções é grande e o user precisa filtrar digitando.
// O dropdown é renderizado via portal (position fixed) pra escapar de
// containers com overflow:hidden/auto (ex: tabelas com scroll horizontal).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Texto extra mostrado abaixo do label (opcional) */
  hint?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export default function Combobox({
  value, onChange, options, placeholder = 'Selecione…', className, disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  // Posiciona o dropdown via portal — usa coordenadas do botão. Recalcula
  // ao abrir e em scroll/resize pra acompanhar o layout.
  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({ left: rect.left, top: rect.bottom + 4, width: rect.width });
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Click fora fecha — verifica tanto o container quanto o dropdown (portal)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options
      .filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q))
      .slice(0, 50);
  }, [options, query]);

  function handleSelect(v: string) {
    onChange(v);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        disabled={disabled}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2 text-left text-sm hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className={cn('truncate', !selected && 'text-slate-400')}>
          {selected?.label ?? placeholder}
        </span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={cn('h-3 w-3 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 8l5 5 5-5" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 9999 }}
          className="max-h-72 overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl"
        >
          <div className="border-b border-slate-100 p-1.5">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                  setQuery('');
                } else if (e.key === 'Enter' && filtered.length > 0) {
                  e.preventDefault();
                  handleSelect(filtered[0].value);
                }
              }}
              placeholder="Buscar…"
              className="w-full rounded-sm border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-200"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">Nenhum resultado.</li>
            ) : (
              filtered.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => handleSelect(o.value)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                      value === o.value
                        ? 'bg-brand-50 text-brand-800'
                        : 'text-slate-700 hover:bg-slate-50'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="truncate">{o.label}</span>
                      {o.hint && <span className="block truncate text-[10px] text-slate-400">{o.hint}</span>}
                    </span>
                    {value === o.value && (
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" />
                      </svg>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
