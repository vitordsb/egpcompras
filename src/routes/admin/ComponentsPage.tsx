import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { Component } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import Pagination from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

interface FormState {
  id: string | null;
  name: string;
  originalName: string;
  /** Quando true e há produto filtrado: cria um novo componente (fork) e troca a referência só nesse produto. */
  forkForProduct: boolean;
  /** Em quantos produtos este componente é usado (calculado ao abrir o modal). */
  usageCount: number;
}

const emptyForm: FormState = {
  id: null,
  name: '',
  originalName: '',
  forkForProduct: false,
  usageCount: 0,
};

interface ProductOption {
  id: string;
  name: string;
}

interface BomLink {
  product_id: string;
  component_id: string;
  target_price_brl: number | null;
  created_at: string;
}

const PAGE_SIZE = 25;

export default function ComponentsPage() {
  const toast = useToast();
  const [components, setComponents] = useState<Component[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [bomLinks, setBomLinks] = useState<BomLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState<string>(''); // '' = todos
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useBodyScrollLock(!!form || !!confirm);

  async function load() {
    setLoading(true);
    const [{ data: comps, error: ce }, { data: prods }, { data: links }] = await Promise.all([
      supabase.from('components').select('*').order('name'),
      supabase.from('products').select('id, name').order('name'),
      supabase.from('bom_items').select('product_id, component_id, target_price_brl, created_at'),
    ]);
    if (ce) setError(ce.message);
    else setComponents((comps ?? []) as Component[]);
    setProducts((prods ?? []) as ProductOption[]);
    setBomLinks((links ?? []) as BomLink[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm({ ...emptyForm });
  }

  function openEdit(c: Component) {
    const usageCount = bomLinks.filter((l) => l.component_id === c.id).length;
    setForm({
      id: c.id,
      name: c.name,
      originalName: c.name,
      forkForProduct: usageCount > 1 && !!productFilter, // sugere fork por padrão quando há filtro
      usageCount,
    });
  }

  function closeForm() {
    setForm(null);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    if (!form.name.trim()) {
      setError('Nome é obrigatório.');
      return;
    }
    setSaving(true);

    const payload = { name: form.name.trim() };

    try {
      if (form.id && form.forkForProduct && productFilter) {
        // Cria novo componente e troca a referência no bom_item desse produto
        const { data: created, error: insErr } = await supabase
          .from('components')
          .insert(payload)
          .select('id')
          .single();
        if (insErr || !created) throw new Error(insErr?.message ?? 'Falha ao criar fork');
        const { error: updErr } = await supabase
          .from('bom_items')
          .update({ component_id: created.id })
          .eq('product_id', productFilter)
          .eq('component_id', form.id);
        if (updErr) throw new Error(updErr.message);
        toast.success('Componente "forkado"', `Criado "${form.name}" só para este produto. O original continua em ${form.usageCount - 1} outro(s).`);
      } else if (form.id) {
        const { error: updErr } = await supabase.from('components').update(payload).eq('id', form.id);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: insErr } = await supabase.from('components').insert(payload);
        if (insErr) throw new Error(insErr.message);
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Component) {
    setConfirm({
      message: `Remover componente "${c.name}"?`,
      onConfirm: async () => {
        setConfirm(null);
        const { error } = await supabase.from('components').delete().eq('id', c.id);
        if (error) {
          toast.error('Erro', `Não foi possível remover: ${error.message}`);
          return;
        }
        await load();
      },
    });
  }

  // Filtros (memo)
  const componentIdsInFilter = useMemo(() => {
    if (!productFilter) return null;
    return new Set(bomLinks.filter((l) => l.product_id === productFilter).map((l) => l.component_id));
  }, [productFilter, bomLinks]);

  const filtered = useMemo(() => {
    let list = components;
    if (componentIdsInFilter) list = list.filter((c) => componentIdsInFilter.has(c.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list;
  }, [components, componentIdsInFilter, search]);

  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, productFilter]);

  const filteredProductName = productFilter
    ? products.find((p) => p.id === productFilter)?.name ?? ''
    : '';

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Componentes</h1>
          <p className="text-sm text-slate-500">
            Catálogo de matérias-primas usado nas BOMs dos produtos.
          </p>
        </div>
        <Button onClick={openCreate}>+ Novo componente</Button>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="max-w-sm flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome…"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
          >
            <option value="">Todos os produtos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {productFilter && (
            <button
              type="button"
              onClick={() => setProductFilter('')}
              className="text-xs text-slate-500 hover:underline whitespace-nowrap"
            >
              limpar
            </button>
          )}
        </div>
      </div>

      {productFilter && (
        <div className="mb-3 rounded-md border border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-800">
          Mostrando componentes usados em <strong>{filteredProductName}</strong> ({filtered.length} {filtered.length === 1 ? 'item' : 'itens'}). Ao editar, você poderá criar uma versão exclusiva para este produto.
        </div>
      )}

      {error && !form && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">
              {components.length === 0
                ? 'Nenhum componente cadastrado ainda.'
                : productFilter
                  ? 'Esse produto não tem componentes na BOM.'
                  : 'Nenhum resultado para a busca.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Nome</th>
                  <th className="px-5 py-3 text-center">Usado em</th>
                  <th className="px-5 py-3 text-right">
                    {productFilter ? 'Custo neste produto' : 'Último custo'}
                  </th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const links = bomLinks.filter((l) => l.component_id === c.id);
                  const usage = links.length;
                  // Quando filtrado por produto: mostra o target daquele bom_item.
                  // Sem filtro: mostra o target mais recente entre os bom_items do componente.
                  let cost: number | null = null;
                  if (productFilter) {
                    cost = links.find((l) => l.product_id === productFilter)?.target_price_brl ?? null;
                  } else {
                    const sorted = [...links].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
                    cost = sorted.find((l) => l.target_price_brl != null)?.target_price_brl ?? null;
                  }
                  return (
                    <tr key={c.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 font-medium text-slate-900">{c.name}</td>
                      <td className="px-5 py-3 text-center text-slate-600">
                        {usage === 0 ? (
                          <span className="text-xs text-slate-400">não usado</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {usage} {usage === 1 ? 'produto' : 'produtos'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {cost != null
                          ? <span className="font-medium">R$ {Number(cost).toLocaleString('pt-BR', { minimumFractionDigits: 4 })}</span>
                          : <span className="text-xs text-slate-300">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="text-brand-600 hover:underline mr-4"
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(c)}
                          className="text-red-600 hover:underline"
                        >
                          remover
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} className="px-5" />
          </Card>
        </>
      )}

      {confirm && (
        <ConfirmModal
          title="Confirmar ação"
          description={confirm.message}
          confirmLabel="Confirmar"
          variant="danger"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {form && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeForm}
        >
          <div
            className="w-full max-w-lg rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={submit}>
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  {form.id ? 'Editar componente' : 'Novo componente'}
                </h2>
                {form.id && form.usageCount > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    Usado em {form.usageCount} {form.usageCount === 1 ? 'produto' : 'produtos'}
                  </p>
                )}
              </div>
              <div className="space-y-4 px-5 py-4">
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <div>
                  <Label htmlFor="cmp-name">Nome *</Label>
                  <Input
                    id="cmp-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex: Indutor 47nh"
                    autoFocus
                  />
                </div>
                {form.id && form.usageCount > 1 && productFilter && form.name !== form.originalName && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.forkForProduct}
                        onChange={(e) => setForm({ ...form, forkForProduct: e.target.checked })}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span>
                        <strong className="text-amber-900">Aplicar só para "{filteredProductName}"</strong>
                        <span className="mt-1 block text-xs text-amber-700">
                          Este componente é usado em {form.usageCount} produtos. Marcando esta opção, será criado um novo componente "{form.name.trim()}" exclusivo para este produto, e o original continua igual nos outros {form.usageCount - 1}.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
                <Button type="button" variant="secondary" onClick={closeForm}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Salvando…' : form.id ? (form.forkForProduct ? 'Criar versão exclusiva' : 'Salvar') : 'Criar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
