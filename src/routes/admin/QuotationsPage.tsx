import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { BomItem, Component, Product, Supplier } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { fetchUsdBrl } from '@/lib/currency';
import { formatBRL, buildPublicQuoteUrl } from '@/lib/utils';

interface QuotationListItem {
  id: string;
  title: string;
  status: 'draft' | 'sent' | 'closed';
  created_at: string;
  closed_at: string | null;
  usd_brl_rate: number | null;
  product: { name: string } | null;
  invites: { id: string; status: string }[];
}

interface QuotationItemDetail {
  id: string;
  component_id: string;
  quantity: number;
  target_price_brl: number | null;
  position: number;
  component: { name: string } | null;
}

interface InviteDetail {
  id: string;
  token: string;
  status: string;
  sent_at: string | null;
  responded_at: string | null;
  supplier: { name: string; email: string } | null;
}

interface QuotationDetail {
  id: string;
  title: string;
  status: string;
  created_at: string;
  usd_brl_rate: number | null;
  payment_terms: string | null;
  public_token: string;
  product: { name: string } | null;
}

interface NewQuotationForm {
  productId: string;
  unitsToManufacture: number | null;
  title: string;
  paymentTerms: string;
  selectedSuppliers: Set<string>;
}

const emptyNewForm: NewQuotationForm = {
  productId: '',
  unitsToManufacture: null,
  title: '',
  paymentTerms: '',
  selectedSuppliers: new Set(),
};

const statusLabel: Record<string, string> = {
  pending: 'pendente',
  sent: 'enviado',
  opened: 'aberto',
  responded: 'respondido',
  expired: 'expirado',
};

export default function QuotationsPage() {
  const [list, setList] = useState<QuotationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [newForm, setNewForm] = useState<NewQuotationForm | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [productBom, setProductBom] = useState<Array<BomItem & { component: Component | null }>>([]);
  const [creating, setCreating] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuotationDetail | null>(null);
  const [detailItems, setDetailItems] = useState<QuotationItemDetail[]>([]);
  const [detailInvites, setDetailInvites] = useState<InviteDetail[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Edição leve (título + condição de pagamento)
  const [editForm, setEditForm] = useState<{
    id: string;
    title: string;
    paymentTerms: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Confirmação de exclusão
  const [confirmDelete, setConfirmDelete] = useState<QuotationListItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadList() {
    setLoading(true);
    const { data, error } = await supabase
      .from('quotations')
      .select(
        `id, title, status, created_at, closed_at, usd_brl_rate,
         product:products(name),
         invites:quotation_invites(id, status)`
      )
      .order('created_at', { ascending: false });
    if (error) setListError(error.message);
    else setList((data ?? []) as unknown as QuotationListItem[]);
    setLoading(false);
  }

  useEffect(() => {
    loadList();
  }, []);

  // ----- Edição (título + condição de pagamento) ----------------------

  async function openEdit(q: QuotationListItem) {
    setEditError(null);
    const { data, error } = await supabase
      .from('quotations')
      .select('id, title, payment_terms')
      .eq('id', q.id)
      .single();
    if (error || !data) {
      setEditError(error?.message ?? 'Falha ao carregar cotação.');
      return;
    }
    setEditForm({
      id: data.id as string,
      title: (data as { title: string }).title,
      paymentTerms: (data as { payment_terms: string | null }).payment_terms ?? '',
    });
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editForm) return;
    setEditError(null);
    if (!editForm.title.trim()) return setEditError('Informe um título.');
    setSavingEdit(true);
    const { error } = await supabase
      .from('quotations')
      .update({
        title: editForm.title.trim(),
        payment_terms: editForm.paymentTerms.trim() || null,
      })
      .eq('id', editForm.id);
    setSavingEdit(false);
    if (error) {
      setEditError(error.message);
      return;
    }
    setEditForm(null);
    await loadList();
  }

  // ----- Exclusão -----------------------------------------------------

  async function doDelete() {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    const { error } = await supabase.from('quotations').delete().eq('id', confirmDelete.id);
    setDeletingId(null);
    if (error) {
      alert(`Não foi possível excluir: ${error.message}`);
      return;
    }
    setConfirmDelete(null);
    await loadList();
  }

  // ----- Nova cotação --------------------------------------------------

  async function openNew() {
    setNewForm(emptyNewForm);
    setNewError(null);
    setProductBom([]);
    const [prodRes, supRes] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
    ]);
    setProducts((prodRes.data ?? []) as Product[]);
    setSuppliers((supRes.data ?? []) as Supplier[]);
  }

  function closeNew() {
    setNewForm(null);
    setNewError(null);
  }

  async function onSelectProduct(productId: string) {
    if (!newForm) return;
    const product = products.find((p) => p.id === productId);
    setNewForm({
      ...newForm,
      productId,
      title: product
        ? `Cotação ${product.name} ${new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' })}`
        : '',
    });
    if (!productId) {
      setProductBom([]);
      return;
    }
    const { data } = await supabase
      .from('bom_items')
      .select('*, component:components(*)')
      .eq('product_id', productId);
    setProductBom((data ?? []) as unknown as Array<BomItem & { component: Component | null }>);
  }

  function removeBomItemFromPreview(bomItemId: string) {
    setProductBom((prev) => prev.filter((b) => b.id !== bomItemId));
  }

  function updateBomItemTarget(bomItemId: string, target: number | null) {
    setProductBom((prev) =>
      prev.map((b) => (b.id === bomItemId ? { ...b, target_price_brl: target } : b))
    );
  }

  function toggleSupplier(id: string) {
    if (!newForm) return;
    const next = new Set(newForm.selectedSuppliers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setNewForm({ ...newForm, selectedSuppliers: next });
  }

  async function createQuotation(e: FormEvent) {
    e.preventDefault();
    if (!newForm) return;
    setNewError(null);
    if (!newForm.productId) return setNewError('Selecione o produto.');
    if (newForm.unitsToManufacture == null || newForm.unitsToManufacture <= 0) {
      return setNewError('Informe a quantidade a fabricar (> 0).');
    }
    if (!newForm.title.trim()) return setNewError('Informe um título para a cotação.');
    if (productBom.length === 0) return setNewError('A cotação precisa ter ao menos 1 item.');

    setCreating(true);

    // Snapshot do câmbio (não bloqueia se falhar — fica null)
    let usdRate: number | null = null;
    try {
      const fx = await fetchUsdBrl();
      usdRate = fx.rate;
    } catch {
      // segue sem cotação
    }

    const { data: q, error: qErr } = await supabase
      .from('quotations')
      .insert({
        product_id: newForm.productId,
        title: newForm.title.trim(),
        status: 'sent',
        usd_brl_rate: usdRate,
        payment_terms: newForm.paymentTerms.trim() || null,
      })
      .select('id')
      .single();
    if (qErr || !q) {
      setNewError(qErr?.message ?? 'Falha ao criar cotação.');
      setCreating(false);
      return;
    }
    const quotationId = q.id as string;
    const units = newForm.unitsToManufacture; // já validado > 0 acima

    // Snapshot dos itens (qty multiplicada pela quantidade a fabricar)
    const itemsPayload = productBom.map((b, idx) => ({
      quotation_id: quotationId,
      component_id: b.component_id,
      quantity: Number(b.quantity) * units,
      target_price_brl: b.target_price_brl,
      position: idx,
    }));
    const { error: itemsErr } = await supabase.from('quotation_items').insert(itemsPayload);
    if (itemsErr) {
      setNewError(`Itens: ${itemsErr.message}`);
      setCreating(false);
      return;
    }

    // Convites (1 por fornecedor selecionado, se houver). Token é gerado pelo
    // default da coluna. Se nenhum fornecedor selecionado, segue só com o
    // public_token da cotação.
    if (newForm.selectedSuppliers.size > 0) {
      const invitesPayload = Array.from(newForm.selectedSuppliers).map((sid) => ({
        quotation_id: quotationId,
        supplier_id: sid,
        status: 'sent',
        sent_at: new Date().toISOString(),
      }));
      const { error: invErr } = await supabase.from('quotation_invites').insert(invitesPayload);
      if (invErr) {
        setNewError(`Convites: ${invErr.message}`);
        setCreating(false);
        return;
      }
    }

    setCreating(false);
    closeNew();
    await loadList();
    setDetailId(quotationId);
  }

  // ----- Detalhes -----------------------------------------------------

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      setDetailItems([]);
      setDetailInvites([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      const [qRes, itemsRes, invRes] = await Promise.all([
        supabase
          .from('quotations')
          .select(
            'id, title, status, created_at, usd_brl_rate, payment_terms, public_token, product:products(name)'
          )
          .eq('id', detailId)
          .single(),
        supabase
          .from('quotation_items')
          .select('id, component_id, quantity, target_price_brl, position, component:components(name)')
          .eq('quotation_id', detailId)
          .order('position'),
        supabase
          .from('quotation_invites')
          .select('id, token, status, sent_at, responded_at, supplier:suppliers(name, email)')
          .eq('quotation_id', detailId),
      ]);
      if (cancelled) return;
      if (qRes.data) setDetail(qRes.data as unknown as QuotationDetail);
      setDetailItems((itemsRes.data ?? []) as unknown as QuotationItemDetail[]);
      setDetailInvites((invRes.data ?? []) as unknown as InviteDetail[]);
      setDetailLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  function copyLink(token: string) {
    const url = buildPublicQuoteUrl(token);
    navigator.clipboard.writeText(url);
  }

  // ----- Render -------------------------------------------------------

  const totalUnitCostPreviewBRL = useMemo(() => {
    if (!newForm) return 0;
    return productBom.reduce(
      (acc, b) =>
        acc + Number(b.quantity ?? 0) * Number(b.target_price_brl ?? 0),
      0
    );
  }, [productBom, newForm]);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cotações</h1>
          <p className="text-sm text-slate-500">
            Crie rodadas de cotação a partir de um produto e envie links únicos pra cada fornecedor.
          </p>
        </div>
        <Button onClick={openNew}>+ Nova cotação</Button>
      </div>

      {listError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {listError}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">Nenhuma cotação criada ainda.</p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Título</th>
                <th className="px-5 py-3">Produto</th>
                <th className="px-5 py-3 text-right">Convidados</th>
                <th className="px-5 py-3 text-right">Respondidos</th>
                <th className="px-5 py-3">Criada em</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((q) => {
                const total = q.invites.length;
                const responded = q.invites.filter((i) => i.status === 'responded').length;
                return (
                  <tr key={q.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-900">{q.title}</td>
                    <td className="px-5 py-3 text-slate-600">{q.product?.name ?? '—'}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{total}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={responded >= 2 ? 'font-medium text-emerald-600' : 'text-slate-700'}>
                        {responded}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {new Date(q.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setDetailId(q.id)}
                          className="text-brand-600 hover:underline"
                        >
                          ver
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(q)}
                          className="text-slate-600 hover:underline"
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(q)}
                          className="text-red-600 hover:underline"
                        >
                          excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Modal nova cotação */}
      {newForm && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeNew}
        >
          <div
            className="flex h-[min(760px,92vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={createQuotation} className="flex flex-1 flex-col overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">Nova cotação</h2>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                {newError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {newError}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
                  <div>
                    <Label htmlFor="q-product">Produto *</Label>
                    <select
                      id="q-product"
                      value={newForm.productId}
                      onChange={(e) => onSelectProduct(e.target.value)}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    >
                      <option value="">Selecione…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="q-units">Quantos produtos fabricar</Label>
                    <Input
                      id="q-units"
                      type="number"
                      min={1}
                      step="1"
                      value={newForm.unitsToManufacture ?? ''}
                      onChange={(e) =>
                        setNewForm({
                          ...newForm,
                          unitsToManufacture:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      placeholder="1"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="q-title">Título da cotação *</Label>
                  <Input
                    id="q-title"
                    value={newForm.title}
                    onChange={(e) => setNewForm({ ...newForm, title: e.target.value })}
                    placeholder="Ex: Cotação Controle abr/26"
                  />
                </div>

                {/* Preview da BOM expandida */}
                {newForm.productId && (
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <Label className="!mb-0">Itens que serão cotados</Label>
                      <span className="text-xs text-slate-400">
                        Remova itens que não quer incluir nessa rodada.
                      </span>
                    </div>
                    {productBom.length === 0 ? (
                      <p className="text-sm text-amber-600">
                        Nenhum item na cotação. Selecione outro produto ou cadastre BOM.
                      </p>
                    ) : (
                      <div className="overflow-hidden rounded-md border border-slate-200">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="py-2 px-3">Componente</th>
                              <th className="py-2 px-3 w-24 text-right">Qtd / produto</th>
                              <th className="py-2 px-3 w-24 text-right">Total a comprar</th>
                              <th className="py-2 px-3 w-32">Target unit. (R$)</th>
                              <th className="py-2 px-3 w-10"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {productBom.map((b) => (
                              <tr key={b.id} className="border-t border-slate-100">
                                <td className="py-2 px-3">{b.component?.name ?? '—'}</td>
                                <td className="py-2 px-3 text-right">{Number(b.quantity)}</td>
                                <td className="py-2 px-3 text-right font-medium">
                                  {newForm.unitsToManufacture != null
                                    ? Number(b.quantity) * newForm.unitsToManufacture
                                    : '—'}
                                </td>
                                <td className="py-2 px-3">
                                  <Input
                                    type="number"
                                    min={0}
                                    step="0.0001"
                                    value={b.target_price_brl ?? ''}
                                    onChange={(e) =>
                                      updateBomItemTarget(
                                        b.id,
                                        e.target.value === '' ? null : Number(e.target.value)
                                      )
                                    }
                                    placeholder="0,00"
                                    className="h-9"
                                  />
                                </td>
                                <td className="py-2 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => removeBomItemFromPreview(b.id)}
                                    aria-label={`Remover ${b.component?.name ?? 'item'} da cotação`}
                                    className="text-slate-400 hover:text-red-600"
                                  >
                                    ×
                                  </button>
                                </td>
                              </tr>
                            ))}
                            <tr className="border-t border-slate-200 bg-slate-50 text-xs">
                              <td className="py-2 px-3" colSpan={3}>
                                Custo unitário-alvo do produto (após exclusões)
                              </td>
                              <td className="py-2 px-3 text-right font-medium">
                                {formatBRL(totalUnitCostPreviewBRL)}
                              </td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Condição de pagamento */}
                <div>
                  <Label htmlFor="q-payment">Condição de pagamento desejada</Label>
                  <Textarea
                    id="q-payment"
                    value={newForm.paymentTerms}
                    onChange={(e) => setNewForm({ ...newForm, paymentTerms: e.target.value })}
                    placeholder="Ex: à vista com 5% desc · 30/60/90 · 50% entrada + 50% em 30 dias"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Esse texto aparece pro fornecedor responder com aceite ou contraproposta.
                  </p>
                </div>

                {/* Seleção de fornecedores (opcional) */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <Label className="!mb-0">
                      Fornecedores convidados{' '}
                      <span className="text-xs font-normal normal-case text-slate-400">
                        (opcional)
                      </span>
                    </Label>
                  </div>
                  <p className="mb-2 text-xs text-slate-500">
                    Você pode criar a cotação sem selecionar ninguém — basta copiar o{' '}
                    <strong>link público</strong> depois e mandar pra quem quiser. Quem não estiver
                    cadastrado se identifica ao responder.
                  </p>
                  {suppliers.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Nenhum fornecedor cadastrado ainda. Continue mesmo assim — você usará o link
                      público.
                    </p>
                  ) : (
                    <div className="grid gap-1 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-2">
                      {suppliers.map((s) => (
                        <label
                          key={s.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            className="accent-brand-600"
                            checked={newForm.selectedSuppliers.has(s.id)}
                            onChange={() => toggleSupplier(s.id)}
                          />
                          <span className="text-sm">
                            <span className="font-medium text-slate-800">{s.name}</span>
                            <span className="ml-2 text-xs text-slate-500">
                              {s.email} · {s.default_currency}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
                <Button type="button" variant="secondary" onClick={closeNew}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? 'Criando…' : 'Criar cotação'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de detalhes */}
      {detailId && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setDetailId(null)}
        >
          <div
            className="flex h-[min(760px,92vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                {detail?.title ?? 'Cotação'}
              </h2>
              <p className="text-xs text-slate-500">
                {detail?.product?.name ?? ''}
                {detail?.created_at &&
                  ` · criada em ${new Date(detail.created_at).toLocaleDateString('pt-BR')}`}
                {detail?.usd_brl_rate &&
                  ` · USD/BRL na criação: ${Number(detail.usd_brl_rate).toFixed(4)}`}
              </p>
              {detail?.payment_terms && (
                <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <span className="font-medium uppercase tracking-wide text-slate-500">
                    Condição de pagamento desejada:{' '}
                  </span>
                  <span className="text-slate-700">{detail.payment_terms}</span>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {detailLoading && <p className="text-sm text-slate-500">Carregando…</p>}

              {!detailLoading && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Itens cotados ({detailItems.length})</CardTitle>
                    </CardHeader>
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-5 py-3">Componente</th>
                          <th className="px-5 py-3 w-32 text-right">Qtd a cotar</th>
                          <th className="px-5 py-3 w-32 text-right">Target unit.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItems.map((it) => (
                          <tr key={it.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-5 py-3">{it.component?.name ?? '—'}</td>
                            <td className="px-5 py-3 text-right">{Number(it.quantity)}</td>
                            <td className="px-5 py-3 text-right text-slate-600">
                              {it.target_price_brl != null
                                ? formatBRL(Number(it.target_price_brl))
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>

                  {detail?.public_token && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Link público da cotação</CardTitle>
                      </CardHeader>
                      <CardBody className="space-y-2">
                        <p className="text-xs text-slate-500">
                          Mande esse link pra qualquer fornecedor (cadastrado ou não). Quem responder
                          vai se identificar (nome, CNPJ, etc).
                        </p>
                        {(() => {
                          const url = buildPublicQuoteUrl(detail.public_token);
                          return (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 truncate rounded bg-slate-50 px-2 py-2 font-mono text-xs text-slate-600">
                                {url}
                              </div>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => navigator.clipboard.writeText(url)}
                              >
                                copiar
                              </Button>
                            </div>
                          );
                        })()}
                      </CardBody>
                    </Card>
                  )}

                  {detailInvites.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        Convidados nominais ({detailInvites.length})
                      </CardTitle>
                    </CardHeader>
                    <CardBody className="space-y-2">
                      {detailInvites.map((inv) => {
                        const url = buildPublicQuoteUrl(inv.token);
                        return (
                          <div
                            key={inv.id}
                            className="flex flex-col gap-1 rounded-md border border-slate-200 p-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-medium text-slate-900">
                                  {inv.supplier?.name ?? '—'}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {inv.supplier?.email ?? ''} · status:{' '}
                                  <span className="font-medium text-slate-700">
                                    {statusLabel[inv.status] ?? inv.status}
                                  </span>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => copyLink(inv.token)}
                              >
                                copiar link
                              </Button>
                            </div>
                            <div className="truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-600">
                              {url}
                            </div>
                          </div>
                        );
                      })}
                    </CardBody>
                  </Card>
                  )}

                  <Card>
                    <CardHeader>
                      <CardTitle>Comparativo</CardTitle>
                    </CardHeader>
                    <CardBody>
                      <p className="text-sm text-slate-600">
                        Destrava com pelo menos <strong>2 fornecedores</strong> respondidos. Em
                        construção (próxima iteração: portal do fornecedor + comparativo
                        item-por-item).
                      </p>
                    </CardBody>
                  </Card>
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <Button type="button" variant="secondary" onClick={() => setDetailId(null)}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de edição leve */}
      {editForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setEditForm(null)}
        >
          <div
            className="w-full max-w-lg rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={saveEdit}>
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">Editar cotação</h2>
                <p className="text-xs text-slate-500">
                  Pra alterar itens ou fornecedores, exclua e crie de novo.
                </p>
              </div>
              <div className="space-y-4 px-5 py-4">
                {editError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {editError}
                  </div>
                )}
                <div>
                  <Label htmlFor="edit-title">Título *</Label>
                  <Input
                    id="edit-title"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    autoFocus
                  />
                </div>
                <div>
                  <Label htmlFor="edit-payment">Condição de pagamento desejada</Label>
                  <Textarea
                    id="edit-payment"
                    value={editForm.paymentTerms}
                    onChange={(e) => setEditForm({ ...editForm, paymentTerms: e.target.value })}
                    placeholder="Ex: à vista com 5% desc · 30/60/90"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
                <Button type="button" variant="secondary" onClick={() => setEditForm(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={savingEdit}>
                  {savingEdit ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de confirmação de exclusão */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => deletingId == null && setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-slate-900">Excluir cotação?</h2>
              <p className="mt-1 text-sm text-slate-600">
                Vai excluir <strong>{confirmDelete.title}</strong> e todos os itens, convites
                {confirmDelete.invites.filter((i) => i.status === 'responded').length > 0
                  ? ` e ${confirmDelete.invites.filter((i) => i.status === 'responded').length} resposta(s) já recebidas`
                  : ' e respostas'}
                . Essa ação não pode ser desfeita.
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmDelete(null)}
                disabled={deletingId != null}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={doDelete}
                disabled={deletingId != null}
              >
                {deletingId != null ? 'Excluindo…' : 'Excluir definitivamente'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
