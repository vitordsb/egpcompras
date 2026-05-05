import { useMemo, useState, type DragEvent } from 'react';
import type { Shipment } from '@/types/db';
import { cn } from '@/lib/utils';
import { isLate, isOnTime, formatDate } from './shared';

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
}

export default function KanbanView({
  shipments,
  onCardClick,
  onMarkShipped,
  onMoveToColumn,
}: KanbanViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<ColumnKey | null>(null);

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
  }

  function onDragEnd() {
    setDraggingId(null);
    setHoverColumn(null);
  }

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
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => (
        <div
          key={col.key}
          onDragOver={(e) => onDragOver(e, col.key)}
          onDragLeave={() => onDragLeave(col.key)}
          onDrop={(e) => onDrop(e, col.key)}
          className={cn(
            'flex h-[calc(100vh-22rem)] min-h-[400px] flex-col rounded-lg border bg-slate-50/50 transition-colors',
            hoverColumn === col.key && 'border-brand-400 bg-brand-50/40 ring-2 ring-brand-200'
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
                  showNextButton={col.key !== 'shipped'}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface KanbanCardProps {
  shipment: ShipmentRow;
  isDragging: boolean;
  onClick: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onMarkShipped: () => void;
  showNextButton: boolean;
}

function KanbanCard({
  shipment: s,
  isDragging,
  onClick,
  onDragStart,
  onDragEnd,
  onMarkShipped,
  showNextButton,
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
        'group cursor-pointer rounded-md border border-slate-200 bg-white p-3 shadow-sm transition-all hover:border-brand-300 hover:shadow-md',
        isDragging && 'opacity-40'
      )}
      title="Clique para ver detalhes — arraste para mover de coluna"
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

      {showNextButton && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMarkShipped();
          }}
          className="mt-3 w-full rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
        >
          → Próxima etapa (Saiu)
        </button>
      )}
    </div>
  );
}
