import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useInternalAuth } from '@/lib/auth-context';

type NeedStatus = 'pendente' | 'pedido' | 'chegou' | 'cancelado';

interface PurchaseRow {
  id: string;
  item_name: string;
  item_code: string | null;
  quantity: number | null;
  ordered_quantity: number | null;
  unit: string | null;
  status: NeedStatus;
  expected_arrival: string | null;
  carrier: string | null;
  ordered_at: string | null;
  updated_at: string;
  shipment: {
    id: string;
    client_name: string;
    numero_venda: string | null;
  } | null;
}

type DerivedStatus = 'pedido' | 'cobrar' | 'chegou';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function deriveStatus(r: PurchaseRow): DerivedStatus {
  if (r.status === 'chegou') return 'chegou';
  if (r.expected_arrival && r.expected_arrival < todayISO()) return 'cobrar';
  return 'pedido';
}

const STATUS_LABEL: Record<DerivedStatus, string> = {
  pedido: 'Encomendado',
  cobrar: 'Cobrar fornecedor',
  chegou: 'Chegou',
};

const STATUS_PILL: Record<DerivedStatus, string> = {
  pedido: 'bg-brand-50 text-brand-700 border border-brand-200',
  cobrar: 'bg-red-50 text-red-700 border border-red-200',
  chegou: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

function fmtDateBR(iso: string | null): string {
  if (!iso) return '—';
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso + 'T12:00:00');
  const now = new Date(todayISO() + 'T12:00:00');
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default function CompradoPage() {
  const toast = useToast();
  const { userLabel } = useInternalAuth();
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DerivedStatus | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<string>('');
  const [editArrival, setEditArrival] = useState<string>('');
  const [editCarrier, setEditCarrier] = useState<string>('');
  const [confirmArrival, setConfirmArrival] = useState<PurchaseRow | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('purchase_needs')
      .select(`id, item_name, item_code, quantity, ordered_quantity, unit, status,
               expected_arrival, carrier, ordered_at, updated_at,
               shipment:shipments(id, client_name, numero_venda)`)
      .in('status', ['pedido', 'chegou'])
      .order('expected_arrival', { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) {
      toast.error('Erro', error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as PurchaseRow[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== 'all' && deriveStatus(r) !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${r.item_name} ${r.item_code ?? ''} ${r.carrier ?? ''} ${r.shipment?.client_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, search]);

  const stats = useMemo(() => {
    const acc = { all: rows.length, pedido: 0, cobrar: 0, chegou: 0 };
    for (const r of rows) acc[deriveStatus(r)]++;
    return acc;
  }, [rows]);

  function startEdit(r: PurchaseRow) {
    setEditingId(r.id);
    setEditQty(String(r.ordered_quantity ?? r.quantity ?? ''));
    setEditArrival(r.expected_arrival ?? '');
    setEditCarrier(r.carrier ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditQty('');
    setEditArrival('');
    setEditCarrier('');
  }

  async function saveEdit(r: PurchaseRow) {
    setSavingId(r.id);
    const payload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (editQty.trim() !== '') payload.ordered_quantity = Number(editQty);
    payload.expected_arrival = editArrival || null;
    payload.carrier = editCarrier.trim() || null;

    const { error } = await supabase.from('purchase_needs').update(payload).eq('id', r.id);
    if (error) {
      toast.error('Erro', error.message);
      setSavingId(null);
      return;
    }
    toast.success('Atualizado', `${r.item_name} salvo.`);
    setSavingId(null);
    cancelEdit();
    await load();
  }

  // Marca como chegou + alimenta estoque
  async function markArrived(r: PurchaseRow) {
    setSavingId(r.id);
    try {
      const qty = Number(r.ordered_quantity ?? r.quantity ?? 0);
      if (!(qty > 0)) {
        toast.error('Erro', 'Quantidade inválida — edite o pedido antes de marcar como chegou.');
        return;
      }
      // 1) muda status do purchase_need
      const { error: updErr } = await supabase
        .from('purchase_needs')
        .update({ status: 'chegou', updated_at: new Date().toISOString() })
        .eq('id', r.id);
      if (updErr) throw new Error(updErr.message);

      // 2) localiza ou cria stock_item pelo nome/código
      const code = (r.item_code ?? r.item_name).trim().toUpperCase().replace(/\s+/g, '_');
      const { data: existing } = await supabase
        .from('stock_items')
        .select('id, quantity')
        .ilike('item_code', code)
        .maybeSingle();

      let stockItemId: string;
      let prevQty = 0;
      if (existing) {
        stockItemId = (existing as any).id;
        prevQty = Number((existing as any).quantity);
        const { error: incErr } = await supabase
          .from('stock_items')
          .update({ quantity: prevQty + qty, updated_at: new Date().toISOString() })
          .eq('id', stockItemId);
        if (incErr) throw new Error(incErr.message);
      } else {
        const { data: created, error: insErr } = await supabase
          .from('stock_items')
          .insert({ item_code: code, item_name: r.item_name, quantity: qty, unit: r.unit ?? 'un' })
          .select('id')
          .single();
        if (insErr || !created) throw new Error(insErr?.message ?? 'Falha ao criar stock_item');
        stockItemId = (created as any).id;
      }

      // 3) registra movimento de entrada
      await supabase.from('stock_movements').insert({
        item_code: code,
        item_name: r.item_name,
        type: 'entrada',
        quantity: qty,
        notes: `Chegada do pedido${r.shipment?.numero_venda ? ` #${r.shipment.numero_venda}` : ''}${r.carrier ? ` via ${r.carrier}` : ''}`,
        created_by: userLabel ?? null,
      });

      toast.success('Chegou ✓', `${qty} ${r.unit ?? 'un'} de ${r.item_name} adicionado(s) ao estoque.`);
      await load();
    } catch (err) {
      toast.error('Erro', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
      setConfirmArrival(null);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Comprado</h1>
          <p className="text-sm text-slate-500">
            Itens encomendados de fornecedores — acompanhe a chegada e marque para alimentar o estoque automaticamente.
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-white p-0.5">
          {(
            [
              { key: 'all',    label: 'Todos',                count: stats.all },
              { key: 'pedido', label: 'Encomendados',         count: stats.pedido },
              { key: 'cobrar', label: 'Cobrar fornecedor',    count: stats.cobrar },
              { key: 'chegou', label: 'Chegou',               count: stats.chegou },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setStatusFilter(opt.key as typeof statusFilter)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                statusFilter === opt.key
                  ? opt.key === 'cobrar'
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              {opt.label}
              <span className={cn(
                'inline-flex min-w-[20px] items-center justify-center rounded-full px-1 py-0.5 text-[10px] font-semibold',
                statusFilter === opt.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
              )}>{opt.count}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por item, código, cliente ou transportadora…"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">
              {rows.length === 0
                ? 'Nada encomendado ou chegou ainda. Use a IA ou a página Falta Comprar para registrar pedidos a fornecedores.'
                : 'Nenhum item bate com os filtros.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3 text-right">Qtd encomendada</th>
                  <th className="px-5 py-3">Chegada prevista</th>
                  <th className="px-5 py-3">Transportadora</th>
                  <th className="px-5 py-3">Pedido</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const status = deriveStatus(r);
                  const days = daysUntil(r.expected_arrival);
                  const isEditing = editingId === r.id;
                  return (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 align-top">
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-900">{r.item_name}</div>
                        {r.item_code && <div className="text-xs text-slate-400">{r.item_code}</div>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editQty}
                            onChange={(e) => setEditQty(e.target.value)}
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                            min="0"
                            step="any"
                          />
                        ) : (
                          <span className="text-slate-700">
                            {r.ordered_quantity ?? r.quantity ?? '—'} <span className="text-xs text-slate-400">{r.unit ?? 'un'}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {isEditing ? (
                          <input
                            type="date"
                            value={editArrival}
                            onChange={(e) => setEditArrival(e.target.value)}
                            className="rounded border border-slate-300 px-2 py-1 text-sm"
                          />
                        ) : r.expected_arrival ? (
                          <div>
                            <div className="text-slate-700">{fmtDateBR(r.expected_arrival)}</div>
                            {status !== 'chegou' && days != null && (
                              <div className={cn(
                                'text-xs',
                                days < 0 ? 'text-red-600 font-medium' : days <= 2 ? 'text-amber-600' : 'text-slate-400'
                              )}>
                                {days < 0
                                  ? `${Math.abs(days)} dia(s) atrasado`
                                  : days === 0
                                    ? 'hoje'
                                    : `em ${days} dia(s)`}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">sem previsão</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editCarrier}
                            onChange={(e) => setEditCarrier(e.target.value)}
                            placeholder="Ex: JadLog"
                            className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
                          />
                        ) : (
                          <span className="text-slate-600">{r.carrier ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {r.shipment ? (
                          <div>
                            <div className="text-slate-700">{r.shipment.client_name}</div>
                            {r.shipment.numero_venda && (
                              <div className="text-slate-400">#{r.shipment.numero_venda}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">produção</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', STATUS_PILL[status])}>
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="secondary" onClick={cancelEdit} disabled={savingId === r.id}>
                              Cancelar
                            </Button>
                            <Button type="button" size="sm" onClick={() => saveEdit(r)} disabled={savingId === r.id}>
                              {savingId === r.id ? 'Salvando…' : 'Salvar'}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            {status !== 'chegou' && (
                              <button
                                type="button"
                                onClick={() => setConfirmArrival(r)}
                                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                              >
                                Marcar chegou
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => startEdit(r)}
                              className="text-xs text-brand-600 hover:underline"
                            >
                              editar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {confirmArrival && (
        <ConfirmModal
          title="Confirmar chegada"
          description={
            `Marcar ${confirmArrival.ordered_quantity ?? confirmArrival.quantity ?? '?'} ${confirmArrival.unit ?? 'un'} de "${confirmArrival.item_name}" como chegou? Isso vai adicionar ao estoque automaticamente.`
          }
          confirmLabel="Sim, chegou"
          onConfirm={() => markArrived(confirmArrival)}
          onCancel={() => setConfirmArrival(null)}
        />
      )}
    </div>
  );
}
