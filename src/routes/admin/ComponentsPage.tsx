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
import { cn } from '@/lib/utils';

interface BomEditRow {
  /** id do bom_items existente. null = linha nova (insert no submit) */
  bom_item_id: string | null;
  product_id: string;
  product_name: string;
  quantity: number;
  target_price_brl: number | null;
  /** Marcado pra delete no submit */
  _toDelete?: boolean;
}

interface FormState {
  id: string | null;
  name: string;
  originalName: string;
  /** Quando true e há produto filtrado: cria um novo componente (fork) e troca a referência só nesse produto. */
  forkForProduct: boolean;
  /** Em quantos produtos este componente é usado (calculado ao abrir o modal). */
  usageCount: number;
  /** Linhas editáveis do bom — cada linha = 1 produto que usa este componente */
  usageRows: BomEditRow[];
  /** Snapshot original pra detectar mudanças no submit */
  usageRowsOriginal: BomEditRow[];
}

const emptyForm: FormState = {
  id: null,
  name: '',
  originalName: '',
  forkForProduct: false,
  usageCount: 0,
  usageRows: [],
  usageRowsOriginal: [],
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
  // Assimilação manual: componente que vai virar variante de outro
  const [assimilateTarget, setAssimilateTarget] = useState<Component | null>(null);
  const [assimilateSearch, setAssimilateSearch] = useState('');
  const [assimilateSaving, setAssimilateSaving] = useState(false);

  useBodyScrollLock(!!form || !!confirm || !!assimilateTarget);

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

  async function openEdit(c: Component) {
    const usageCount = bomLinks.filter((l) => l.component_id === c.id).length;
    // Carrega bom_items detalhados (com id, qty, target) pra edição inline
    const { data: bomRows } = await supabase
      .from('bom_items')
      .select('id, product_id, quantity, target_price_brl, product:products(id, name)')
      .eq('component_id', c.id);
    const usageRows: BomEditRow[] = ((bomRows ?? []) as any[]).map((r) => ({
      bom_item_id: r.id,
      product_id: r.product_id,
      product_name: r.product?.name ?? '?',
      quantity: Number(r.quantity ?? 0),
      target_price_brl: r.target_price_brl != null ? Number(r.target_price_brl) : null,
    }));
    setForm({
      id: c.id,
      name: c.name,
      originalName: c.name,
      forkForProduct: usageCount > 1 && !!productFilter,
      usageCount,
      usageRows,
      usageRowsOriginal: usageRows.map((r) => ({ ...r })),
    });
  }

  function closeForm() {
    setForm(null);
    setError(null);
  }

  function updateUsageRow(idx: number, patch: Partial<BomEditRow>) {
    if (!form) return;
    setForm({
      ...form,
      usageRows: form.usageRows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });
  }

  function removeUsageRow(idx: number) {
    if (!form) return;
    const row = form.usageRows[idx];
    if (row.bom_item_id) {
      // Linha existente: marca pra delete (não remove visualmente até salvar)
      // Pra ficar simples, removo já visualmente; o sync detecta pelo original
      setForm({ ...form, usageRows: form.usageRows.filter((_, i) => i !== idx) });
    } else {
      // Linha nova: tira da lista
      setForm({ ...form, usageRows: form.usageRows.filter((_, i) => i !== idx) });
    }
  }

  function addUsageRow(productId: string) {
    if (!form || !productId) return;
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    if (form.usageRows.some((r) => r.product_id === productId)) {
      toast.error('Duplicado', `Já existe uma linha para "${product.name}".`);
      return;
    }
    setForm({
      ...form,
      usageRows: [
        ...form.usageRows,
        { bom_item_id: null, product_id: productId, product_name: product.name, quantity: 1, target_price_brl: null },
      ],
    });
  }

  /**
   * Compara usageRows atual vs original e aplica insert/update/delete
   * em bom_items pra refletir as mudanças. Linhas existentes detectadas
   * por bom_item_id.
   */
  async function syncUsageRows(componentId: string, current: BomEditRow[], original: BomEditRow[]) {
    const originalById = new Map(original.filter((r) => r.bom_item_id).map((r) => [r.bom_item_id!, r]));
    const currentIds = new Set(current.filter((r) => r.bom_item_id).map((r) => r.bom_item_id!));

    // 1. Deletes: estava no original, sumiu do current
    const toDelete = original.filter((r) => r.bom_item_id && !currentIds.has(r.bom_item_id));
    for (const r of toDelete) {
      await supabase.from('bom_items').delete().eq('id', r.bom_item_id!);
    }

    // 2. Updates e Inserts
    for (const r of current) {
      const qty = Number(r.quantity);
      if (!(qty > 0)) continue; // ignora linhas com qty zero/inválida
      const target = r.target_price_brl != null && Number.isFinite(Number(r.target_price_brl))
        ? Number(r.target_price_brl)
        : null;
      if (r.bom_item_id) {
        // Update se mudou
        const orig = originalById.get(r.bom_item_id);
        if (!orig) continue;
        const changed = orig.quantity !== qty || (orig.target_price_brl ?? null) !== target;
        if (changed) {
          await supabase
            .from('bom_items')
            .update({ quantity: qty, target_price_brl: target })
            .eq('id', r.bom_item_id);
        }
      } else {
        // Insert nova vinculação
        await supabase
          .from('bom_items')
          .insert({ component_id: componentId, product_id: r.product_id, quantity: qty, target_price_brl: target });
      }
    }
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
        // Cria novo componente como VARIANTE (parent_component_id) e troca
        // a referência no bom_item desse produto. A assimilação preserva
        // a origem pra agrupar visualmente em cascata.
        const { data: created, error: insErr } = await supabase
          .from('components')
          .insert({ ...payload, parent_component_id: form.id })
          .select('id')
          .single();
        if (insErr || !created) throw new Error(insErr?.message ?? 'Falha ao criar fork');
        const { error: updErr } = await supabase
          .from('bom_items')
          .update({ component_id: created.id })
          .eq('product_id', productFilter)
          .eq('component_id', form.id);
        if (updErr) throw new Error(updErr.message);
        toast.success('Variante criada', `"${form.name}" assimilada ao componente original. Aparece em cascata na listagem.`);
      } else if (form.id) {
        const { error: updErr } = await supabase.from('components').update(payload).eq('id', form.id);
        if (updErr) throw new Error(updErr.message);
        await syncUsageRows(form.id, form.usageRows, form.usageRowsOriginal);
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

  function openAssimilate(c: Component) {
    setAssimilateTarget(c);
    setAssimilateSearch('');
  }

  function closeAssimilate() {
    setAssimilateTarget(null);
    setAssimilateSearch('');
  }

  // Calcula descendentes recursivamente — usado pra evitar ciclos na assimilação
  function getDescendantIds(rootId: string, accumulator: Set<string> = new Set()): Set<string> {
    const children = components.filter((c) => c.parent_component_id === rootId);
    for (const child of children) {
      if (!accumulator.has(child.id)) {
        accumulator.add(child.id);
        getDescendantIds(child.id, accumulator);
      }
    }
    return accumulator;
  }

  async function applyAssimilate(parentId: string | null) {
    if (!assimilateTarget) return;
    if (parentId === assimilateTarget.id) {
      toast.error('Inválido', 'Componente não pode ser variante de si mesmo.');
      return;
    }
    if (parentId) {
      const descendants = getDescendantIds(assimilateTarget.id);
      if (descendants.has(parentId)) {
        toast.error('Ciclo detectado', 'O componente escolhido como pai já é uma variante deste — assimilar criaria um loop.');
        return;
      }
    }
    setAssimilateSaving(true);
    const { error: updErr } = await supabase
      .from('components')
      .update({ parent_component_id: parentId })
      .eq('id', assimilateTarget.id);
    setAssimilateSaving(false);
    if (updErr) {
      toast.error('Erro', updErr.message);
      return;
    }
    if (parentId) {
      const parent = components.find((c) => c.id === parentId);
      toast.success('Assimilado', `"${assimilateTarget.name}" agora é variante de "${parent?.name ?? '?'}".`);
    } else {
      toast.success('Desvinculado', `"${assimilateTarget.name}" voltou a ser componente independente.`);
    }
    closeAssimilate();
    await load();
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

  // Componentes que passaram nos filtros (busca + produto)
  const filteredComponents = useMemo(() => {
    let list = components;
    if (componentIdsInFilter) list = list.filter((c) => componentIdsInFilter.has(c.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list;
  }, [components, componentIdsInFilter, search]);

  // Lookup de filhos por parent_id (sobre TODOS os componentes, mesmo os fora do filtro,
  // pra resolver pai de uma variante encontrada na busca)
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Component[]>();
    for (const c of components) {
      if (c.parent_component_id) {
        const arr = map.get(c.parent_component_id) ?? [];
        arr.push(c);
        map.set(c.parent_component_id, arr);
      }
    }
    return map;
  }, [components]);

  const componentById = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);

  // Lista em cascata: pais primeiro, com variantes indentadas logo abaixo.
  // Variantes "órfãs" (cujo pai foi filtrado fora) aparecem ao final.
  const cascade = useMemo(() => {
    const out: Array<{ component: Component; depth: 0 | 1 }> = [];
    const visited = new Set<string>();
    const filteredIds = new Set(filteredComponents.map((c) => c.id));

    for (const c of filteredComponents) {
      if (c.parent_component_id) continue; // variantes vêm depois do pai
      if (visited.has(c.id)) continue;
      out.push({ component: c, depth: 0 });
      visited.add(c.id);
      for (const child of childrenByParent.get(c.id) ?? []) {
        if (visited.has(child.id)) continue;
        if (!filteredIds.has(child.id)) continue;
        out.push({ component: child, depth: 1 });
        visited.add(child.id);
      }
    }
    // Variantes que passaram no filtro mas o pai não
    for (const c of filteredComponents) {
      if (visited.has(c.id)) continue;
      out.push({ component: c, depth: c.parent_component_id ? 1 : 0 });
      visited.add(c.id);
    }
    return out;
  }, [filteredComponents, childrenByParent]);

  const visible = cascade.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filteredCount = cascade.length;

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
          Mostrando componentes usados em <strong>{filteredProductName}</strong> ({filteredCount} {filteredCount === 1 ? 'item' : 'itens'}). Ao editar, você poderá criar uma versão exclusiva para este produto.
        </div>
      )}

      {error && !form && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filteredCount === 0 ? (
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
                {visible.map(({ component: c, depth }) => {
                  const links = bomLinks.filter((l) => l.component_id === c.id);
                  const usage = links.length;
                  let cost: number | null = null;
                  if (productFilter) {
                    cost = links.find((l) => l.product_id === productFilter)?.target_price_brl ?? null;
                  } else {
                    const sorted = [...links].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
                    cost = sorted.find((l) => l.target_price_brl != null)?.target_price_brl ?? null;
                  }
                  const variantCount = childrenByParent.get(c.id)?.length ?? 0;
                  const parentName = c.parent_component_id ? componentById.get(c.parent_component_id)?.name : null;
                  return (
                    <tr
                      key={c.id}
                      className={cn(
                        'border-b border-slate-100 last:border-0',
                        depth === 1 && 'bg-slate-50/40'
                      )}
                    >
                      <td className="px-5 py-3 font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          {depth === 1 && (
                            <span className="text-slate-300 select-none" aria-hidden>↳</span>
                          )}
                          <span className={cn(depth === 1 && 'pl-1 text-slate-700')}>{c.name}</span>
                          {variantCount > 0 && depth === 0 && (
                            <span
                              className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700"
                              title={`${variantCount} variante(s) deste componente`}
                            >
                              {variantCount} variante{variantCount === 1 ? '' : 's'}
                            </span>
                          )}
                          {depth === 1 && parentName && (
                            <span
                              className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-700 border border-purple-200"
                              title={`Variante de "${parentName}"`}
                            >
                              variante de {parentName}
                            </span>
                          )}
                        </div>
                      </td>
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
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="text-brand-600 hover:underline mr-3"
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          onClick={() => openAssimilate(c)}
                          className="text-purple-600 hover:underline mr-3"
                          title="Marcar este componente como variante de outro"
                        >
                          assimilar
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
            <Pagination total={filteredCount} page={page} pageSize={PAGE_SIZE} onChange={setPage} className="px-5" />
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

      {assimilateTarget && (() => {
        const target = assimilateTarget;
        const targetDescendants = getDescendantIds(target.id);
        const currentParent = target.parent_component_id ? componentById.get(target.parent_component_id) : null;
        const q = assimilateSearch.trim().toLowerCase();
        const candidates = components
          .filter((c) => c.id !== target.id && !targetDescendants.has(c.id))
          .filter((c) => !q || c.name.toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
          .slice(0, 50);
        return (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
            onClick={closeAssimilate}
          >
            <div
              className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  Assimilar componente
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  <strong>{target.name}</strong> vai ser registrado como variante do componente que você escolher abaixo.
                </p>
                {currentParent && (
                  <p className="mt-2 rounded bg-purple-50 px-2 py-1 text-xs text-purple-700">
                    Atualmente assimilado a: <strong>{currentParent.name}</strong>. Escolher outro pai vai substituir.
                  </p>
                )}
              </div>

              <div className="border-b border-slate-200 px-5 py-3">
                <Input
                  value={assimilateSearch}
                  onChange={(e) => setAssimilateSearch(e.target.value)}
                  placeholder="Buscar componente pai…"
                  autoFocus
                />
              </div>

              <div className="flex-1 overflow-y-auto">
                {candidates.length === 0 ? (
                  <p className="px-5 py-6 text-center text-sm text-slate-500">
                    Nenhum componente encontrado para "{assimilateSearch}".
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {candidates.map((c) => {
                      const isCurrent = c.id === target.parent_component_id;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => applyAssimilate(c.id)}
                            disabled={assimilateSaving || isCurrent}
                            className={cn(
                              'flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm transition-colors',
                              isCurrent
                                ? 'bg-purple-50 text-purple-700'
                                : 'text-slate-700 hover:bg-brand-50 hover:text-brand-700',
                              assimilateSaving && 'cursor-not-allowed opacity-50'
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{c.name}</div>
                              {c.parent_component_id && (
                                <div className="text-[11px] text-slate-400">
                                  variante de {componentById.get(c.parent_component_id)?.name ?? '?'}
                                </div>
                              )}
                            </div>
                            {isCurrent && <span className="text-xs">(atual)</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
                {currentParent ? (
                  <button
                    type="button"
                    onClick={() => applyAssimilate(null)}
                    disabled={assimilateSaving}
                    className="text-sm text-red-600 hover:underline disabled:opacity-50"
                  >
                    Remover assimilação
                  </button>
                ) : (
                  <span />
                )}
                <Button type="button" variant="secondary" onClick={closeAssimilate} disabled={assimilateSaving}>
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {form && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeForm}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={submit} className="flex flex-1 flex-col overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  {form.id ? 'Editar componente' : 'Novo componente'}
                </h2>
                {form.id && (() => {
                  const c = components.find((x) => x.id === form.id);
                  if (c?.parent_component_id) {
                    const p = componentById.get(c.parent_component_id);
                    return (
                      <p className="mt-1 text-xs text-purple-700">
                        Variante de <strong>{p?.name ?? '(componente removido)'}</strong>
                      </p>
                    );
                  }
                  const variants = childrenByParent.get(form.id ?? '') ?? [];
                  if (variants.length > 0) {
                    return (
                      <p className="mt-1 text-xs text-purple-700">
                        {variants.length} variante{variants.length === 1 ? '' : 's'} assimilada{variants.length === 1 ? '' : 's'}: {variants.map((v) => v.name).join(', ')}
                      </p>
                    );
                  }
                  return null;
                })()}
                {form.id && form.usageCount > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    Usado em {form.usageCount} {form.usageCount === 1 ? 'produto' : 'produtos'}
                  </p>
                )}
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
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

                {/* Uso em produtos — edição inline de qty + custo target por produto */}
                {form.id && (
                  <div className="border-t border-slate-200 pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <Label>Uso em produtos</Label>
                      <span className="text-xs text-slate-400">
                        {form.usageRows.length} {form.usageRows.length === 1 ? 'vínculo' : 'vínculos'}
                      </span>
                    </div>

                    {form.usageRows.length === 0 ? (
                      <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                        Este componente ainda não está em nenhuma BOM. Vincule a um produto abaixo.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {form.usageRows.map((r, idx) => (
                          <div key={r.bom_item_id ?? `new-${idx}`} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
                            <span className="flex-1 truncate text-sm text-slate-800" title={r.product_name}>
                              {r.product_name}
                              {!r.bom_item_id && <span className="ml-1 text-[10px] font-semibold uppercase text-emerald-600">novo</span>}
                            </span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                value={r.quantity}
                                onChange={(e) => updateUsageRow(idx, { quantity: Number(e.target.value) })}
                                step="any"
                                min="0"
                                className="w-16 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                                title="Quantidade por unidade do produto"
                              />
                              <span className="text-[10px] text-slate-400">×</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-slate-400">R$</span>
                              <input
                                type="number"
                                value={r.target_price_brl ?? ''}
                                onChange={(e) =>
                                  updateUsageRow(idx, {
                                    target_price_brl: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                                step="0.0001"
                                min="0"
                                placeholder="custo"
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                                title="Último custo / target por unidade"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeUsageRow(idx)}
                              className="text-slate-400 hover:text-red-600"
                              title="Remover este vínculo"
                              aria-label="Remover vínculo"
                            >
                              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l8 8M12 4l-8 8" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Adicionar nova vinculação */}
                    {(() => {
                      const usedIds = new Set(form.usageRows.map((r) => r.product_id));
                      const available = products.filter((p) => !usedIds.has(p.id));
                      return (
                        <div className="mt-2">
                          <select
                            value=""
                            onChange={(e) => addUsageRow(e.target.value)}
                            disabled={available.length === 0}
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 disabled:opacity-50"
                          >
                            <option value="">
                              {available.length === 0 ? 'Já está vinculado a todos os produtos' : '+ Vincular a um produto…'}
                            </option>
                            {available.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })()}
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
