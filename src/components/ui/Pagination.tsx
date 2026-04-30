import { cn } from '@/lib/utils';

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onChange: (page: number) => void;
  className?: string;
}

export default function Pagination({ total, page, pageSize, onChange, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  // Gera janela de páginas: sempre mostra primeira, última e até 3 ao redor da atual
  function pages(): (number | '…')[] {
    const result: (number | '…')[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) {
        result.push(i);
      } else if (result[result.length - 1] !== '…') {
        result.push('…');
      }
    }
    return result;
  }

  const btnBase = 'inline-flex h-8 min-w-[2rem] items-center justify-center rounded-md px-2 text-sm transition-colors';

  return (
    <div className={cn('flex items-center justify-between gap-4 px-1 py-3', className)}>
      <span className="text-xs text-slate-500">
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          className={cn(btnBase, 'border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed')}
        >
          ‹
        </button>
        {pages().map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} className="px-1 text-slate-400 text-sm">…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn(
                btnBase,
                p === page
                  ? 'bg-brand-600 text-white font-medium'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              )}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page === totalPages}
          className={cn(btnBase, 'border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed')}
        >
          ›
        </button>
      </div>
    </div>
  );
}
