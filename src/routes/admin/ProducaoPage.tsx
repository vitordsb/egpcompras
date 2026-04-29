import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

type OrderStatus = 'rascunho' | 'enviado' | 'em_montagem' | 'concluido' | 'cancelado';

interface ProductionOrder {
  id: string;
  product_name: string;
  quantity_ordered: number;
  quantity_returned: number;
  status: OrderStatus;
  assembler_name: string | null;
  sent_at: string | null;
  returned_at: string | null;
  notes: string | null;
  created_at: string;
}

interface OrderComponent {
  id: string;
  component_name: string;
  component_sku: string | null;
  quantity_sent: number;
  quantity_returned: number;
  quantity_at_assembler: number;
  notes: string | null;
}

interface OrderNote {
  id: string;
  content: string;
  author: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  rascunho:    'Rascunho',
  enviado:     'Enviado',
  em_montagem: 'Em montagem',
  concluido:   'Concluído',
  cancelado:   'Cancelado',
};

const STATUS_PILL: Record<OrderStatus, string> = {
  rascunho:    'bg-slate-100 text-slate-600 border border-slate-200',
  enviado:     'bg-brand-50 text-brand-700 border border-brand-200',
  em_montagem: 'bg-amber-50 text-amber-700 border border-amber-200',
  concluido:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
  cancelado:   'bg-red-50 text-red-600 border border-red-200',
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s + (s.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('pt-BR');
}

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ProducaoPage() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ order: ProductionOrder; components: OrderComponent[]; notes: OrderNote[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('production_orders')
      .select('*')
      .order('created_at', { ascending: false });
    setOrders((data ?? []) as ProductionOrder[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    setLoadingDetail(true);
    Promise.all([
      supabase.from('production_orders').select('*').eq('id', detailId).single(),
      supabase.from('production_order_components').select('*').eq('production_order_id', detailId),
      supabase.from('production_order_notes').select('*').eq('production_order_id', detailId).order('created_at'),
    ]).then(([orderRes, compsRes, notesRes]) => {
      setDetail({
        order: orderRes.data as ProductionOrder,
        components: (compsRes.data ?? []) as OrderComponent[],
        notes: (notesRes.data ?? []) as OrderNote[],
      });
      setLoadingDetail(false);
    });
  }, [detailId]);

  const filtered = orders.filter((o) => statusFilter === 'all' || o.status === statusFilter);

  const stats = orders.reduce(
    (acc, o) => { acc[o.status] = (acc[o.status] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  const STAT_CARDS = [
    { key: 'all',         label: 'Todas',        value: orders.length,            color: 'text-slate-900' },
    { key: 'enviado',     label: 'Enviadas',      value: stats.enviado ?? 0,       color: 'text-brand-700' },
    { key: 'em_montagem', label: 'Em montagem',   value: stats.em_montagem ?? 0,   color: 'text-amber-700' },
    { key: 'concluido',   label: 'Concluídas',    value: stats.concluido ?? 0,     color: 'text-emerald-700' },
  ] as const;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Produção</h1>
          <p className="text-sm text-slate-500">
            Romaneios enviados à montadora. Rastreio de componentes enviados, sobras e produtos devolvidos.
          </p>
        </div>
      </div>

      {/* Info como usar */}
      <div className="mb-6 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
        <strong>Como registrar via chat EGP:</strong>
        {' '}<em>"foi para a montadora o equivalente para montagem de 1000 12v"</em>
        {' '}ou{' '}<em>"voltou da montadora 980 peças do 12v, trouxe de volta 200 capacitores"</em>
      </div>

      {/* Stats */}
      <div className="mb-6 grid gap-3 grid-cols-2 sm:grid-cols-4">
        {STAT_CARDS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStatusFilter(s.key as OrderStatus | 'all')}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              statusFilter === s.key ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50'
            )}
          >
            <div className="text-xs uppercase tracking-wide text-slate-500">{s.label}</div>
            <div className={cn('mt-1 text-2xl font-semibold', s.color)}>{s.value}</div>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">
              Nenhuma ordem de produção registrada. Use o chat EGP para criar a primeira.
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Produto</th>
                  <th className="px-5 py-3">Montadora</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Enviado</th>
                  <th className="px-5 py-3 text-right">Devolvido</th>
                  <th className="px-5 py-3">Envio</th>
                  <th className="px-5 py-3">Retorno</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{o.product_name}</td>
                    <td className="px-5 py-3 text-slate-500">{o.assembler_name ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_PILL[o.status])}>
                        {STATUS_LABEL[o.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-900">
                      {o.quantity_ordered}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {o.status === 'concluido' ? (
                        <span className={cn('font-medium', o.quantity_returned < o.quantity_ordered ? 'text-amber-700' : 'text-emerald-700')}>
                          {o.quantity_returned}
                          {o.quantity_returned < o.quantity_ordered && (
                            <span className="ml-1 text-[10px] text-amber-500">
                              ({o.quantity_ordered - o.quantity_returned} a menos)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{fmtDate(o.sent_at)}</td>
                    <td className="px-5 py-3 text-slate-500">{fmtDate(o.returned_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDetailId(o.id)}
                        className="text-brand-600 hover:underline text-xs"
                      >
                        ver detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Painel de detalhes */}
      {detailId && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setDetailId(null)}
        >
          <div
            className="flex h-[min(800px,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {loadingDetail || !detail ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Carregando…</div>
            ) : (
              <>
                {/* Header */}
                <div className="border-b border-slate-200 px-5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">{detail.order.product_name}</h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className={cn('rounded-full px-2 py-0.5 font-medium', STATUS_PILL[detail.order.status])}>
                          {STATUS_LABEL[detail.order.status]}
                        </span>
                        {detail.order.assembler_name && <span>Montadora: <strong>{detail.order.assembler_name}</strong></span>}
                        <span>Enviado em {fmtDate(detail.order.sent_at)}</span>
                        {detail.order.returned_at && <span>· Retornou {fmtDate(detail.order.returned_at)}</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => setDetailId(null)} className="text-slate-400 hover:text-slate-600">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="mt-3 flex gap-6 text-sm">
                    <div>
                      <span className="text-xs text-slate-400">Enviado</span>
                      <div className="font-semibold text-slate-900">{detail.order.quantity_ordered} un.</div>
                    </div>
                    {detail.order.status === 'concluido' && (
                      <div>
                        <span className="text-xs text-slate-400">Devolvido</span>
                        <div className={cn('font-semibold', detail.order.quantity_returned < detail.order.quantity_ordered ? 'text-amber-700' : 'text-emerald-700')}>
                          {detail.order.quantity_returned} un.
                        </div>
                      </div>
                    )}
                  </div>
                  {detail.order.notes && (
                    <p className="mt-2 text-xs text-slate-500">{detail.order.notes}</p>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto">
                  {/* Componentes */}
                  <div className="px-5 py-3">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Componentes</h3>
                    <table className="w-full text-xs">
                      <thead className="border-b border-slate-100 text-left text-[11px] uppercase text-slate-400">
                        <tr>
                          <th className="pb-1.5">Componente</th>
                          <th className="pb-1.5 text-right">Enviado</th>
                          <th className="pb-1.5 text-right">Na montadora</th>
                          <th className="pb-1.5 text-right">Voltou</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {detail.components.map((c) => (
                          <tr key={c.id}>
                            <td className="py-1.5">
                              <div className="font-medium text-slate-800">{c.component_name}</div>
                              {c.component_sku && <div className="font-mono text-[10px] text-slate-400">{c.component_sku}</div>}
                              {c.notes && <div className="text-amber-600">{c.notes}</div>}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-slate-600">{c.quantity_sent}</td>
                            <td className="py-1.5 text-right tabular-nums">
                              {Number(c.quantity_at_assembler) > 0
                                ? <span className="text-amber-600 font-medium">{c.quantity_at_assembler}</span>
                                : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {Number(c.quantity_returned) > 0
                                ? <span className="text-emerald-600 font-medium">{c.quantity_returned}</span>
                                : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Observações */}
                  {detail.notes.length > 0 && (
                    <div className="border-t border-slate-100 px-5 py-3">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Observações</h3>
                      <div className="space-y-2">
                        {detail.notes.map((n) => (
                          <div key={n.id} className="text-xs">
                            <span className="text-slate-700">{n.content}</span>
                            <span className="ml-2 text-slate-400">{fmtDateTime(n.created_at)}{n.author ? ` · ${n.author}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
