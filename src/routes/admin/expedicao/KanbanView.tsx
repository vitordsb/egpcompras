import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import type { Shipment } from '@/types/db';
import { cn } from '@/lib/utils';
import { isLate, isOnTime, formatDate } from './shared';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { setupDragImage } from '@/lib/drag-feedback';

interface ShipmentRow extends Shipment {
  observations_count?: number;
}

type ColumnKey = 'late' | 'today' | 'on_time' | 'shipped';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  headerClass: string;
  countClass: string;
  emptyHint: string;
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'late',
    label: 'Atrasados',
    headerClass: 'bg-red-50 border-red-200 text-red-800',
    countClass: 'bg-red-100 text-red-700',
    emptyHint: 'Nenhum pedido atrasado.',
  },
  {
    key: 'today',
    label: 'Hoje',
    headerClass: 'bg-amber-50 border-amber-200 text-amber-800',
    countClass: 'bg-amber-100 text-amber-700',
    emptyHint: 'Sem pedidos para hoje.',
  },
  {
    key: 'on_time',
    label: 'No prazo',
    headerClass: 'bg-green-50 border-green-200 text-green-800',
    countClass: 'bg-green-100 text-green-700',
    emptyHint: 'Sem pedidos futuros.',
  },
  {
    key: 'shipped',
    label: 'Saiu',
    headerClass: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    countClass: 'bg-emerald-100 text-emerald-700',
    emptyHint: 'Nenhum pedido saiu ainda.',
  },
];

function classify(s: ShipmentRow): ColumnKey | null {
  if (s.status === 'shipped') return 'shipped';
  if (s.status !== 'pending') return null;
  if (isLate(s)) return 'late';
  if (isOnTime(s)) return 'on_time';
  return 'today';
}

interface KanbanViewProps {
  shipments: ShipmentRow[];
  onCardClick: (id: string) => void;
  onMarkShipped: (s: ShipmentRow) => void | Promise<void>;
  onMoveToColumn: (s: ShipmentRow, target: ColumnKey) => void | Promise<void>;
  onAddObservation: (shipmentId: string, content: string) => Promise<void>;
}

export default function KanbanView({
  shipments,
  onCardClick,
  onMarkShipped,
  onMoveToColumn,
  onAddObservation,
}: KanbanViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<ColumnKey | null>(null);
  const [obsFor, setObsFor] = useState<ShipmentRow | null>(null);
  const [obsText, setObsText] = useState('');
  const [obsSaving, setObsSaving] = useState(false);

  async function submitObservation(e: FormEvent) {
    e.preventDefault();
    if (!obsFor || !obsText.trim()) return;
    setObsSaving(true);
    try {
      await onAddObservation(obsFor.id, obsText.trim());
      setObsFor(null);
      setObsText('');
    } finally {
      setObsSaving(false);
    }
  }

  const grouped = useMemo(() => {
    const acc: Record<ColumnKey, ShipmentRow[]> = {
      late: [],
      today: [],
      on_time: [],
      shipped: [],
    };
    for (const s of shipments) {
      const key = classify(s);
      if (key) acc[key].push(s);
    }
    return acc;
  }, [shipments]);

  function onDragStart(e: DragEvent<HTMLDivElement>, s: ShipmentRow) {
    setDraggingId(s.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', s.id);
    setupDragImage(e);
  }

  function onDragEnd() {
    setDraggingId(null);
    setHoverColumn(null);
  }

  // Cleanup defensivo: garante limpar o estado se o drag for cancelado
  // (Esc, blur, drop fora). Sem isso o card fica preso como "dragging".
  useEffect(() => {
    if (!draggingId) return;
    const cleanup = () => {
      setDraggingId(null);
      setHoverColumn(null);
    };
    document.addEventListener('dragend', cleanup);
    document.addEventListener('drop', cleanup);
    window.addEventListener('blur', cleanup);
    return () => {
      document.removeEventListener('dragend', cleanup);
      document.removeEventListener('drop', cleanup);
      window.removeEventListener('blur', cleanup);
    };
  }, [draggingId]);

  function onDragOver(e: DragEvent<HTMLDivElement>, col: ColumnKey) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (hoverColumn !== col) setHoverColumn(col);
  }

  function onDragLeave(col: ColumnKey) {
    if (hoverColumn === col) setHoverColumn(null);
  }

  function onDrop(e: DragEvent<HTMLDivElement>, target: ColumnKey) {
    e.preventDefault();
    setHoverColumn(null);
    const id = e.dataTransfer.getData('text/plain');
    const s = shipments.find((x) => x.id === id);
    setDraggingId(null);
    if (!s) return;
    const current = classify(s);
    if (current === target) return;
    onMoveToColumn(s, target);
  }

  return (
    <>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => (
        <div
          key={col.key}
          onDragOver={(e) => onDragOver(e, col.key)}
          onDragLeave={() => onDragLeave(col.key)}
          onDrop={(e) => onDrop(e, col.key)}
          className={cn(
            'flex h-[calc(100vh-12rem)] min-h-[400px] flex-col rounded-lg border bg-slate-50/50 transition-colors',
            hoverColumn === col.key && 'border-brand-500 bg-brand-50/60 ring-4 ring-brand-200/50'
          )}
        >
          <div className={cn('flex items-center justify-between rounded-t-lg border-b px-3 py-2', col.headerClass)}>
            <span className="text-sm font-semibold uppercase tracking-wide">{col.label}</span>
            <span className={cn('inline-flex min-w-[24px] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold', col.countClass)}>
              {grouped[col.key].length}
            </span>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-2">
            {grouped[col.key].length === 0 ? (
              <div className="flex h-full items-center justify-center px-2 py-8 text-center text-xs text-slate-400">
                {col.emptyHint}
              </div>
            ) : (
              grouped[col.key].map((s) => (
                <KanbanCard
                  key={s.id}
                  shipment={s}
                  isDragging={draggingId === s.id}
                  onClick={() => onCardClick(s.id)}
                  onDragStart={(e) => onDragStart(e, s)}
                  onDragEnd={onDragEnd}
                  onMarkShipped={() => onMarkShipped(s)}
                  onAddObservation={() => {
                    setObsFor(s);
                    setObsText('');
                  }}
                  showActions={col.key !== 'shipped'}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>

    {obsFor && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        onClick={() => !obsSaving && setObsFor(null)}
      >
        <div
          className="w-full max-w-md rounded-lg bg-white shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={submitObservation}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                Nova observação
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Para {obsFor.client_trade_name ?? obsFor.client_name}
                {obsFor.numero_venda ? ` — Pedido #${obsFor.numero_venda}` : ''}
              </p>
            </div>
            <div className="px-5 py-4">
              <Textarea
                value={obsText}
                onChange={(e) => setObsText(e.target.value)}
                placeholder="Ex: cliente pediu para entregar depois das 14h"
                rows={4}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setObsFor(null)}
                disabled={obsSaving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={obsSaving || !obsText.trim()}>
                {obsSaving ? 'Salvando…' : 'Salvar observação'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    )}
    </>
  );
}

interface KanbanCardProps {
  shipment: ShipmentRow;
  isDragging: boolean;
  onClick: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onMarkShipped: () => void;
  onAddObservation: () => void;
  showActions: boolean;
}

function KanbanCard({
  shipment: s,
  isDragging,
  onClick,
  onDragStart,
  onDragEnd,
  onMarkShipped,
  onAddObservation,
  showActions,
}: KanbanCardProps) {
  const dateLabel = s.status === 'shipped' && s.data_saida
    ? `Saiu em ${formatDate(s.data_saida)}`
    : s.data_prevista
      ? `Prevista ${formatDate(s.data_prevista)}`
      : 'Sem data prevista';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        'group cursor-grab rounded-md border border-slate-200 bg-white p-3 shadow-sm',
        'transition-[box-shadow,border-color] duration-150',
        'hover:border-brand-300 hover:shadow-lg',
        'active:cursor-grabbing',
        isDragging && 'opacity-30 shadow-none'
      )}
      title="Clique para detalhes — segure e arraste para mover"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">
            {s.client_trade_name ?? s.client_name}
          </div>
          {s.client_trade_name && (
            <div className="truncate text-[11px] text-slate-500">{s.client_name}</div>
          )}
        </div>
        {s.tipo_nota && s.tipo_nota !== 'venda' && (
          <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-orange-700">
            {s.tipo_nota === 'retorno_conserto' ? 'Retorno' :
             s.tipo_nota === 'remessa_conserto' ? 'Remessa' :
             s.tipo_nota === 'remessa_demonstracao' ? 'Demo' :
             s.tipo_nota === 'rma' ? 'RMA' :
             s.tipo_nota === 'retorno_garantia' ? 'Garantia' :
             'Especial'}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {s.numero_venda && (
          <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-400">Pedido</span>
            #{s.numero_venda}
          </span>
        )}
        {s.numero_nfe && (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-emerald-400">NF-e</span>
            {s.numero_nfe}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
        <span>{dateLabel}</span>
        {s.valor_total != null && (
          <span className="font-medium text-slate-700">
            R$ {Number(s.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        )}
      </div>

      {(s.observations_count ?? 0) > 0 && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
            {s.observations_count} obs.
          </span>
        </div>
      )}

      {showActions && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMarkShipped();
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-emerald-50 hover:text-emerald-700"
            title="Marcar como saiu"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8h10m-3-3 3 3-3 3" />
            </svg>
            Registrar saída
          </button>
          <span className="text-slate-300">·</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddObservation();
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-purple-50 hover:text-purple-700"
            title="Adicionar observação"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h10M3 8h10M3 12h6" />
            </svg>
            Observação
          </button>
        </div>
      )}
    </div>
  );
}
