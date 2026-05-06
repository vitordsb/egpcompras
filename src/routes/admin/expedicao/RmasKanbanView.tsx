import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { setupDragImage } from '@/lib/drag-feedback';
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
  /** Status que esse bucket disparra ao receber um drop */
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<BucketKey | null>(null);
  const [obsFor, setObsFor] = useState<RmaRow | null>(null);
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
    const acc: Record<BucketKey, RmaRow[]> = { defeito: [], saiu: [] };
    for (const r of rmas) {
      if (r.status === 'cancelado') continue; // cancelados ficam fora do kanban
      acc[bucketOf(r.status)].push(r);
    }
    return acc;
  }, [rmas]);

  function onDragStart(e: DragEvent<HTMLDivElement>, r: RmaRow) {
    setDraggingId(r.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', r.id);
    setupDragImage(e);
  }
  function onDragEnd() {
    setDraggingId(null);
    setHoverColumn(null);
  }
  function onDragOver(e: DragEvent<HTMLDivElement>, col: BucketKey) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (hoverColumn !== col) setHoverColumn(col);
  }
  function onDragLeave(col: BucketKey) {
    if (hoverColumn === col) setHoverColumn(null);
  }
  function onDrop(e: DragEvent<HTMLDivElement>, targetBucket: BucketKey) {
    e.preventDefault();
    setHoverColumn(null);
    const id = e.dataTransfer.getData('text/plain');
    const r = rmas.find((x) => x.id === id);
    setDraggingId(null);
    if (!r) return;
    const currentBucket = bucketOf(r.status);
    if (currentBucket === targetBucket) return;
    const target = COLUMNS.find((c) => c.key === targetBucket)!.targetStatus;
    onMoveToColumn(r, target);
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
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
              <span className="text-xs font-semibold uppercase tracking-wide">{col.label}</span>
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
                grouped[col.key].map((r) => {
                  // Em "defeito" → botão "Marcar saiu". Em "saiu" → não tem ação.
                  const canMarkSaiu = col.key === 'defeito';
                  return (
                    <div
                      key={r.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, r)}
                      onDragEnd={onDragEnd}
                      onClick={() => onCardClick(r.id)}
                      className={cn(
                        'group cursor-grab rounded-md border border-slate-200 bg-white p-3 shadow-sm',
                        'transition-[box-shadow,border-color] duration-150',
                        'hover:border-brand-300 hover:shadow-lg',
                        'active:cursor-grabbing',
                        draggingId === r.id && 'opacity-30 shadow-none'
                      )}
                      title="Clique para detalhes — segure e arraste para mover"
                    >
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

                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                        {canMarkSaiu && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onMoveToColumn(r, 'devolvido');
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
                          onClick={(e) => {
                            e.stopPropagation();
                            setObsFor(r);
                            setObsText('');
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
                    </div>
                  );
                })
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
