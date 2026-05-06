import { useMemo, useState, type FormEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import type { Shipment } from '@/types/db';
import { cn } from '@/lib/utils';
import { isLate, isOnTime, formatDate } from './shared';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeWidth, setActiveWidth] = useState<number | null>(null);
  const [hoverColumn, setHoverColumn] = useState<ColumnKey | null>(null);
  const [obsFor, setObsFor] = useState<ShipmentRow | null>(null);
  const [obsText, setObsText] = useState('');
  const [obsSaving, setObsSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
    const acc: Record<ColumnKey, ShipmentRow[]> = { late: [], today: [], on_time: [], shipped: [] };
    for (const s of shipments) {
      const k = classify(s);
      if (k) acc[k].push(s);
    }
    return acc;
  }, [shipments]);

  const activeShipment = useMemo(
    () => shipments.find((s) => s.id === activeId) ?? null,
    [shipments, activeId]
  );

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    const rect = e.active.rect.current.initial;
    if (rect) setActiveWidth(rect.width);
  }
  function handleDragOver(e: DragOverEvent) {
    const overId = e.over?.id;
    setHoverColumn(overId ? (String(overId) as ColumnKey) : null);
  }
  function handleDragEnd(e: DragEndEvent) {
    const overId = e.over?.id;
    setActiveId(null);
    setHoverColumn(null);
    if (!overId) return;
    const s = shipments.find((x) => x.id === e.active.id);
    if (!s) return;
    const target = String(overId) as ColumnKey;
    if (classify(s) === target) return;
    onMoveToColumn(s, target);
  }
  function handleDragCancel() {
    setActiveId(null);
    setHoverColumn(null);
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => (
            <DroppableColumn
              key={col.key}
              col={col}
              count={grouped[col.key].length}
              hovered={hoverColumn === col.key}
            >
              {grouped[col.key].length === 0 ? (
                <div className="flex h-full items-center justify-center px-2 py-8 text-center text-xs text-slate-400">
                  {col.emptyHint}
                </div>
              ) : (
                grouped[col.key].map((s) => (
                  <DraggableCard
                    key={s.id}
                    shipment={s}
                    isDragging={activeId === s.id}
                    showActions={col.key !== 'shipped'}
                    onCardClick={onCardClick}
                    onMarkShipped={() => onMarkShipped(s)}
                    onAskObservation={() => {
                      setObsFor(s);
                      setObsText('');
                    }}
                  />
                ))
              )}
            </DroppableColumn>
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
          {activeShipment ? <CardPreview shipment={activeShipment} width={activeWidth} /> : null}
        </DragOverlay>
      </DndContext>

      {obsFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => !obsSaving && setObsFor(null)}
        >
          <div className="w-full max-w-md rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submitObservation}>
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">Nova observação</h2>
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
                <Button type="button" variant="secondary" onClick={() => setObsFor(null)} disabled={obsSaving}>
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

// ── Coluna ─────────────────────────────────────────────────────────────

function DroppableColumn({
  col, count, hovered, children,
}: {
  col: ColumnDef;
  count: number;
  hovered: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  const active = hovered || isOver;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-[calc(100vh-12rem)] min-h-[400px] flex-col rounded-lg border bg-slate-50/50 transition-colors duration-150',
        active && 'border-brand-500 bg-brand-50/60 ring-4 ring-brand-200/50'
      )}
    >
      <div className={cn('flex items-center justify-between rounded-t-lg border-b px-3 py-2', col.headerClass)}>
        <span className="text-sm font-semibold uppercase tracking-wide">{col.label}</span>
        <span className={cn('inline-flex min-w-[24px] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold', col.countClass)}>
          {count}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {children}
      </div>
    </div>
  );
}

// ── Card arrastável ───────────────────────────────────────────────────────

function DraggableCard({
  shipment, isDragging, showActions, onCardClick, onMarkShipped, onAskObservation,
}: {
  shipment: ShipmentRow;
  isDragging: boolean;
  showActions: boolean;
  onCardClick: (id: string) => void;
  onMarkShipped: () => void;
  onAskObservation: () => void;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: shipment.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onCardClick(shipment.id)}
      className={cn(
        'cursor-grab touch-none rounded-md border border-slate-200 bg-white p-3 shadow-sm',
        'transition-[box-shadow,border-color] duration-150',
        'hover:border-brand-300 hover:shadow-lg',
        'active:cursor-grabbing',
        isDragging && 'opacity-30'
      )}
      title="Clique para detalhes — segure e arraste para mover"
    >
      <CardContent shipment={shipment} showActions={showActions} onMarkShipped={onMarkShipped} onAskObservation={onAskObservation} />
    </div>
  );
}

// ── Preview que segue o cursor ────────────────────────────────────────────

function CardPreview({ shipment, width }: { shipment: ShipmentRow; width: number | null }) {
  return (
    <div
      className="rotate-[-2deg] cursor-grabbing rounded-md border border-brand-300 bg-white p-3 shadow-2xl ring-1 ring-brand-100"
      style={{ width: width ?? 320 }}
    >
      <CardContent shipment={shipment} showActions={false} onMarkShipped={() => {}} onAskObservation={() => {}} />
    </div>
  );
}

// ── Conteúdo do card ───────────────────────────────────────────────────────

function CardContent({
  shipment: s, showActions, onMarkShipped, onAskObservation,
}: {
  shipment: ShipmentRow;
  showActions: boolean;
  onMarkShipped: () => void;
  onAskObservation: () => void;
}) {
  const dateLabel = s.status === 'shipped' && s.data_saida
    ? `Saiu em ${formatDate(s.data_saida)}`
    : s.data_prevista
      ? `Prevista ${formatDate(s.data_prevista)}`
      : 'Sem data prevista';

  return (
    <>
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
            onPointerDown={(e) => e.stopPropagation()}
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
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAskObservation();
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
    </>
  );
}
