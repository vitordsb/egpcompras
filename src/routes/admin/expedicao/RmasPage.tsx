import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { friendlyDbError } from '@/lib/db-error';
import Pagination from '@/components/ui/Pagination';
import { useInternalAuth } from '@/lib/auth-context';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import RmasKanbanView from './RmasKanbanView';
import {
  STATUS_LABEL, STATUS_PILL, MOTIVO_LABEL, SOLUCAO_LABEL, formatDateBR,
  type RmaRow, type RmaStatus, type RmaMotivo, type RmaSolucao,
} from './rmas-shared';

type ViewMode = 'table' | 'kanban';
const VIEW_KEY = 'rmas.viewMode';

interface ItemRow {
  id?: string;
  product_id: string | null;
  product_name: string;
  item_name: string;
  item_code: string;
  serial_number: string;
  quantity: number;
  notes: string;
}

interface FormState {
  id: string | null;
  numero: number | null;
  client_name: string;
  client_trade_name: string;
  client_cnpj: string;
  client_phone: string;
  client_email: string;
  motivo: RmaMotivo;
  status: RmaStatus;
  diagnostico: string;
  solucao: RmaSolucao;
  data_recebido: string;
  data_devolvido: string;
  numero_venda_origem: string;
  notes: string;
  items: ItemRow[];
}

const emptyForm: FormState = {
  id: null,
  numero: null,
  client_name: '',
  client_trade_name: '',
  client_cnpj: '',
  client_phone: '',
  client_email: '',
  motivo: 'defeito',
  status: 'recebido',
  diagnostico: '',
  solucao: 'pendente',
  data_recebido: new Date().toISOString().slice(0, 10),
  data_devolvido: '',
  numero_venda_origem: '',
  notes: '',
  items: [],
};

const PAGE_SIZE = 12;

export default function RmasPage() {
  const { userLabel } = useInternalAuth();
  const userKey = userLabel ?? 'anon';

  const [list, setList] = useState<RmaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RmaStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    try {
      return (localStorage.getItem(`${VIEW_KEY}:${userKey}`) as ViewMode) === 'kanban' ? 'kanban' : 'table';
    } catch { return 'table'; }
  });
  function setViewMode(m: ViewMode) {
    setViewModeState(m);
    try { localStorage.setItem(`${VIEW_KEY}:${userKey}`, m); } catch {}
  }

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailItems, setDetailItems] = useState<any[]>([]);
  const [detailObs, setDetailObs] = useState<any[]>([]);
  const [newObs, setNewObs] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<RmaRow | null>(null);

  useBodyScrollLock(!!form || !!detailId || !!confirmDelete);

  async function loadList() {
    setLoading(true);
    const { data, error } = await supabase
      .from('rmas')
      .select(`id, numero, client_name, client_trade_name, client_cnpj, client_phone, client_email,
               motivo, status, diagnostico, solucao, data_recebido, data_devolvido,
               shipment_origem_id, numero_venda_origem, notes, created_at, updated_at,
               observations:rma_observations(id)`)
      .order('data_recebido', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) setListError(friendlyDbError(error));
    else setList(((data ?? []) as any[]).map((r) => ({
      ...r,
      observations_count: r.observations?.length ?? 0,
    })));
    setLoading(false);
  }

  useEffect(() => {
    loadList();
    const id = setInterval(loadList, 30000);
    return () => clearInterval(id);
  }, []);

  // ----- filtros -----
  const filtered = useMemo(() => {
    return list.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${r.client_name} ${r.client_trade_name ?? ''} ${r.numero} ${r.numero_venda_origem ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list, statusFilter, search]);

  useEffect(() => { setPage(1); }, [statusFilter, search]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const stats = useMemo(() => {
    const byStatus = { recebido: 0, analise: 0, conserto: 0, pronto: 0, devolvido: 0, cancelado: 0 };
    for (const r of list) byStatus[r.status]++;
    return byStatus;
  }, [list]);

  // ----- form -----
  function openCreate() {
    setForm({ ...emptyForm });
    setFormError(null);
  }

  async function openEdit(r: RmaRow) {
    setFormError(null);
    const { data: items } = await supabase
      .from('rma_items')
      .select('id, product_id, item_name, item_code, serial_number, quantity, notes, product:products(name)')
      .eq('rma_id', r.id);
    setForm({
      id: r.id,
      numero: r.numero,
      client_name: r.client_name,
      client_trade_name: r.client_trade_name ?? '',
      client_cnpj: r.client_cnpj ?? '',
      client_phone: r.client_phone ?? '',
      client_email: r.client_email ?? '',
      motivo: r.motivo,
      status: r.status,
      diagnostico: r.diagnostico ?? '',
      solucao: r.solucao,
      data_recebido: r.data_recebido?.slice(0, 10) ?? '',
      data_devolvido: r.data_devolvido?.slice(0, 10) ?? '',
      numero_venda_origem: r.numero_venda_origem ?? '',
      notes: r.notes ?? '',
      items: ((items ?? []) as any[]).map((it) => ({
        id: it.id,
        product_id: it.product_id,
        product_name: it.product?.name ?? '',
        item_name: it.item_name ?? '',
        item_code: it.item_code ?? '',
        serial_number: it.serial_number ?? '',
        quantity: Number(it.quantity ?? 1),
        notes: it.notes ?? '',
      })),
    });
  }

  function closeForm() {
    setForm(null);
    setFormError(null);
  }

  function patchForm(p: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...p } : prev));
  }

  function addItemRow() {
    if (!form) return;
    patchForm({
      items: [...form.items, { product_id: null, product_name: '', item_name: '', item_code: '', serial_number: '', quantity: 1, notes: '' }],
    });
  }

  function updateItemRow(idx: number, p: Partial<ItemRow>) {
    if (!form) return;
    patchForm({ items: form.items.map((r, i) => (i === idx ? { ...r, ...p } : r)) });
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
    setSaving(true);

    const payload: any = {
      client_name: form.client_name.trim(),
      client_trade_name: form.client_trade_name.trim() || null,
      client_cnpj: form.client_cnpj.trim() || null,
      client_phone: form.client_phone.trim() || null,
      client_email: form.client_email.trim() || null,
      motivo: form.motivo,
      status: form.status,
      diagnostico: form.diagnostico.trim() || null,
      solucao: form.solucao,
      data_recebido: form.data_recebido || null,
      data_devolvido: form.data_devolvido || null,
      numero_venda_origem: form.numero_venda_origem.trim() || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let rmaId = form.id;
    if (rmaId) {
      const { error } = await supabase.from('rmas').update(payload).eq('id', rmaId);
      if (error) { setFormError(friendlyDbError(error)); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('rmas').insert(payload).select('id').single();
      if (error || !data) { setFormError(friendlyDbError(error ?? new Error('falha ao criar'))); setSaving(false); return; }
      rmaId = data.id;
    }

    // Re-grava itens (estratégia simples)
    await supabase.from('rma_items').delete().eq('rma_id', rmaId);
    if (form.items.length > 0) {
      const itemsPayload = form.items
        .filter((it) => it.quantity > 0 && (it.product_id || it.item_name.trim() || it.item_code.trim()))
        .map((it) => ({
          rma_id: rmaId,
          product_id: it.product_id || null,
          item_name: it.item_name.trim() || null,
          item_code: it.item_code.trim() || null,
          serial_number: it.serial_number.trim() || null,
          quantity: it.quantity,
          notes: it.notes.trim() || null,
        }));
      if (itemsPayload.length > 0) {
        const { error: itErr } = await supabase.from('rma_items').insert(itemsPayload);
        if (itErr) { setFormError(friendlyDbError(itErr)); setSaving(false); return; }
      }
    }

    setSaving(false);
    closeForm();
    await loadList();
  }

  async function changeStatus(r: RmaRow, newStatus: RmaStatus) {
    const payload: any = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'devolvido' && !r.data_devolvido) payload.data_devolvido = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from('rmas').update(payload).eq('id', r.id);
    if (error) { alert(friendlyDbError(error)); return; }
    await loadList();
  }

  async function addObservation() {
    if (!detailId || !newObs.trim()) return;
    const { error } = await supabase.from('rma_observations').insert({
      rma_id: detailId, content: newObs.trim(), author: userLabel ?? null,
    });
    if (error) { alert(friendlyDbError(error)); return; }
    setNewObs('');
    // recarrega obs do detail
    const { data } = await supabase.from('rma_observations').select('*').eq('rma_id', detailId).order('created_at', { ascending: false });
    setDetailObs(data ?? []);
    await loadList();
  }

  async function doDelete() {
    if (!confirmDelete) return;
    const { error } = await supabase.from('rmas').delete().eq('id', confirmDelete.id);
    if (error) { alert(friendlyDbError(error)); return; }
    setConfirmDelete(null);
    await loadList();
  }

  // ----- detalhes -----
  useEffect(() => {
    if (!detailId) {
      setDetailItems([]); setDetailObs([]); return;
    }
    let cancelled = false;
    (async () => {
      const [it, obs] = await Promise.all([
        supabase.from('rma_items').select('*, product:products(id, name)').eq('rma_id', detailId),
        supabase.from('rma_observations').select('*').eq('rma_id', detailId).order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      setDetailItems(it.data ?? []);
      setDetailObs(obs.data ?? []);
    })();
    return () => { cancelled = true; };
  }, [detailId]);

  const detailRma = list.find((r) => r.id === detailId) ?? null;

  // ----- render -----
  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">RMAs</h1>
          <p className="text-sm text-slate-500">
            Devoluções de cliente — defeito, garantia, troca. Acompanhe da chegada à devolução.
          </p>
        </div>
        <Button onClick={openCreate}>+ Novo RMA</Button>
      </div>

      {listError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {listError}
        </div>
      )}

      {/* Filtros + busca + toggle */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <FilterDropdown
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { key: 'all',       label: 'Todos',              count: list.length,     pillClass: 'bg-slate-100 text-slate-700' },
            { key: 'recebido',  label: 'Recebido',           count: stats.recebido,  pillClass: 'bg-blue-100 text-blue-700' },
            { key: 'analise',   label: 'Em análise',         count: stats.analise,   pillClass: 'bg-amber-100 text-amber-700' },
            { key: 'conserto',  label: 'Em conserto',        count: stats.conserto,  pillClass: 'bg-purple-100 text-purple-700' },
            { key: 'pronto',    label: 'Pronto p/ devolver', count: stats.pronto,    pillClass: 'bg-emerald-100 text-emerald-700' },
            { key: 'devolvido', label: 'Devolvido',          count: stats.devolvido, pillClass: 'bg-slate-100 text-slate-700' },
            { key: 'cancelado', label: 'Cancelado',          count: stats.cancelado, pillClass: 'bg-red-100 text-red-700' },
          ]}
        />
        <div className="flex flex-1 items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente ou nº…"
          />
          {(statusFilter !== 'all' || search) && (
            <button
              type="button"
              onClick={() => { setStatusFilter('all'); setSearch(''); }}
              className="text-xs text-slate-500 hover:underline whitespace-nowrap"
            >
              limpar filtros
            </button>
          )}
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-white p-0.5">
          {(['table', 'kanban'] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                viewMode === m ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              {m === 'table' ? 'Tabela' : 'Kanban'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">
              {list.length === 0 ? 'Nenhum RMA cadastrado ainda.' : 'Nenhum RMA bate com os filtros.'}
            </p>
          </CardBody>
        </Card>
      ) : viewMode === 'kanban' ? (
        <RmasKanbanView
          rmas={filtered}
          onCardClick={(id) => setDetailId(id)}
          onMoveToColumn={(r, target) => changeStatus(r, target)}
          onAddObservation={async (rmaId, content) => {
            const { error } = await supabase.from('rma_observations').insert({ rma_id: rmaId, content, author: userLabel ?? null });
            if (error) { alert(friendlyDbError(error)); return; }
            await loadList();
          }}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Nº</th>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Motivo</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Solução</th>
                  <th className="px-5 py-3">Recebido</th>
                  <th className="px-5 py-3">Devolvido</th>
                  <th className="px-5 py-3 text-right">Obs.</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50" onClick={() => setDetailId(r.id)}>
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">#{r.numero}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900">{r.client_trade_name ?? r.client_name}</div>
                      {r.client_trade_name && <div className="text-xs text-slate-500">{r.client_name}</div>}
                      {r.numero_venda_origem && <div className="text-[11px] text-emerald-600">venda #{r.numero_venda_origem}</div>}
                    </td>
                    <td className="px-5 py-3 text-slate-700">{MOTIVO_LABEL[r.motivo]}</td>
                    <td className="px-5 py-3">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', STATUS_PILL[r.status])}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{SOLUCAO_LABEL[r.solucao]}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDateBR(r.data_recebido)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDateBR(r.data_devolvido)}</td>
                    <td className="px-5 py-3 text-right">
                      {(r.observations_count ?? 0) > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                          {r.observations_count}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => openEdit(r)} className="text-brand-600 hover:underline mr-3">editar</button>
                      <button type="button" onClick={() => setConfirmDelete(r)} className="text-red-600 hover:underline">excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} className="px-5" />
        </Card>
      )}

      {/* Modal: criar/editar */}
      {form && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={closeForm}
        >
          <div
            className="flex h-[min(820px,92vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={save} className="flex flex-1 flex-col overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  {form.id ? `Editar RMA #${form.numero}` : 'Novo RMA'}
                </h2>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {formError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Cliente *</Label>
                    <Input value={form.client_name} onChange={(e) => patchForm({ client_name: e.target.value })} placeholder="Razão social ou nome" required />
                  </div>
                  <div>
                    <Label>Nome fantasia</Label>
                    <Input value={form.client_trade_name} onChange={(e) => patchForm({ client_trade_name: e.target.value })} />
                  </div>
                  <div>
                    <Label>CNPJ</Label>
                    <Input value={form.client_cnpj} onChange={(e) => patchForm({ client_cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
                  </div>
                  <div>
                    <Label>WhatsApp</Label>
                    <Input value={form.client_phone} onChange={(e) => patchForm({ client_phone: e.target.value })} placeholder="11 99999-9999" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>E-mail</Label>
                    <Input value={form.client_email} onChange={(e) => patchForm({ client_email: e.target.value })} type="email" />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label>Motivo</Label>
                    <select
                      value={form.motivo}
                      onChange={(e) => patchForm({ motivo: e.target.value as RmaMotivo })}
                      className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      {(['defeito', 'desistencia', 'garantia', 'outro'] as RmaMotivo[]).map((m) => (
                        <option key={m} value={m}>{MOTIVO_LABEL[m]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <select
                      value={form.status}
                      onChange={(e) => patchForm({ status: e.target.value as RmaStatus })}
                      className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      {(['recebido', 'analise', 'conserto', 'pronto', 'devolvido', 'cancelado'] as RmaStatus[]).map((s) => (
                        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Solução</Label>
                    <select
                      value={form.solucao}
                      onChange={(e) => patchForm({ solucao: e.target.value as RmaSolucao })}
                      className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      {(['pendente', 'troca', 'reparo', 'refund', 'descartado', 'outro'] as RmaSolucao[]).map((s) => (
                        <option key={s} value={s}>{SOLUCAO_LABEL[s]}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label>Recebido em</Label>
                    <Input type="date" value={form.data_recebido} onChange={(e) => patchForm({ data_recebido: e.target.value })} />
                  </div>
                  <div>
                    <Label>Devolvido em</Label>
                    <Input type="date" value={form.data_devolvido} onChange={(e) => patchForm({ data_devolvido: e.target.value })} />
                  </div>
                  <div>
                    <Label>Pedido original</Label>
                    <Input value={form.numero_venda_origem} onChange={(e) => patchForm({ numero_venda_origem: e.target.value })} placeholder="nº da venda" />
                  </div>
                </div>

                <div>
                  <Label>Diagnóstico</Label>
                  <Textarea value={form.diagnostico} onChange={(e) => patchForm({ diagnostico: e.target.value })} rows={3} placeholder="O que foi encontrado na análise técnica…" />
                </div>

                <div>
                  <Label>Observações internas</Label>
                  <Textarea value={form.notes} onChange={(e) => patchForm({ notes: e.target.value })} rows={2} />
                </div>

                {/* Itens */}
                <div className="border-t border-slate-200 pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <Label>Itens devolvidos</Label>
                    <button type="button" onClick={addItemRow} className="text-xs text-brand-600 hover:underline">
                      + adicionar item
                    </button>
                  </div>
                  {form.items.length === 0 ? (
                    <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                      Nenhum item ainda. Clique em "+ adicionar item" pra registrar o que foi devolvido.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {form.items.map((it, idx) => (
                        <div key={idx} className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-12">
                          <div className="sm:col-span-4">
                            <Input value={it.item_name} onChange={(e) => updateItemRow(idx, { item_name: e.target.value })} placeholder="Descrição (ex: Controle 2 botões)" />
                          </div>
                          <div className="sm:col-span-2">
                            <Input value={it.item_code} onChange={(e) => updateItemRow(idx, { item_code: e.target.value })} placeholder="Código" />
                          </div>
                          <div className="sm:col-span-3">
                            <Input value={it.serial_number} onChange={(e) => updateItemRow(idx, { serial_number: e.target.value })} placeholder="Nº de série" />
                          </div>
                          <div className="sm:col-span-2">
                            <Input type="number" min="1" step="any" value={it.quantity} onChange={(e) => updateItemRow(idx, { quantity: Number(e.target.value) })} />
                          </div>
                          <div className="sm:col-span-1 flex items-center justify-end">
                            <button type="button" onClick={() => removeItemRow(idx)} className="text-slate-400 hover:text-red-600" title="Remover">
                              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l8 8M12 4l-8 8" />
                              </svg>
                            </button>
                          </div>
                          <div className="sm:col-span-12">
                            <Input value={it.notes} onChange={(e) => updateItemRow(idx, { notes: e.target.value })} placeholder="Defeito específico (opcional)" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
                <Button type="button" variant="secondary" onClick={closeForm}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Salvando…' : (form.id ? 'Salvar' : 'Criar RMA')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: detalhes (timeline) */}
      {detailId && detailRma && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setDetailId(null)}>
          <div className="flex h-[min(820px,92vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  RMA #{detailRma.numero} — {detailRma.client_trade_name ?? detailRma.client_name}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 font-medium', STATUS_PILL[detailRma.status])}>
                    {STATUS_LABEL[detailRma.status]}
                  </span>
                  <span className="text-slate-500">{MOTIVO_LABEL[detailRma.motivo]}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-500">Solução: {SOLUCAO_LABEL[detailRma.solucao]}</span>
                </div>
              </div>
              <button onClick={() => setDetailId(null)} className="text-slate-400 hover:text-slate-700">×</button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2 text-xs text-slate-600">
                <div>Recebido: <strong className="text-slate-800">{formatDateBR(detailRma.data_recebido)}</strong></div>
                <div>Devolvido: <strong className="text-slate-800">{formatDateBR(detailRma.data_devolvido)}</strong></div>
                {detailRma.numero_venda_origem && <div>Venda original: <strong className="text-emerald-700">#{detailRma.numero_venda_origem}</strong></div>}
                {detailRma.client_cnpj && <div>CNPJ: <strong>{detailRma.client_cnpj}</strong></div>}
                {detailRma.client_phone && <div>WhatsApp: <strong>{detailRma.client_phone}</strong></div>}
                {detailRma.client_email && <div>E-mail: <strong>{detailRma.client_email}</strong></div>}
              </div>

              {detailRma.diagnostico && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Diagnóstico</h3>
                  <p className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">{detailRma.diagnostico}</p>
                </div>
              )}

              {detailItems.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Itens devolvidos</h3>
                  <ul className="space-y-1 text-sm">
                    {detailItems.map((it) => (
                      <li key={it.id} className="flex items-baseline gap-2 rounded border border-slate-100 bg-white px-3 py-2">
                        <span className="font-medium">{it.quantity}×</span>
                        <span className="flex-1">
                          {it.product?.name ?? it.item_name ?? '—'}
                          {it.serial_number && <span className="ml-2 text-xs text-slate-500">SN: {it.serial_number}</span>}
                          {it.notes && <span className="ml-2 text-xs text-slate-500">({it.notes})</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Observações ({detailObs.length})</h3>
                <div className="mb-2 flex gap-2">
                  <Input value={newObs} onChange={(e) => setNewObs(e.target.value)} placeholder="Anotar algo neste RMA…" />
                  <Button type="button" onClick={addObservation} disabled={!newObs.trim()}>Anotar</Button>
                </div>
                {detailObs.length === 0 ? (
                  <p className="text-xs text-slate-400">Nenhuma observação ainda.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {detailObs.map((o) => (
                      <li key={o.id} className="rounded-md border border-slate-100 bg-white px-3 py-2 text-sm">
                        <p className="whitespace-pre-wrap text-slate-700">{o.content}</p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          {o.author ? `${o.author} · ` : ''}{new Date(o.created_at).toLocaleString('pt-BR')}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
              <button type="button" onClick={() => setConfirmDelete(detailRma)} className="text-sm text-red-600 hover:underline">Excluir RMA</button>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setDetailId(null)}>Fechar</Button>
                <Button type="button" onClick={() => { setDetailId(null); openEdit(detailRma); }}>Editar</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Excluir RMA"
          description={`Excluir RMA #${confirmDelete.numero} de ${confirmDelete.client_name}? Itens e observações serão apagados também.`}
          confirmLabel="Excluir definitivamente"
          variant="danger"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ----- FilterDropdown ----------------------------------------------------

type FilterKey = RmaStatus | 'all';
interface FilterOption {
  key: FilterKey; label: string; count: number; pillClass: string;
}

function FilterDropdown({
  value, onChange, options,
}: {
  value: FilterKey;
  onChange: (v: FilterKey) => void;
  options: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-rma-filter-dropdown]')) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative shrink-0" data-rma-filter-dropdown>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-slate-50',
          value !== 'all' ? 'border-brand-300 text-brand-700' : 'border-slate-200 text-slate-700'
        )}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h14M5 10h10M8 15h4" />
        </svg>
        <span>{current.label}</span>
        <span className={cn('inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold', current.pillClass)}>
          {current.count}
        </span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 8l5 5 5-5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <ul className="max-h-[70vh] overflow-y-auto py-1">
            {options.map((opt) => (
              <li key={opt.key}>
                <button
                  type="button"
                  onClick={() => { onChange(opt.key); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-sm transition-colors',
                    value === opt.key ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-50'
                  )}
                >
                  <span className="flex items-center gap-2">
                    {value === opt.key && (
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" />
                      </svg>
                    )}
                    <span className={cn(value === opt.key ? 'font-medium' : '', value !== opt.key && 'pl-[22px]')}>
                      {opt.label}
                    </span>
                  </span>
                  <span className={cn('inline-flex min-w-[24px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold', opt.pillClass)}>
                    {opt.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
