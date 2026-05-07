import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { Component, ComponentMountType } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import Pagination from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { cn } from '@/lib/utils';
import { friendlyDbError } from '@/lib/db-error';
import { exportComponentsByProduct, exportComponentsGeneral } from './components-pdf';

interface BomEditRow {
  /** id do bom_items existente. null = linha nova (insert no submit) */
  bom_item_id: string | null;
  product_id: string;
  product_name: string;
  quantity: number;
  target_price_brl: number | null;
  tipo: BomTipo;
  /** Marcado pra delete no submit */
  _toDelete?: boolean;
}

interface FormState {
  id: string | null;
  name: string;
  originalName: string;
  /** Tipo de montagem na placa: SMD, PTH ou null (não eletrônico / não especificado) */
  mountType: ComponentMountType | null;
  /** Em quantos produtos este componente é usado (calculado ao abrir o modal). */
  usageCount: number;
  /** Linhas editáveis do bom — cada linha = 1 produto que usa este componente */
  usageRows: BomEditRow[];
  /** Snapshot original pra detectar mudanças no submit */
  usageRowsOriginal: BomEditRow[];
  // Campos do "vincular já no momento da criação" (só ativos quando há filtro de produto)
  initialQuantity: number;
  initialTargetPrice: number | null;
  initialTipo: BomTipo;
}

const emptyForm: FormState = {
  id: null,
  name: '',
  originalName: '',
  mountType: null,
  usageCount: 0,
  usageRows: [],
  usageRowsOriginal: [],
  initialQuantity: 1,
  initialTargetPrice: null,
  initialTipo: 'fabricacao',
};

interface ProductOption {
  id: string;
  name: string;
}

type BomTipo = 'fabricacao' | 'acervo';

interface BomLink {
  id: string;
  product_id: string;
  component_id: string;
  target_price_brl: number | null;
  tipo: BomTipo;
  quantity: number;
  show_in_pdf: boolean;
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
  // Edição inline da coluna "Último custo"
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [editingCostValue, setEditingCostValue] = useState<string>('');
  const [savingCostId, setSavingCostId] = useState<string | null>(null);
  // Edição inline da coluna "Qtd / produto" (só com filtro ativo)
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState<string>('');
  const [savingQtyId, setSavingQtyId] = useState<string | null>(null);

  useBodyScrollLock(!!form || !!confirm);

  async function load() {
    setLoading(true);
    const [{ data: comps, error: ce }, { data: prods }, { data: links }] = await Promise.all([
      supabase.from('components').select('*').order('name'),
      supabase.from('products').select('id, name').order('name'),
      supabase.from('bom_items').select('id, product_id, component_id, target_price_brl, tipo, quantity, show_in_pdf, created_at'),
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
    const totalUsageCount = bomLinks.filter((l) => l.component_id === c.id).length;
    // Carrega bom_items detalhados. Se há filtro de produto ativo, traz só
    // os daquele produto — escopo da edição respeita o filtro.
    let query = supabase
      .from('bom_items')
      .select('id, product_id, quantity, target_price_brl, tipo, product:products(id, name)')
      .eq('component_id', c.id);
    if (productFilter) query = query.eq('product_id', productFilter);
    const { data: bomRows } = await query;
    const usageRows: BomEditRow[] = ((bomRows ?? []) as any[]).map((r) => ({
      bom_item_id: r.id,
      product_id: r.product_id,
      product_name: r.product?.name ?? '?',
      quantity: Number(r.quantity ?? 0),
      target_price_brl: r.target_price_brl != null ? Number(r.target_price_brl) : null,
      tipo: (r.tipo ?? 'fabricacao') as BomTipo,
    }));
    setForm({
      ...emptyForm,
      id: c.id,
      name: c.name,
      originalName: c.name,
      mountType: (c as any).mount_type ?? null,
      usageCount: totalUsageCount,
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
        { bom_item_id: null, product_id: productId, product_name: product.name, quantity: 1, target_price_brl: null, tipo: 'fabricacao' },
      ],
    });
  }

  /**
   * Compara usageRows atual vs original e aplica insert/update/delete
   * em bom_items pra refletir as mudanças. Linhas existentes detectadas
   * por bom_item_id. Quando há filtro de produto ativo, só toca em rows
   * daquele produto — nunca deleta vínculos de outros produtos.
   */
  async function syncUsageRows(componentId: string, current: BomEditRow[], original: BomEditRow[]) {
    const originalById = new Map(original.filter((r) => r.bom_item_id).map((r) => [r.bom_item_id!, r]));
    const currentIds = new Set(current.filter((r) => r.bom_item_id).map((r) => r.bom_item_id!));

    // 1. Deletes: estava no original, sumiu do current. Se filtro ativo,
    //    só considera rows do produto filtrado (escopo restrito).
    const toDelete = original.filter((r) =>
      r.bom_item_id && !currentIds.has(r.bom_item_id) &&
      (productFilter ? r.product_id === productFilter : true)
    );
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
      const tipo = r.tipo ?? 'fabricacao';
      if (r.bom_item_id) {
        const orig = originalById.get(r.bom_item_id);
        if (!orig) continue;
        const changed = orig.quantity !== qty
          || (orig.target_price_brl ?? null) !== target
          || (orig.tipo ?? 'fabricacao') !== tipo;
        if (changed) {
          await supabase
            .from('bom_items')
            .update({ quantity: qty, target_price_brl: target, tipo })
            .eq('id', r.bom_item_id);
        }
      } else {
        await supabase
          .from('bom_items')
          .insert({ component_id: componentId, product_id: r.product_id, quantity: qty, target_price_brl: target, tipo });
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

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      mount_type: form.mountType,
    };

    try {
      if (form.id) {
        const { error: updErr } = await supabase.from('components').update(payload).eq('id', form.id);
        if (updErr) throw new Error(updErr.message);
        await syncUsageRows(form.id, form.usageRows, form.usageRowsOriginal);
      } else {
        // Componente novo. Se há filtro de produto ativo, vincula direto na BOM
        // do produto com qty + custo + tipo informados no form. Senão, cria
        // solto no catálogo (fluxo antigo).
        const { data: created, error: insErr } = await supabase
          .from('components')
          .insert(payload)
          .select('id, name')
          .single();
        if (insErr || !created) throw new Error(insErr?.message ?? 'Falha ao criar componente');

        if (productFilter && form.initialQuantity > 0) {
          const { error: bomErr } = await supabase.from('bom_items').insert({
            component_id: (created as any).id,
            product_id: productFilter,
            quantity: form.initialQuantity,
            target_price_brl: form.initialTargetPrice != null && Number.isFinite(Number(form.initialTargetPrice))
              ? Number(form.initialTargetPrice)
              : null,
            tipo: form.initialTipo,
          });
          if (bomErr) {
            // Componente foi criado mas vínculo falhou — avisa pra não confundir
            toast.error('Componente criado, mas não vinculado', friendlyDbError(bomErr));
          } else {
            const productName = products.find((p) => p.id === productFilter)?.name ?? 'produto';
            toast.success('Componente criado', `"${(created as any).name}" adicionado ao ${productName} (${form.initialTipo}).`);
          }
        } else {
          toast.success('Componente criado', `"${(created as any).name}" adicionado ao catálogo.`);
        }
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Salva inline o "último custo" da coluna. Identifica qual bom_item editar:
   * com filtro de produto → o bom_item daquele produto;
   * sem filtro → o bom_item mais recente do componente (que é o que está sendo exibido).
   */
  async function saveCostInline(componentId: string, rawValue: string) {
    const trimmed = rawValue.trim();
    const newPrice = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
    if (newPrice != null && !Number.isFinite(newPrice)) {
      toast.error('Valor inválido', 'Use número (ex: 0.12 ou 0,12).');
      return;
    }
    const links = bomLinks.filter((l) => l.component_id === componentId);
    let target: BomLink | undefined;
    if (productFilter) {
      target = links.find((l) => l.product_id === productFilter);
    } else {
      target = [...links].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
    }
    if (!target) {
      toast.error('Sem vínculo', 'Componente não está em nenhuma BOM. Edite e adicione em "Uso em produtos".');
      return;
    }
    const current = target.target_price_brl;
    if ((current ?? null) === newPrice) return; // nada mudou
    setSavingCostId(componentId);
    const { error: updErr } = await supabase
      .from('bom_items')
      .update({ target_price_brl: newPrice })
      .eq('id', target.id);
    setSavingCostId(null);
    if (updErr) {
      toast.error('Erro', friendlyDbError(updErr));
      return;
    }
    // Atualiza estado local sem refetch completo
    setBomLinks((prev) =>
      prev.map((l) => (l.id === target!.id ? { ...l, target_price_brl: newPrice } : l))
    );
    toast.success(
      'Custo atualizado',
      `${newPrice != null ? `R$ ${newPrice.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}` : 'sem valor'}`
    );
  }

  function startEditCost(componentId: string, current: number | null) {
    setEditingCostId(componentId);
    setEditingCostValue(current != null ? String(current) : '');
  }

  function cancelEditCost() {
    setEditingCostId(null);
    setEditingCostValue('');
  }

  async function commitEditCost() {
    if (!editingCostId) return;
    await saveCostInline(editingCostId, editingCostValue);
    cancelEditCost();
  }

  /**
   * Salva inline a quantidade do bom_item daquele produto (só funciona com filtro ativo).
   */
  async function saveQtyInline(componentId: string, rawValue: string) {
    if (!productFilter) return;
    const trimmed = rawValue.trim();
    const newQty = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
    if (newQty == null || !Number.isFinite(newQty) || newQty <= 0) {
      toast.error('Quantidade inválida', 'Use número maior que zero.');
      return;
    }
    const link = bomLinks.find((l) => l.component_id === componentId && l.product_id === productFilter);
    if (!link) {
      toast.error('Sem vínculo', 'Componente não está nesta BOM.');
      return;
    }
    if (Number(link.quantity) === newQty) return;
    setSavingQtyId(componentId);
    const { error: updErr } = await supabase
      .from('bom_items')
      .update({ quantity: newQty })
      .eq('id', link.id);
    setSavingQtyId(null);
    if (updErr) {
      toast.error('Erro', friendlyDbError(updErr));
      return;
    }
    setBomLinks((prev) =>
      prev.map((l) => (l.id === link.id ? { ...l, quantity: newQty } : l))
    );
    toast.success('Qtd atualizada', `Nova quantidade: ${newQty}`);
  }

  function startEditQty(componentId: string, current: number) {
    setEditingQtyId(componentId);
    setEditingQtyValue(String(current));
  }
  function cancelEditQty() {
    setEditingQtyId(null);
    setEditingQtyValue('');
  }
  async function commitEditQty() {
    if (!editingQtyId) return;
    await saveQtyInline(editingQtyId, editingQtyValue);
    cancelEditQty();
  }

  /**
   * Toggle do checkbox "mostrar no PDF" para um bom_item específico.
   * Usado quando há filtro de produto: marca/desmarca o item que vai aparecer
   * no relatório PDF do produto.
   */
  async function toggleShowInPdf(bomItemId: string, current: boolean) {
    // Otimista: atualiza UI primeiro, depois banco
    setBomLinks((prev) =>
      prev.map((l) => (l.id === bomItemId ? { ...l, show_in_pdf: !current } : l))
    );
    const { error: updErr } = await supabase
      .from('bom_items')
      .update({ show_in_pdf: !current })
      .eq('id', bomItemId);
    if (updErr) {
      // Reverte se deu erro
      setBomLinks((prev) =>
        prev.map((l) => (l.id === bomItemId ? { ...l, show_in_pdf: current } : l))
      );
      toast.error('Falha ao atualizar', friendlyDbError(updErr));
    }
  }


  async function remove(c: Component) {
    const usageLinks = bomLinks.filter((l) => l.component_id === c.id);

    // ── Com filtro de produto ativo: remove APENAS desse produto ──
    if (productFilter) {
      const link = usageLinks.find((l) => l.product_id === productFilter);
      const productName = products.find((p) => p.id === productFilter)?.name ?? 'produto';
      if (!link) {
        toast.error('Não vinculado', `"${c.name}" não está em ${productName}.`);
        return;
      }
      const otherCount = usageLinks.length - 1;
      setConfirm({
        message:
          `Remover "${c.name}" apenas de ${productName}?` +
          (otherCount > 0
            ? ` O componente continuará nos outros ${otherCount} ${otherCount === 1 ? 'produto' : 'produtos'}.`
            : ' Esta é a única vinculação — o componente em si não será apagado, ficará apenas no catálogo sem uso.'),
        onConfirm: async () => {
          setConfirm(null);
          const { error: bomErr } = await supabase.from('bom_items').delete().eq('id', link.id);
          if (bomErr) {
            toast.error('Falha ao remover', friendlyDbError(bomErr));
            return;
          }
          toast.success('Removido', `"${c.name}" removido de ${productName}.`);
          await load();
        },
      });
      return;
    }

    // ── Sem filtro: remove o componente inteiro do catálogo (cascade nas BOMs) ──
    if (usageLinks.length === 0) {
      setConfirm({
        message: `Remover componente "${c.name}" do catálogo?`,
        onConfirm: async () => {
          setConfirm(null);
          const { error } = await supabase.from('components').delete().eq('id', c.id);
          if (error) {
            toast.error('Não foi possível remover', friendlyDbError(error));
            return;
          }
          toast.success('Removido', `Componente "${c.name}" excluído.`);
          await load();
        },
      });
      return;
    }

    const affectedProductIds = new Set(usageLinks.map((l) => l.product_id));
    const affectedProductNames = products
      .filter((p) => affectedProductIds.has(p.id))
      .map((p) => p.name);
    const productsLabel = affectedProductNames.length > 3
      ? `${affectedProductNames.slice(0, 3).join(', ')} e mais ${affectedProductNames.length - 3}`
      : affectedProductNames.join(', ');

    setConfirm({
      message:
        `"${c.name}" está sendo usado em ${usageLinks.length} ${usageLinks.length === 1 ? 'produto' : 'produtos'} (${productsLabel}). ` +
        `Remover do catálogo vai apagar das BOMs desses produtos e os custos serão recalculados. Confirma?`,
      onConfirm: async () => {
        setConfirm(null);
        const { error: bomErr } = await supabase.from('bom_items').delete().eq('component_id', c.id);
        if (bomErr) {
          toast.error('Falha ao limpar BOMs', friendlyDbError(bomErr));
          return;
        }
        const { error: compErr } = await supabase.from('components').delete().eq('id', c.id);
        if (compErr) {
          toast.error('Não foi possível remover', friendlyDbError(compErr));
          return;
        }
        toast.success('Removido', `"${c.name}" excluído de ${usageLinks.length} ${usageLinks.length === 1 ? 'BOM' : 'BOMs'}.`);
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

  // Lista flat ordenada por nome — sem hierarquia
  const orderedList = useMemo(
    () => [...filteredComponents].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [filteredComponents]
  );

  const visible = orderedList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filteredCount = orderedList.length;

  useEffect(() => { setPage(1); }, [search, productFilter]);

  const filteredProductName = productFilter
    ? products.find((p) => p.id === productFilter)?.name ?? ''
    : '';

  function handleExport() {
    if (productFilter) {
      const product = products.find((p) => p.id === productFilter);
      if (!product) {
        toast.error('Erro', 'Produto do filtro não encontrado.');
        return;
      }
      exportComponentsByProduct(product, components, bomLinks);
      toast.success('PDF gerado', `Composição do ${product.name} exportada.`);
    } else {
      exportComponentsGeneral(components, bomLinks);
      toast.success('PDF gerado', `Catálogo com ${components.length} componentes.`);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Componentes</h1>
          <p className="text-sm text-slate-500">
            Catálogo de matérias-primas usado nas BOMs dos produtos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleExport}
            disabled={loading || components.length === 0}
            title={
              productFilter
                ? `Exportar PDF com fabricação + acervo do ${filteredProductName}`
                : 'Exportar PDF do catálogo completo'
            }
          >
            ↓ Exportar PDF
          </Button>
          <Button onClick={openCreate}>+ Novo componente</Button>
        </div>
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
          Mostrando componentes usados em <strong>{filteredProductName}</strong> ({filteredCount} {filteredCount === 1 ? 'item' : 'itens'}). Ações (editar, remover) afetam apenas este produto.
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
                  {productFilter && (
                    <th className="px-3 py-3 text-center" title="Marca/desmarca para incluir no PDF de exportação">
                      PDF
                    </th>
                  )}
                  <th className="px-5 py-3">Nome</th>
                  <th className="px-5 py-3 text-center">Tipo</th>
                  <th className="px-5 py-3 text-center">
                    {productFilter ? 'Qtd / produto' : 'Usado em'}
                  </th>
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
                  let cost: number | null = null;
                  if (productFilter) {
                    cost = links.find((l) => l.product_id === productFilter)?.target_price_brl ?? null;
                  } else {
                    const sorted = [...links].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
                    cost = sorted.find((l) => l.target_price_brl != null)?.target_price_brl ?? null;
                  }

                  const mountType = (c as any).mount_type as ComponentMountType | null;
                  const filterLink = productFilter
                    ? links.find((l) => l.product_id === productFilter)
                    : null;
                  const showInPdf = filterLink ? filterLink.show_in_pdf !== false : true;
                  return (
                    <tr key={c.id} className={cn(
                      'border-b border-slate-100 last:border-0',
                      productFilter && !showInPdf && 'bg-slate-50/70 text-slate-400'
                    )}>
                      {productFilter && (
                        <td className="px-3 py-3 text-center">
                          {filterLink ? (
                            <input
                              type="checkbox"
                              checked={showInPdf}
                              onChange={() => toggleShowInPdf(filterLink.id, showInPdf)}
                              title={showInPdf ? 'Aparece no PDF — clique para esconder' : 'Oculto no PDF — clique para mostrar'}
                              className="h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            />
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-5 py-3 font-medium text-slate-900">
                        {c.name}
                      </td>
                      <td className="px-5 py-3 text-center">
                        {mountType ? (
                          <span className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                            mountType === 'SMD'
                              ? 'border-purple-200 bg-purple-50 text-purple-700'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          )}>
                            {mountType}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-center text-slate-600">
                        {productFilter ? (() => {
                          const link = links.find((l) => l.product_id === productFilter);
                          if (!link) return <span className="text-xs text-slate-400">—</span>;
                          const qty = Number(link.quantity ?? 0);
                          const tipoLabel = link.tipo === 'acervo' ? 'acervo' : 'fabric.';
                          const tipoColor = link.tipo === 'acervo'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200';
                          return (
                            <div className="flex items-center justify-center gap-1.5">
                              {editingQtyId === c.id ? (
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={editingQtyValue}
                                  onChange={(e) => setEditingQtyValue(e.target.value)}
                                  onBlur={commitEditQty}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      (e.target as HTMLInputElement).blur();
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      cancelEditQty();
                                    }
                                  }}
                                  disabled={savingQtyId === c.id}
                                  autoFocus
                                  className="w-16 rounded border border-brand-300 bg-white px-2 py-1 text-center text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startEditQty(c.id, qty)}
                                  title="Clique para editar a quantidade"
                                  className="rounded px-2 py-0.5 transition-colors hover:bg-brand-50 hover:text-brand-700"
                                >
                                  <span className="font-semibold text-slate-800">{qty}×</span>
                                </button>
                              )}
                              <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', tipoColor)}>
                                {tipoLabel}
                              </span>
                            </div>
                          );
                        })() : usage === 0 ? (
                          <span className="text-xs text-slate-400">não usado</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {usage} {usage === 1 ? 'produto' : 'produtos'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {editingCostId === c.id ? (
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            value={editingCostValue}
                            onChange={(e) => setEditingCostValue(e.target.value)}
                            onBlur={commitEditCost}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                (e.target as HTMLInputElement).blur();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEditCost();
                              }
                            }}
                            disabled={savingCostId === c.id}
                            autoFocus
                            placeholder="0,0000"
                            className="w-24 rounded border border-brand-300 bg-white px-2 py-1 text-right text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditCost(c.id, cost)}
                            title="Clique para editar o último custo"
                            className="rounded px-2 py-0.5 text-right transition-colors hover:bg-brand-50 hover:text-brand-700"
                          >
                            {cost != null
                              ? <span className="font-medium">R$ {Number(cost).toLocaleString('pt-BR', { minimumFractionDigits: 4 })}</span>
                              : <span className="text-xs text-slate-400">— editar</span>}
                          </button>
                        )}
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
                <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                  <div>
                    <Label htmlFor="cmp-name">Nome *</Label>
                    <Input
                      id="cmp-name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Ex: Resistor 1K 0603 SMD"
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label htmlFor="cmp-mount">Montagem</Label>
                    <select
                      id="cmp-mount"
                      value={form.mountType ?? ''}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          mountType: (e.target.value || null) as ComponentMountType | null,
                        })
                      }
                      className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="">— (não eletrônico)</option>
                      <option value="SMD">SMD (superfície)</option>
                      <option value="PTH">PTH (furo passante)</option>
                    </select>
                  </div>
                </div>

                {/* Criação direta vinculada a um produto — só ativa quando há filtro de produto */}
                {!form.id && productFilter && (
                  <div className="rounded-md border border-brand-200 bg-brand-50/50 px-3 py-3 space-y-3">
                    <p className="text-xs text-brand-800">
                      Será adicionado direto ao <strong>{filteredProductName}</strong>:
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <Label>Tipo</Label>
                        <select
                          value={form.initialTipo}
                          onChange={(e) => setForm({ ...form, initialTipo: e.target.value as BomTipo })}
                          className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="fabricacao">Fabricação</option>
                          <option value="acervo">Acervo</option>
                        </select>
                      </div>
                      <div>
                        <Label>Quantidade</Label>
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          value={form.initialQuantity}
                          onChange={(e) => setForm({ ...form, initialQuantity: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <Label>Custo unit. (R$)</Label>
                        <Input
                          type="number"
                          step="0.0001"
                          min="0"
                          placeholder="0,0000"
                          value={form.initialTargetPrice ?? ''}
                          onChange={(e) => setForm({ ...form, initialTargetPrice: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      <strong>Fabricação</strong>: componente da placa eletrônica (resistor, capacitor, IC). <strong>Acervo</strong>: embalagem, etiqueta, caixa, manual.
                    </p>
                  </div>
                )}


                {/* Uso em produtos — edição inline de qty + custo target por produto */}
                {form.id && (
                  <div className="border-t border-slate-200 pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <Label>
                        {productFilter ? `Uso em ${filteredProductName}` : 'Uso em produtos'}
                      </Label>
                      <span className="text-xs text-slate-400">
                        {productFilter
                          ? `escopo: 1 produto (filtro ativo)`
                          : `${form.usageRows.length} ${form.usageRows.length === 1 ? 'vínculo' : 'vínculos'}`}
                      </span>
                    </div>
                    {productFilter && form.usageCount > 1 && (
                      <p className="mb-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                        Este componente também é usado em outros {form.usageCount - 1} produtos. Edições aqui afetam apenas <strong>{filteredProductName}</strong>. Pra editar em escala, limpe o filtro de produto.
                      </p>
                    )}

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
                            <select
                              value={r.tipo}
                              onChange={(e) => updateUsageRow(idx, { tipo: e.target.value as BomTipo })}
                              className={cn(
                                'rounded border px-1.5 py-1 text-[11px] font-medium',
                                r.tipo === 'fabricacao' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                              )}
                              title="Tipo do item: fabricação (placa) ou acervo (embalagem/etiqueta)"
                            >
                              <option value="fabricacao">Fabric.</option>
                              <option value="acervo">Acervo</option>
                            </select>
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
                  {saving ? 'Salvando…' : form.id ? 'Salvar' : 'Criar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
