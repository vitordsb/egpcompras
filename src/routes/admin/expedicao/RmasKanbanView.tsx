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
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import type { RmaRow, RmaStatus } from './rmas-shared';
import { MOTIVO_LABEL, formatDateBR } from './rmas-shared';

// Bucket simples: tudo que não saiu = "defeito" (em andamento na fábrica),
// devolvido = "saiu". Operação pequena, sem burocracia de subetapas.
type BucketKey = 'defeito' | 'saiu';

interface ColumnDef {
  key: BucketKey;
  label: string;
  headerClass: string;
  countClass: string;
  emptyHint: string;
  targetStatus: RmaStatus;
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'defeito',
    label: 'Defeito (em andamento)',
    headerClass: 'bg-amber-50 border-amber-200 text-amber-800',
    countClass: 'bg-amber-100 text-amber-700',
    emptyHint: 'Sem RMAs em andamento.',
    targetStatus: 'recebido',
  },
  {
    key: 'saiu',
    label: 'Saiu',
    headerClass: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    countClass: 'bg-emerald-100 text-emerald-700',
    emptyHint: 'Nenhum RMA devolvido ainda.',
    targetStatus: 'devolvido',
  },
];

function bucketOf(status: RmaStatus): BucketKey {
  return status === 'devolvido' ? 'saiu' : 'defeito';
}

interface RmasKanbanViewProps {
  rmas: RmaRow[];
  onCardClick: (id: string) => void;
  onMoveToColumn: (r: RmaRow, target: RmaStatus) => void | Promise<void>;
  onAddObservation: (rmaId: string, content: string) => Promise<void>;
}

export default function RmasKanbanView({
  rmas,
  onCardClick,
  onMoveToColumn,
  onAddObservation,
}: RmasKanbanViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeWidth, setActiveWidth] = useState<number | null>(null);
  const [hoverColumn, setHoverColumn] = useState<BucketKey | null>(null);
  const [obsFor, setObsFor] = useState<RmaRow | null>(null);
  const [obsText, setObsText] = useState('');
  const [obsSaving, setObsSaving] = useState(false);

  // Sensor: precisa mover 6px antes de iniciar o drag — assim cliques simples
  // (pra abrir detalhes) não são interpretados como drag.
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
    const acc: Record<BucketKey, RmaRow[]> = { defeito: [], saiu: [] };
    for (const r of rmas) {
      if (r.status === 'cancelado') continue;
      acc[bucketOf(r.status)].push(r);
    }
    return acc;
  }, [rmas]);

  const activeRma = useMemo(() => rmas.find((r) => r.id === activeId) ?? null, [rmas, activeId]);

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    const rect = e.active.rect.current.initial;
    if (rect) setActiveWidth(rect.width);
  }
  function handleDragOver(e: DragOverEvent) {
    const overId = e.over?.id;
    if (!overId) {
      setHoverColumn(null);
      return;
    }
    setHoverColumn(String(overId) as BucketKey);
  }
  function handleDragEnd(e: DragEndEvent) {
    const overId = e.over?.id;
    setActiveId(null);
    setHoverColumn(null);
    if (!overId) return;
    const r = rmas.find((x) => x.id === e.active.id);
    if (!r) return;
    const target = String(overId) as BucketKey;
    if (bucketOf(r.status) === target) return;
    const targetStatus = COLUMNS.find((c) => c.key === target)!.targetStatus;
    onMoveToColumn(r, targetStatus);
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
        <div className="grid gap-3 md:grid-cols-2">
          {COLUMNS.map((col) => (
            <DroppableColumn
              key={col.key}
              col={col}
              hovered={hoverColumn === col.key}
              count={grouped[col.key].length}
            >
              {grouped[col.key].length === 0 ? (
                <div className="flex h-full items-center justify-center px-2 py-8 text-center text-xs text-slate-400">
                  {col.emptyHint}
                </div>
              ) : (
                grouped[col.key].map((r) => (
                  <DraggableCard
                    key={r.id}
                    rma={r}
                    isDragging={activeId === r.id}
                    bucketKey={col.key}
                    onCardClick={onCardClick}
                    onMarkSaiu={() => onMoveToColumn(r, 'devolvido')}
                    onAskObservation={() => {
                      setObsFor(r);
                      setObsText('');
                    }}
                  />
                ))
              )}
            </DroppableColumn>
          ))}
        </div>

        {/* Overlay que segue o cursor — esse é o "card flutuando" */}
        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
          {activeRma ? <CardPreview rma={activeRma} width={activeWidth} /> : null}
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
                  RMA #{obsFor.numero} — {obsFor.client_trade_name ?? obsFor.client_name}
                </p>
              </div>
              <div className="px-5 py-4">
                <Textarea
                  value={obsText}
                  onChange={(e) => setObsText(e.target.value)}
                  placeholder="Ex: cliente confirmou recebimento via WhatsApp"
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

// ── Coluna drop-zone ──────────────────────────────────────────────────────────

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
        <span className="text-xs font-semibold uppercase tracking-wide">{col.label}</span>
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

// ── Card arrastável ──────────────────────────────────────────────────────────

function DraggableCard({
  rma, isDragging, bucketKey, onCardClick, onMarkSaiu, onAskObservation,
}: {
  rma: RmaRow;
  isDragging: boolean;
  bucketKey: BucketKey;
  onCardClick: (id: string) => void;
  onMarkSaiu: () => void;
  onAskObservation: () => void;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: rma.id });
  const canMarkSaiu = bucketKey === 'defeito';

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onCardClick(rma.id)}
      className={cn(
        'cursor-grab touch-none rounded-md border border-slate-200 bg-white p-3 shadow-sm',
        'transition-[box-shadow,border-color] duration-150',
        'hover:border-brand-300 hover:shadow-lg',
        'active:cursor-grabbing',
        isDragging && 'opacity-30'
      )}
      title="Clique para detalhes — segure e arraste para mover"
    >
      <CardContent rma={rma} canMarkSaiu={canMarkSaiu} onMarkSaiu={onMarkSaiu} onAskObservation={onAskObservation} />
    </div>
  );
}

// ── Preview que segue o cursor (DragOverlay) ─────────────────────────────────

function CardPreview({ rma, width }: { rma: RmaRow; width: number | null }) {
  return (
    <div
      className="rotate-[-2deg] cursor-grabbing rounded-md border border-brand-300 bg-white p-3 shadow-2xl ring-1 ring-brand-100"
      style={{ width: width ?? 320 }}
    >
      <CardContent rma={rma} canMarkSaiu={false} onMarkSaiu={() => {}} onAskObservation={() => {}} />
    </div>
  );
}

// ── Conteúdo do card (compartilhado entre Draggable e Preview) ───────────────

function CardContent({
  rma: r, canMarkSaiu, onMarkSaiu, onAskObservation,
}: {
  rma: RmaRow;
  canMarkSaiu: boolean;
  onMarkSaiu: () => void;
  onAskObservation: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">
            {r.client_trade_name ?? r.client_name}
          </div>
          {r.client_trade_name && (
            <div className="truncate text-[11px] text-slate-500">{r.client_name}</div>
          )}
        </div>
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-700">
          #{r.numero}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <span className={cn(
          'rounded px-1.5 py-0.5 text-[10px] font-medium',
          r.motivo === 'defeito' && 'bg-red-50 text-red-700 border border-red-200',
          r.motivo === 'garantia' && 'bg-amber-50 text-amber-700 border border-amber-200',
          r.motivo === 'desistencia' && 'bg-blue-50 text-blue-700 border border-blue-200',
          r.motivo === 'outro' && 'bg-slate-50 text-slate-600 border border-slate-200',
        )}>
          {MOTIVO_LABEL[r.motivo]}
        </span>
        {r.numero_venda_origem && (
          <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            venda #{r.numero_venda_origem}
          </span>
        )}
      </div>

      <div className="mt-2 text-[11px] text-slate-500">
        Recebido em {formatDateBR(r.data_recebido)}
        {r.observations_count != null && r.observations_count > 0 && (
          <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
            {r.observations_count} obs.
          </span>
        )}
      </div>

      {(canMarkSaiu || true) && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
          {canMarkSaiu && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onMarkSaiu();
              }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-emerald-50 hover:text-emerald-700"
              title="Marcar como devolvido (saiu)"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8h10m-3-3 3 3-3 3" />
              </svg>
              Marcar saiu
            </button>
          )}
          {canMarkSaiu && <span className="text-slate-300">·</span>}
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
