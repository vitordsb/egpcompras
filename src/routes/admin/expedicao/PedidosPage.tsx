import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { Product, Shipment, ShipmentObservation, ShipmentStatus } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, STATUS_PILL, formatDate, formatDateTime } from './shared';

interface ShipmentRow extends Shipment {
  observations_count?: number;
}

interface ItemRow {
  id?: string;
  product_id: string;
  product_name: string;
  quantity: number | null;
}

interface FormState {
  id: string | null;
  client_name: string;
  numero_nfe: string;
  data_prevista: string;
  notes: string;
  items: ItemRow[];
}

const emptyForm: FormState = {
  id: null,
  client_name: '',
  numero_nfe: '',
  data_prevista: '',
  notes: '',
  items: [],
};

export default function PedidosPage() {
  const [list, setList] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailObservations, setDetailObservations] = useState<ShipmentObservation[]>([]);
  const [detailItems, setDetailItems] = useState<
    Array<{ id: string; quantity: number; product: { id: string; name: string } | null }>
  >([]);
  const [newObservation, setNewObservation] = useState('');
  const [savingObs, setSavingObs] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<ShipmentRow | null>(null);

  async function loadList() {
    setLoading(true);
    const { data, error } = await supabase
      .from('shipments')
      .select(
        `id, client_name, numero_nfe, status, data_prevista, data_saida, data_retorno, notes, created_at, updated_at,
         observations:shipment_observations(id)`
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) setListError(error.message);
    else
      setList(
        (data ?? []).map((row: any) => ({
          ...row,
          observations_count: row.observations?.length ?? 0,
        })) as ShipmentRow[]
      );
    setLoading(false);
  }

  async function loadProducts() {
    const { data } = await supabase.from('products').select('id, name, sku').order('name');
    setProducts((data ?? []) as Product[]);
  }

  useEffect(() => {
    loadList();
    loadProducts();
  }, []);

  // ---- Filtros -----------------------------------------------------

  const filtered = useMemo(() => {
    return list.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${s.client_name} ${s.numero_nfe ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list, statusFilter, search]);

  // ---- Form de criar/editar ---------------------------------------

  function openCreate() {
    setForm(emptyForm);
    setFormError(null);
  }

  async function openEdit(s: ShipmentRow) {
    setFormError(null);
    const { data: items } = await supabase
      .from('shipment_items')
      .select('id, quantity, product:products(id, name)')
      .eq('shipment_id', s.id);
    setForm({
      id: s.id,
      client_name: s.client_name,
      numero_nfe: s.numero_nfe ?? '',
      data_prevista: s.data_prevista ?? '',
      notes: s.notes ?? '',
      items: ((items ?? []) as any[]).map((it) => ({
        id: it.id,
        product_id: it.product?.id ?? '',
        product_name: it.product?.name ?? '',
        quantity: Number(it.quantity),
      })),
    });
  }

  function closeForm() {
    setForm(null);
    setFormError(null);
  }

  function patchForm(patch: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function addItemRow() {
    if (!form) return;
    patchForm({
      items: [...form.items, { product_id: '', product_name: '', quantity: null }],
    });
  }

  function updateItemRow(idx: number, patch: Partial<ItemRow>) {
    if (!form) return;
    patchForm({
      items: form.items.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });
  }

  function removeItemRow(idx: number) {
    if (!form) return;
    patchForm({ items: form.items.filter((_, i) => i !== idx) });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormError(null);
    if (!form.client_name.trim()) return setFormError('Cliente é obrigatório.');
    const invalid = form.items.find(
      (r) => !r.product_id || r.quantity == null || r.quantity <= 0
    );
    if (invalid) {
      return setFormError('Cada item precisa ter produto selecionado e qtd > 0.');
    }
    setSaving(true);

    const payload: any = {
      client_name: form.client_name.trim(),
      numero_nfe: form.numero_nfe.trim() || null,
      data_prevista: form.data_prevista || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let shipmentId = form.id;
    if (shipmentId) {
      const { error } = await supabase.from('shipments').update(payload).eq('id', shipmentId);
      if (error) {
        setFormError(error.message);
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from('shipments')
        .insert(payload)
        .select('id')
        .single();
      if (error || !data) {
        setFormError(error?.message ?? 'Falha ao criar pedido');
        setSaving(false);
        return;
      }
      shipmentId = data.id as string;
    }

    // Re-grava itens (estratégia simples)
    await supabase.from('shipment_items').delete().eq('shipment_id', shipmentId);
    if (form.items.length > 0) {
      const itemsPayload = form.items.map((it) => ({
        shipment_id: shipmentId,
        product_id: it.product_id,
        quantity: it.quantity,
      }));
      const { error: itemsErr } = await supabase.from('shipment_items').insert(itemsPayload);
      if (itemsErr) {
        setFormError(itemsErr.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    closeForm();
    await loadList();
  }

  // ---- Status mutation --------------------------------------------

  async function changeStatus(s: ShipmentRow, newStatus: ShipmentStatus) {
    const payload: any = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'shipped') payload.data_saida = new Date().toISOString();
    if (newStatus === 'returned') payload.data_retorno = new Date().toISOString();
    const { error } = await supabase.from('shipments').update(payload).eq('id', s.id);
    if (error) {
      alert(`Erro: ${error.message}`);
      return;
    }
    await loadList();
  }

  // ---- Detalhes (modal de timeline) -------------------------------

  useEffect(() => {
    if (!detailId) {
      setDetailObservations([]);
      setDetailItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [obs, items] = await Promise.all([
        supabase
          .from('shipment_observations')
          .select('*')
          .eq('shipment_id', detailId)
          .order('created_at', { ascending: false }),
        supabase
          .from('shipment_items')
          .select('id, quantity, product:products(id, name)')
          .eq('shipment_id', detailId),
      ]);
      if (cancelled) return;
      setDetailObservations((obs.data ?? []) as ShipmentObservation[]);
      setDetailItems((items.data ?? []) as any[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  async function addObservation() {
    if (!detailId || !newObservation.trim()) return;
    setSavingObs(true);
    const { error } = await supabase
      .from('shipment_observations')
      .insert({ shipment_id: detailId, content: newObservation.trim() });
    if (error) {
      alert(`Erro: ${error.message}`);
      setSavingObs(false);
      return;
    }
    setNewObservation('');
    setSavingObs(false);
    // Recarrega
    const { data } = await supabase
      .from('shipment_observations')
      .select('*')
      .eq('shipment_id', detailId)
      .order('created_at', { ascending: false });
    setDetailObservations((data ?? []) as ShipmentObservation[]);
    // Atualiza count na lista
    await loadList();
  }

  async function deleteObservation(obsId: string) {
    if (!confirm('Apagar essa observação?')) return;
    const { error } = await supabase.from('shipment_observations').delete().eq('id', obsId);
    if (error) {
      alert(`Erro: ${error.message}`);
      return;
    }
    setDetailObservations((prev) => prev.filter((o) => o.id !== obsId));
    await loadList();
  }

  async function doDelete() {
    if (!confirmDelete) return;
    const { error } = await supabase.from('shipments').delete().eq('id', confirmDelete.id);
    if (error) {
      alert(`Erro: ${error.message}`);
      return;
    }
    setConfirmDelete(null);
    await loadList();
  }

  const detailShipment = list.find((s) => s.id === detailId) ?? null;

  // ---- Stats por status -------------------------------------------

  const stats = useMemo(() => {
    const byStatus = { pending: 0, shipped: 0, returned: 0, cancelled: 0 };
    for (const s of list) byStatus[s.status]++;
    const withObs = list.filter((s) => (s.observations_count ?? 0) > 0).length;
    return { ...byStatus, withObs };
  }, [list]);

  // ---- Render -----------------------------------------------------

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pedidos</h1>
          <p className="text-sm text-slate-500">
            Workflow ativo: pedidos pendentes e em rota. Histórico de saídas e observações
            estão em sub-páginas separadas.
          </p>
        </div>
        <Button onClick={openCreate}>+ Novo pedido</Button>
      </div>

      {listError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {listError}
        </div>
      )}

      {/* Cards de stats */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            { key: 'all', label: 'Total', value: list.length, color: 'text-slate-900' },
            { key: 'pending', label: 'Pendentes', value: stats.pending, color: 'text-amber-700' },
            { key: 'shipped', label: 'Saíram', value: stats.shipped, color: 'text-emerald-700' },
            { key: 'returned', label: 'Voltaram', value: stats.returned, color: 'text-sky-700' },
            { key: 'with-obs', label: 'Com observações', value: stats.withObs, color: 'text-purple-700' },
          ] as const
        ).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              if (s.key === 'all' || s.key === 'with-obs') {
                setStatusFilter('all');
              } else {
                setStatusFilter(s.key as ShipmentStatus);
              }
            }}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              statusFilter === s.key ||
                (s.key === 'all' && statusFilter === 'all')
                ? 'border-brand-300 bg-brand-50'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            )}
          >
            <div className="text-xs uppercase tracking-wide text-slate-500">{s.label}</div>
            <div className={cn('mt-1 text-2xl font-semibold', s.color)}>{s.value}</div>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente ou NFe…"
          />
          {(statusFilter !== 'all' || search) && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setSearch('');
              }}
              className="text-xs text-slate-500 hover:underline whitespace-nowrap"
            >
              limpar filtros
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">
              {list.length === 0
                ? 'Nenhum pedido cadastrado ainda.'
                : 'Nenhum pedido bate com os filtros.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">NFe</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Prevista</th>
                  <th className="px-5 py-3">Saiu em</th>
                  <th className="px-5 py-3 text-right">Obs.</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-900">{s.client_name}</td>
                    <td className="px-5 py-3 text-slate-600">{s.numero_nfe ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          STATUS_PILL[s.status]
                        )}
                      >
                        {STATUS_LABEL[s.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(s.data_prevista)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(s.data_saida)}</td>
                    <td className="px-5 py-3 text-right">
                      {(s.observations_count ?? 0) > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                          {s.observations_count}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setDetailId(s.id)}
                          className="text-brand-600 hover:underline"
                        >
                          ver
                        </button>
                        {s.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => changeStatus(s, 'shipped')}
                            className="text-emerald-600 hover:underline"
                          >
                            saiu
                          </button>
                        )}
                        {s.status === 'shipped' && (
                          <button
                            type="button"
                            onClick={() => changeStatus(s, 'returned')}
                            className="text-sky-600 hover:underline"
                          >
                            voltou
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          className="text-slate-600 hover:underline"
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(s)}
                          className="text-red-600 hover:underline"
                        >
                          excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal de criar/editar */}
      {form && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeForm}
        >
          <div
            className="flex h-[min(760px,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={save} className="flex flex-1 flex-col overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  {form.id ? 'Editar pedido' : 'Novo pedido'}
                </h2>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {formError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="ship-client">Cliente *</Label>
                    <Input
                      id="ship-client"
                      value={form.client_name}
                      onChange={(e) => patchForm({ client_name: e.target.value })}
                      placeholder="Nome do cliente"
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label htmlFor="ship-nfe">NFe</Label>
                    <Input
                      id="ship-nfe"
                      value={form.numero_nfe}
                      onChange={(e) => patchForm({ numero_nfe: e.target.value })}
                      placeholder="opcional"
                    />
                  </div>
                  <div>
                    <Label htmlFor="ship-prevista">Data prevista</Label>
                    <Input
                      id="ship-prevista"
                      type="date"
                      value={form.data_prevista}
                      onChange={(e) => patchForm({ data_prevista: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Label className="!mb-0">Itens do pedido</Label>
                    <Button type="button" variant="secondary" size="sm" onClick={addItemRow}>
                      + adicionar
                    </Button>
                  </div>
                  {form.items.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum item adicionado.</p>
                  ) : (
                    <div className="overflow-hidden rounded-md border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="py-2 px-3">Produto</th>
                            <th className="py-2 px-3 w-24">Qtd</th>
                            <th className="py-2 px-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {form.items.map((row, idx) => (
                            <tr key={idx} className="border-t border-slate-100">
                              <td className="py-2 px-3">
                                <select
                                  value={row.product_id}
                                  onChange={(e) => {
                                    const id = e.target.value;
                                    const p = products.find((p) => p.id === id);
                                    updateItemRow(idx, {
                                      product_id: id,
                                      product_name: p?.name ?? '',
                                    });
                                  }}
                                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                                >
                                  <option value="">Selecione…</option>
                                  {products.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 px-3">
                                <Input
                                  type="number"
                                  min={0}
                                  step="1"
                                  value={row.quantity ?? ''}
                                  onChange={(e) =>
                                    updateItemRow(idx, {
                                      quantity:
                                        e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  placeholder="0"
                                  className="h-9"
                                />
                              </td>
                              <td className="py-2 px-3">
                                <button
                                  type="button"
                                  onClick={() => removeItemRow(idx)}
                                  aria-label="remover linha"
                                  className="text-slate-400 hover:text-red-600"
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="ship-notes">Observação geral</Label>
                  <Textarea
                    id="ship-notes"
                    value={form.notes}
                    onChange={(e) => patchForm({ notes: e.target.value })}
                    placeholder="opcional — anotações de cabeçalho do pedido"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
                <Button type="button" variant="secondary" onClick={closeForm}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Criar pedido'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de detalhes (timeline de observações) */}
      {detailId && detailShipment && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setDetailId(null)}
        >
          <div
            className="flex h-[min(760px,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  {detailShipment.client_name}
                </h2>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    STATUS_PILL[detailShipment.status]
                  )}
                >
                  {STATUS_LABEL[detailShipment.status]}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                NFe: {detailShipment.numero_nfe ?? '—'} · Prevista:{' '}
                {formatDate(detailShipment.data_prevista)}
                {detailShipment.data_saida && ` · Saiu: ${formatDate(detailShipment.data_saida)}`}
                {detailShipment.data_retorno &&
                  ` · Voltou: ${formatDate(detailShipment.data_retorno)}`}
              </p>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {detailShipment.notes && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Observação geral
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap">{detailShipment.notes}</div>
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Itens ({detailItems.length})</CardTitle>
                </CardHeader>
                {detailItems.length === 0 ? (
                  <CardBody>
                    <p className="text-sm text-slate-500">Sem itens cadastrados.</p>
                  </CardBody>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-2">Produto</th>
                        <th className="px-5 py-2 text-right">Qtd</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailItems.map((it) => (
                        <tr key={it.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-5 py-2">{it.product?.name ?? '—'}</td>
                          <td className="px-5 py-2 text-right">{Number(it.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Observações ({detailObservations.length})</CardTitle>
                </CardHeader>
                <CardBody className="space-y-3">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Textarea
                        value={newObservation}
                        onChange={(e) => setNewObservation(e.target.value)}
                        placeholder='Ex: "Saiu com 5 peças do produto X faltando"'
                        rows={2}
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={addObservation}
                      disabled={!newObservation.trim() || savingObs}
                    >
                      {savingObs ? '…' : 'Anotar'}
                    </Button>
                  </div>
                  {detailObservations.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhuma observação ainda.</p>
                  ) : (
                    <ul className="space-y-2">
                      {detailObservations.map((o) => (
                        <li
                          key={o.id}
                          className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2"
                        >
                          <div className="flex-1">
                            <p className="text-sm text-slate-800 whitespace-pre-wrap">
                              {o.content}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {formatDateTime(o.created_at)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteObservation(o.id)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            apagar
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <Button type="button" variant="secondary" onClick={() => setDetailId(null)}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de exclusão */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-5">
              <h2 className="text-base font-semibold text-slate-900">Excluir pedido?</h2>
              <p className="mt-1 text-sm text-slate-600">
                Vai apagar <strong>{confirmDelete.client_name}</strong>
                {confirmDelete.numero_nfe ? ` (NFe ${confirmDelete.numero_nfe})` : ''} e todas as
                observações vinculadas.
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <Button type="button" variant="secondary" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={doDelete}>
                Excluir
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
