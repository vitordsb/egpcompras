import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import type { RmaRow, RmaStatus } from './rmas-shared';
import { STATUS_LABEL, MOTIVO_LABEL, formatDateBR } from './rmas-shared';

interface ColumnDef {
  key: RmaStatus;
  label: string;
  headerClass: string;
  countClass: string;
  emptyHint: string;
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'recebido',
    label: 'Recebido',
    headerClass: 'bg-blue-50 border-blue-200 text-blue-800',
    countClass: 'bg-blue-100 text-blue-700',
    emptyHint: 'Nenhum RMA recém-chegado.',
  },
  {
    key: 'analise',
    label: 'Em análise',
    headerClass: 'bg-amber-50 border-amber-200 text-amber-800',
    countClass: 'bg-amber-100 text-amber-700',
    emptyHint: 'Sem RMAs em análise.',
  },
  {
    key: 'conserto',
    label: 'Em conserto',
    headerClass: 'bg-purple-50 border-purple-200 text-purple-800',
    countClass: 'bg-purple-100 text-purple-700',
    emptyHint: 'Sem RMAs em conserto.',
  },
  {
    key: 'pronto',
    label: 'Pronto p/ devolver',
    headerClass: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    countClass: 'bg-emerald-100 text-emerald-700',
    emptyHint: 'Sem RMAs prontos.',
  },
  {
    key: 'devolvido',
    label: 'Devolvido',
    headerClass: 'bg-slate-50 border-slate-200 text-slate-700',
    countClass: 'bg-slate-100 text-slate-700',
    emptyHint: 'Nenhum RMA devolvido ainda.',
  },
];

const STATUS_FLOW: RmaStatus[] = ['recebido', 'analise', 'conserto', 'pronto', 'devolvido'];

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
  const [hoverColumn, setHoverColumn] = useState<RmaStatus | null>(null);
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
    const acc: Record<RmaStatus, RmaRow[]> = {
      recebido: [], analise: [], conserto: [], pronto: [], devolvido: [], cancelado: [],
    };
    for (const r of rmas) {
      if (acc[r.status]) acc[r.status].push(r);
    }
    return acc;
  }, [rmas]);

  function onDragStart(e: DragEvent<HTMLDivElement>, r: RmaRow) {
    setDraggingId(r.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', r.id);
  }
  function onDragEnd() {
    setDraggingId(null);
    setHoverColumn(null);
  }
  function onDragOver(e: DragEvent<HTMLDivElement>, col: RmaStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (hoverColumn !== col) setHoverColumn(col);
  }
  function onDragLeave(col: RmaStatus) {
    if (hoverColumn === col) setHoverColumn(null);
  }
  function onDrop(e: DragEvent<HTMLDivElement>, target: RmaStatus) {
    e.preventDefault();
    setHoverColumn(null);
    const id = e.dataTransfer.getData('text/plain');
    const r = rmas.find((x) => x.id === id);
    setDraggingId(null);
    if (!r || r.status === target) return;
    onMoveToColumn(r, target);
  }

  function nextStatus(current: RmaStatus): RmaStatus | null {
    const idx = STATUS_FLOW.indexOf(current);
    return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            onDragOver={(e) => onDragOver(e, col.key)}
            onDragLeave={() => onDragLeave(col.key)}
            onDrop={(e) => onDrop(e, col.key)}
            className={cn(
              'flex h-[calc(100vh-12rem)] min-h-[400px] flex-col rounded-lg border bg-slate-50/50 transition-colors',
              hoverColumn === col.key && 'border-brand-400 bg-brand-50/40 ring-2 ring-brand-200'
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
                  const next = nextStatus(r.status);
                  return (
                    <div
                      key={r.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, r)}
                      onDragEnd={onDragEnd}
                      onClick={() => onCardClick(r.id)}
                      className={cn(
                        'group cursor-pointer rounded-md border border-slate-200 bg-white p-3 shadow-sm transition-all hover:border-brand-300 hover:shadow-md',
                        draggingId === r.id && 'opacity-40'
                      )}
                      title="Clique para detalhes — arraste para mover de coluna"
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
                        {next && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onMoveToColumn(r, next);
                            }}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-brand-50 hover:text-brand-700"
                            title={`Avançar para ${STATUS_LABEL[next]}`}
                          >
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8h10m-3-3 3 3-3 3" />
                            </svg>
                            {STATUS_LABEL[next]}
                          </button>
                        )}
                        <span className="text-slate-300">·</span>
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
