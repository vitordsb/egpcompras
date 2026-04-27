import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { BomItem, Component, Product, ProductWithCost } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { formatBRL } from '@/lib/utils';

const BOM_PAGE_SIZE = 5;

interface BomRow {
  id?: string;
  component_id: string;
  quantity: number | null;
  target_price_brl: number | null;
  notes: string | null;
}

interface FormState {
  id: string | null;
  name: string;
  description: string;
  bom: BomRow[];
}

const emptyForm: FormState = {
  id: null,
  name: '',
  description: '',
  bom: [],
};

export default function CostsPage() {
  const [products, setProducts] = useState<ProductWithCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [components, setComponents] = useState<Component[]>([]);

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bomPage, setBomPage] = useState(0);

  const [confirmDelete, setConfirmDelete] = useState<ProductWithCost | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadList() {
    setLoading(true);
    const { data, error } = await supabase
      .from('products_with_cost')
      .select('*')
      .order('name');
    if (error) setListError(error.message);
    else setProducts((data ?? []) as ProductWithCost[]);
    setLoading(false);
  }

  async function loadComponents() {
    const { data } = await supabase.from('components').select('*').order('name');
    setComponents((data ?? []) as Component[]);
  }

  useEffect(() => {
    loadList();
    loadComponents();
  }, []);

  // ---- Form handlers --------------------------------------------------

  function openCreate() {
    setForm(emptyForm);
    setFormError(null);
    setBomPage(0);
  }

  async function openEdit(p: ProductWithCost) {
    setFormError(null);
    setBomPage(0);
    const { data: bomData, error } = await supabase
      .from('bom_items')
      .select('*')
      .eq('product_id', p.id);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      bom: ((bomData ?? []) as BomItem[]).map((b) => ({
        id: b.id,
        component_id: b.component_id,
        quantity: Number(b.quantity),
        target_price_brl: b.target_price_brl != null ? Number(b.target_price_brl) : null,
        notes: b.notes,
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

  function addRow() {
    if (!form) return;
    const next = [
      ...form.bom,
      { component_id: '', quantity: null, target_price_brl: null, notes: null },
    ];
    patchForm({ bom: next });
    setBomPage(Math.floor((next.length - 1) / BOM_PAGE_SIZE));
  }

  function updateRow(idx: number, patch: Partial<BomRow>) {
    if (!form) return;
    patchForm({ bom: form.bom.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
  }

  function removeRow(idx: number) {
    if (!form) return;
    const next = form.bom.filter((_, i) => i !== idx);
    patchForm({ bom: next });
    const lastPage = Math.max(0, Math.ceil(next.length / BOM_PAGE_SIZE) - 1);
    if (bomPage > lastPage) setBomPage(lastPage);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Nome é obrigatório.');
      return;
    }
    const invalid = form.bom.find(
      (r) => !r.component_id || r.quantity == null || r.quantity <= 0
    );
    if (invalid) {
      setFormError('Cada componente da lista precisa estar selecionado e com quantidade > 0.');
      return;
    }
    setSaving(true);

    const productPayload: Partial<Product> = {
      name: form.name.trim(),
      description: form.description.trim() || null,
    };

    let productId = form.id;
    if (productId) {
      const { error } = await supabase.from('products').update(productPayload).eq('id', productId);
      if (error) {
        setFormError(error.message);
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from('products')
        .insert(productPayload)
        .select('id')
        .single();
      if (error || !data) {
        setFormError(error?.message ?? 'Falha ao criar produto');
        setSaving(false);
        return;
      }
      productId = data.id as string;
    }

    // Re-grava BOM
    await supabase.from('bom_items').delete().eq('product_id', productId);
    if (form.bom.length > 0) {
      const { error: insErr } = await supabase.from('bom_items').insert(
        form.bom.map((r) => ({
          product_id: productId,
          component_id: r.component_id,
          quantity: r.quantity,
          target_price_brl: r.target_price_brl,
          notes: r.notes,
        }))
      );
      if (insErr) {
        setFormError(insErr.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    closeForm();
    await loadList();
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    const { error } = await supabase.from('products').delete().eq('id', confirmDelete.id);
    setDeleting(false);
    if (error) {
      alert(`Não foi possível excluir: ${error.message}`);
      return;
    }
    setConfirmDelete(null);
    await loadList();
  }

  // ---- Cálculos auxiliares -------------------------------------------

  const totalCostBRL = useMemo(() => {
    if (!form) return 0;
    return form.bom.reduce(
      (acc, r) => acc + Number(r.target_price_brl ?? 0) * Number(r.quantity || 0),
      0
    );
  }, [form]);

  // ---- Render --------------------------------------------------------

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Custos</h1>
          <p className="text-sm text-slate-500">
            Cadastre o custo de fabricação de cada produto: BOM + valor unitário de cada
            componente. O custo unitário do produto é a soma desses valores.
          </p>
        </div>
        <Button onClick={openCreate}>+ Novo produto</Button>
      </div>

      {listError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {listError}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : products.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">Nenhum produto cadastrado ainda.</p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Produto</th>
                <th className="px-5 py-3 text-right">Custo unitário</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-900">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-slate-500 line-clamp-1">{p.description}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-medium">
                    {Number(p.unit_cost_brl) > 0 ? formatBRL(Number(p.unit_cost_brl)) : '—'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="text-brand-600 hover:underline"
                      >
                        editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(p)}
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
        </Card>
      )}

      {/* Modal de criar/editar produto (foco em custo) */}
      {form && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeForm}
        >
          <div
            className="flex h-[min(760px,92vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={save} className="flex flex-1 flex-col overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  {form.id ? 'Editar custo do produto' : 'Novo produto'}
                </h2>
                <p className="text-xs text-slate-500">
                  Defina nome, descrição interna e a BOM (componentes + valor unitário). Foto,
                  descrição comercial e markup são editados na aba <strong>Produtos</strong>.
                </p>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                {formError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="cst-name">Nome *</Label>
                    <Input
                      id="cst-name"
                      value={form.name}
                      onChange={(e) => patchForm({ name: e.target.value })}
                      placeholder="Ex: Controle remoto XYZ"
                      autoFocus
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">
                        Custo unitário
                      </div>
                      <div className="mt-0.5 font-semibold text-slate-900">
                        {totalCostBRL > 0 ? formatBRL(totalCostBRL) : '—'}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="cst-desc">Descrição (uso interno)</Label>
                  <Textarea
                    id="cst-desc"
                    value={form.description}
                    onChange={(e) => patchForm({ description: e.target.value })}
                    placeholder="Anotações da equipe de produção/compras"
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Label className="!mb-0">Componentes do produto</Label>
                    <Button type="button" variant="secondary" size="sm" onClick={addRow}>
                      + adicionar
                    </Button>
                  </div>
                  <p className="mb-2 text-xs text-slate-500">
                    Quantidade que vai em <strong>cada unidade</strong> do produto. A soma do total
                    de cada linha é o <strong>custo unitário</strong> do produto.
                  </p>
                  {form.bom.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum componente adicionado.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-md border border-slate-200">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="py-2 px-3">Componente</th>
                              <th className="py-2 px-3 w-24">Qtd / produto</th>
                              <th className="py-2 px-3 w-32">Valor unit. (R$)</th>
                              <th className="py-2 px-3 w-32 text-right">Total</th>
                              <th className="py-2 px-3 w-10"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {form.bom
                              .slice(bomPage * BOM_PAGE_SIZE, bomPage * BOM_PAGE_SIZE + BOM_PAGE_SIZE)
                              .map((row, relIdx) => {
                                const idx = bomPage * BOM_PAGE_SIZE + relIdx;
                                const subtotal =
                                  Number(row.target_price_brl ?? 0) * Number(row.quantity || 0);
                                const usedElsewhere = new Set(
                                  form.bom
                                    .filter((_, i) => i !== idx)
                                    .map((r) => r.component_id)
                                    .filter(Boolean)
                                );
                                const availableComponents = components.filter(
                                  (c) => c.id === row.component_id || !usedElsewhere.has(c.id)
                                );
                                return (
                                  <tr key={idx} className="border-t border-slate-100">
                                    <td className="py-2 px-3">
                                      <select
                                        value={row.component_id}
                                        onChange={(e) =>
                                          updateRow(idx, { component_id: e.target.value })
                                        }
                                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                                      >
                                        <option value="">Selecione…</option>
                                        {availableComponents.map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {c.name}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td className="py-2 px-3">
                                      <Input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={row.quantity ?? ''}
                                        onChange={(e) =>
                                          updateRow(idx, {
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
                                        step="0.0001"
                                        value={row.target_price_brl ?? ''}
                                        onChange={(e) =>
                                          updateRow(idx, {
                                            target_price_brl:
                                              e.target.value === '' ? null : Number(e.target.value),
                                          })
                                        }
                                        placeholder="0,00"
                                        className="h-9"
                                      />
                                    </td>
                                    <td className="py-2 px-3 text-right text-slate-700">
                                      {formatBRL(subtotal)}
                                    </td>
                                    <td className="py-2 px-3">
                                      <button
                                        type="button"
                                        onClick={() => removeRow(idx)}
                                        aria-label="remover linha"
                                        className="text-slate-400 hover:text-red-600"
                                      >
                                        ×
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            <tr className="border-t border-slate-200 bg-slate-50 font-medium">
                              <td className="py-2 px-3" colSpan={3}>
                                Custo unitário do produto
                              </td>
                              <td className="py-2 px-3 text-right">{formatBRL(totalCostBRL)}</td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {form.bom.length > BOM_PAGE_SIZE && (
                        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-600">
                          <button
                            type="button"
                            onClick={() => setBomPage((p) => Math.max(0, p - 1))}
                            disabled={bomPage === 0}
                            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
                          >
                            ‹
                          </button>
                          <span>
                            Página {bomPage + 1} de {Math.ceil(form.bom.length / BOM_PAGE_SIZE)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setBomPage((p) =>
                                Math.min(Math.ceil(form.bom.length / BOM_PAGE_SIZE) - 1, p + 1)
                              )
                            }
                            disabled={bomPage >= Math.ceil(form.bom.length / BOM_PAGE_SIZE) - 1}
                            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
                          >
                            ›
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  {components.length === 0 && (
                    <p className="mt-2 text-xs text-amber-600">
                      Nenhum componente cadastrado. Cadastre na aba <strong>Componentes</strong>{' '}
                      primeiro.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
                <Button type="button" variant="secondary" onClick={closeForm}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Criar produto'}
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
          onClick={() => !deleting && setConfirmDelete(null)}
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
              <h2 className="text-base font-semibold text-slate-900">Excluir produto?</h2>
              <p className="mt-1 text-sm text-slate-600">
                Vai excluir <strong>{confirmDelete.name}</strong> e toda a BOM associada. Cotações
                já criadas a partir dele são mantidas (snapshot). Não pode ser desfeita.
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={doDelete} disabled={deleting}>
                {deleting ? 'Excluindo…' : 'Excluir definitivamente'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
