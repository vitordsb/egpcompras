import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { Product, Shipment, ShipmentObservation, ShipmentStatus } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, STATUS_PILL, formatDate, formatDateTime } from './shared';
import { friendlyDbError } from '@/lib/db-error';

interface ShipmentRow extends Shipment {
  observations_count?: number;
}

interface ItemRow {
  id?: string;
  product_id: string | null;
  product_name: string;
  item_code: string;
  item_name: string;
  unit_price: number | null;
  quantity: number | null;
}

interface FormState {
  id: string | null;
  client_name: string;
  numero_nfe: string;
  numero_venda: string;
  data_venda: string;
  data_prevista: string;
  client_cnpj: string;
  client_phone: string;
  client_email: string;
  client_address: string;
  frete_tipo: string;
  frete_valor: number | null;
  total_produtos: number | null;
  valor_total: number | null;
  forma_pagamento: string;
  condicao_pagamento: string;
  notes: string;
  items: ItemRow[];
}

const emptyForm: FormState = {
  id: null,
  client_name: '',
  numero_nfe: '',
  numero_venda: '',
  data_venda: '',
  data_prevista: '',
  client_cnpj: '',
  client_phone: '',
  client_email: '',
  client_address: '',
  frete_tipo: '',
  frete_valor: null,
  total_produtos: null,
  valor_total: null,
  forma_pagamento: '',
  condicao_pagamento: '',
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
    Array<{
      id: string;
      quantity: number;
      item_code: string | null;
      item_name: string | null;
      unit_price: number | null;
      product: { id: string; name: string } | null;
    }>
  >([]);
  const [newObservation, setNewObservation] = useState('');
  const [savingObs, setSavingObs] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<ShipmentRow | null>(null);

  async function loadList() {
    setLoading(true);
    const { data, error } = await supabase
      .from('shipments')
      .select(
        `id, client_name, numero_nfe, numero_venda, data_venda, status, data_prevista, data_saida, data_retorno,
         client_cnpj, client_phone, client_email, client_address,
         frete_tipo, frete_valor, total_produtos, valor_total, forma_pagamento, condicao_pagamento,
         notes, created_at, updated_at, observations:shipment_observations(id)`
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) setListError(friendlyDbError(error));
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
        const hay = `${s.client_name} ${s.numero_nfe ?? ''} ${s.numero_venda ?? ''}`.toLowerCase();
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
      .select('id, quantity, item_code, item_name, unit_price, product:products(id, name)')
      .eq('shipment_id', s.id);
    setForm({
      id: s.id,
      client_name: s.client_name,
      numero_nfe: s.numero_nfe ?? '',
      numero_venda: s.numero_venda ?? '',
      data_venda: s.data_venda ?? '',
      data_prevista: s.data_prevista ?? '',
      client_cnpj: s.client_cnpj ?? '',
      client_phone: s.client_phone ?? '',
      client_email: s.client_email ?? '',
      client_address: s.client_address ?? '',
      frete_tipo: s.frete_tipo ?? '',
      frete_valor: s.frete_valor,
      total_produtos: s.total_produtos,
      valor_total: s.valor_total,
      forma_pagamento: s.forma_pagamento ?? '',
      condicao_pagamento: s.condicao_pagamento ?? '',
      notes: s.notes ?? '',
      items: ((items ?? []) as any[]).map((it) => ({
        id: it.id,
        product_id: it.product?.id ?? '',
        product_name: it.product?.name ?? '',
        item_code: it.item_code ?? '',
        item_name: it.item_name ?? '',
        unit_price: it.unit_price != null ? Number(it.unit_price) : null,
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
      items: [
        ...form.items,
        {
          product_id: '',
          product_name: '',
          item_code: '',
          item_name: '',
          unit_price: null,
          quantity: null,
        },
      ],
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

  function readNumber(value: string): number | null {
    return value === '' ? null : Number(value);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormError(null);
    if (!form.client_name.trim()) return setFormError('Cliente é obrigatório.');
    const invalid = form.items.find(
      (r) =>
        (!r.product_id && !r.item_name.trim() && !r.item_code.trim()) ||
        r.quantity == null ||
        r.quantity <= 0
    );
    if (invalid) {
      return setFormError('Cada item precisa ter produto ou descrição/código, e qtd > 0.');
    }
    setSaving(true);

    const payload: any = {
      client_name: form.client_name.trim(),
      numero_nfe: form.numero_nfe.trim() || null,
      numero_venda: form.numero_venda.trim() || null,
      data_venda: form.data_venda || null,
      data_prevista: form.data_prevista || null,
      client_cnpj: form.client_cnpj.trim() || null,
      client_phone: form.client_phone.trim() || null,
      client_email: form.client_email.trim() || null,
      client_address: form.client_address.trim() || null,
      frete_tipo: form.frete_tipo.trim() || null,
      frete_valor: form.frete_valor,
      total_produtos: form.total_produtos,
      valor_total: form.valor_total,
      forma_pagamento: form.forma_pagamento.trim() || null,
      condicao_pagamento: form.condicao_pagamento.trim() || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let shipmentId = form.id;
    if (shipmentId) {
      const { error } = await supabase.from('shipments').update(payload).eq('id', shipmentId);
      if (error) {
        setFormError(friendlyDbError(error));
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
        setFormError(friendlyDbError(error ?? new Error('Falha ao criar pedido')));
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
        product_id: it.product_id || null,
        item_code: it.item_code.trim() || null,
        item_name: it.item_name.trim() || it.product_name || null,
        unit_price: it.unit_price,
        quantity: it.quantity,
      }));
      const { error: itemsErr } = await supabase.from('shipment_items').insert(itemsPayload);
      if (itemsErr) {
        setFormError(friendlyDbError(itemsErr));
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
    const label = newStatus === 'shipped' ? 'saiu' : 'voltou';
    if (!window.confirm(`Confirma que o pedido de ${s.client_name} ${label}?`)) return;
    const payload: any = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'shipped') payload.data_saida = new Date().toISOString();
    if (newStatus === 'returned') payload.data_retorno = new Date().toISOString();
    const { error } = await supabase.from('shipments').update(payload).eq('id', s.id);
    if (error) {
      alert(friendlyDbError(error));
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
          .select('id, quantity, item_code, item_name, unit_price, product:products(id, name)')
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
      alert(friendlyDbError(error));
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
      alert(friendlyDbError(error));
      return;
    }
    setDetailObservations((prev) => prev.filter((o) => o.id !== obsId));
    await loadList();
  }

  async function doDelete() {
    if (!confirmDelete) return;
    const { error } = await supabase.from('shipments').delete().eq('id', confirmDelete.id);
    if (error) {
      alert(friendlyDbError(error));
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
                  <th className="px-5 py-3">Venda / NFe</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Prevista</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">Obs.</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900">{s.client_name}</div>
                      {s.client_cnpj && <div className="text-xs text-slate-400">{s.client_cnpj}</div>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {s.numero_venda ? <span className="font-medium">#{s.numero_venda}</span> : null}
                      {s.numero_venda && s.numero_nfe ? <span className="text-slate-300"> · </span> : null}
                      {s.numero_nfe ? <span className="text-xs">NFe {s.numero_nfe}</span> : null}
                      {!s.numero_venda && !s.numero_nfe ? '—' : null}
                    </td>
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
                    <td className="px-5 py-3 text-right text-slate-600">
                      {s.valor_total != null ? `R$ ${Number(s.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
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
            className="flex h-[min(820px,92vh)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
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

                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="sm:col-span-4">
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
                    <Label htmlFor="ship-venda">Venda</Label>
                    <Input
                      id="ship-venda"
                      value={form.numero_venda}
                      onChange={(e) => patchForm({ numero_venda: e.target.value })}
                      placeholder="ex: 5785"
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
                    <Label htmlFor="ship-data-venda">Data venda</Label>
                    <Input
                      id="ship-data-venda"
                      type="date"
                      value={form.data_venda}
                      onChange={(e) => patchForm({ data_venda: e.target.value })}
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

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ship-cnpj">CNPJ / CPF</Label>
                    <Input
                      id="ship-cnpj"
                      value={form.client_cnpj}
                      onChange={(e) => patchForm({ client_cnpj: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ship-phone">Telefone</Label>
                    <Input
                      id="ship-phone"
                      value={form.client_phone}
                      onChange={(e) => patchForm({ client_phone: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="ship-email">Email</Label>
                    <Input
                      id="ship-email"
                      type="email"
                      value={form.client_email}
                      onChange={(e) => patchForm({ client_email: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="ship-address">Endereço</Label>
                    <Textarea
                      id="ship-address"
                      value={form.client_address}
                      onChange={(e) => patchForm({ client_address: e.target.value })}
                      rows={2}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="ship-total-products">Total produtos</Label>
                    <Input
                      id="ship-total-products"
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.total_produtos ?? ''}
                      onChange={(e) => patchForm({ total_produtos: readNumber(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ship-frete">Frete</Label>
                    <Input
                      id="ship-frete"
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.frete_valor ?? ''}
                      onChange={(e) => patchForm({ frete_valor: readNumber(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ship-total">Valor total</Label>
                    <Input
                      id="ship-total"
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.valor_total ?? ''}
                      onChange={(e) => patchForm({ valor_total: readNumber(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ship-frete-tipo">Tipo de frete</Label>
                    <Input
                      id="ship-frete-tipo"
                      value={form.frete_tipo}
                      onChange={(e) => patchForm({ frete_tipo: e.target.value })}
                      placeholder="SEDEX, PAC, retirada..."
                    />
                  </div>
                  <div>
                    <Label htmlFor="ship-forma-pag">Forma pagamento</Label>
                    <Input
                      id="ship-forma-pag"
                      value={form.forma_pagamento}
                      onChange={(e) => patchForm({ forma_pagamento: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ship-cond-pag">Condição</Label>
                    <Input
                      id="ship-cond-pag"
                      value={form.condicao_pagamento}
                      onChange={(e) => patchForm({ condicao_pagamento: e.target.value })}
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
                            <th className="py-2 px-3 w-28">Código</th>
                            <th className="py-2 px-3">Item</th>
                            <th className="py-2 px-3 w-56">Produto vinculado</th>
                            <th className="py-2 px-3 w-24">Qtd</th>
                            <th className="py-2 px-3 w-32">Unit.</th>
                            <th className="py-2 px-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {form.items.map((row, idx) => (
                            <tr key={idx} className="border-t border-slate-100">
                              <td className="py-2 px-3">
                                <Input
                                  value={row.item_code}
                                  onChange={(e) => updateItemRow(idx, { item_code: e.target.value })}
                                  placeholder="cod"
                                  className="h-9"
                                />
                              </td>
                              <td className="py-2 px-3">
                                <Input
                                  value={row.item_name}
                                  onChange={(e) => updateItemRow(idx, { item_name: e.target.value })}
                                  placeholder="Descrição do item"
                                  className="h-9"
                                />
                              </td>
                              <td className="py-2 px-3">
                                <select
                                  value={row.product_id ?? ''}
                                  onChange={(e) => {
                                    const id = e.target.value;
                                    const p = products.find((p) => p.id === id);
                                    updateItemRow(idx, {
                                      product_id: id || null,
                                      product_name: p?.name ?? '',
                                      item_name: row.item_name || p?.name || '',
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
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={row.unit_price ?? ''}
                                  onChange={(e) =>
                                    updateItemRow(idx, {
                                      unit_price: readNumber(e.target.value),
                                    })
                                  }
                                  placeholder="0,00"
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
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                {detailShipment.numero_venda && <span>Venda #{detailShipment.numero_venda}</span>}
                {detailShipment.data_venda && <span>Emitido {formatDate(detailShipment.data_venda)}</span>}
                {detailShipment.numero_nfe && <span>NFe {detailShipment.numero_nfe}</span>}
                {detailShipment.data_prevista && <span>Prevista {formatDate(detailShipment.data_prevista)}</span>}
                {detailShipment.data_saida && <span>Saiu {formatDate(detailShipment.data_saida)}</span>}
                {detailShipment.data_retorno && <span>Voltou {formatDate(detailShipment.data_retorno)}</span>}
              </div>
              {(detailShipment.client_cnpj || detailShipment.client_phone || detailShipment.client_email) && (
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                  {detailShipment.client_cnpj && <span>{detailShipment.client_cnpj}</span>}
                  {detailShipment.client_phone && <span>{detailShipment.client_phone}</span>}
                  {detailShipment.client_email && <span>{detailShipment.client_email}</span>}
                </div>
              )}
              {(detailShipment.valor_total != null || detailShipment.frete_tipo) && (
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                  {detailShipment.frete_tipo && <span>Frete: {detailShipment.frete_tipo}{detailShipment.frete_valor ? ` R$ ${Number(detailShipment.frete_valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}</span>}
                  {detailShipment.valor_total != null && <span className="font-medium text-slate-600">Total: R$ {Number(detailShipment.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                  {detailShipment.forma_pagamento && <span>{detailShipment.forma_pagamento}{detailShipment.condicao_pagamento ? ` · ${detailShipment.condicao_pagamento}` : ''}</span>}
                </div>
              )}
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
                        <th className="px-5 py-2">Cód.</th>
                        <th className="px-5 py-2">Produto / Item</th>
                        <th className="px-5 py-2 text-right">Qtd</th>
                        <th className="px-5 py-2 text-right">Unit.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailItems.map((it: any) => (
                        <tr key={it.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-5 py-2 text-xs text-slate-400">{it.item_code ?? '—'}</td>
                          <td className="px-5 py-2">
                            {it.product?.name ?? it.item_name ?? '—'}
                          </td>
                          <td className="px-5 py-2 text-right">{Number(it.quantity)}</td>
                          <td className="px-5 py-2 text-right text-slate-500">
                            {it.unit_price != null ? `R$ ${Number(it.unit_price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                          </td>
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
