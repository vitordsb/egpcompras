import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import Pagination from '@/components/ui/Pagination';

const PAGE_SIZE = 25;

interface StockItem {
  id: string;
  item_code: string;
  item_name: string;
  quantity: number;
  reserved_quantity: number;
  unit: string;
  min_quantity: number;
  updated_at: string;
}

interface Movement {
  id: string;
  item_code: string;
  item_name: string;
  quantity: number;
  type: 'entrada' | 'saida' | 'ajuste';
  notes: string | null;
  created_at: string;
  created_by: string | null;
  shipment: { client_name: string; numero_venda: string | null } | null;
}

interface Product {
  id: string;
  name: string;
  sku: string | null;
}

interface BomAnalysis {
  component: string;
  sku: string | null;
  unit: string;
  qty_per_unit: number;
  needed: number;
  available: number;
  missing: number;
  ok: boolean;
}

interface FeasibilityResult {
  product: string;
  quantity_requested: number;
  feasible: boolean;
  components_ok: number;
  components_missing: number;
  missing: BomAnalysis[];
  all_components: BomAnalysis[];
}

interface NeedRow {
  item_code: string;
  item_name: string;
  needed: number;
  available: number;
  to_buy: number;
  shipments: string[];
}

function fmtQty(n: number, unit: string) {
  return `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

type Tab = 'stock' | 'needs' | 'capacity' | 'history';

export default function EstoquePage() {
  const [tab, setTab] = useState<Tab>('stock');
  const [stock, setStock] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [needs, setNeeds] = useState<NeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stockPage, setStockPage] = useState(1);
  const [histPage, setHistPage] = useState(1);

  // Aba Capacidade
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  const [feasibility, setFeasibility] = useState<FeasibilityResult | null>(null);
  const [maxProducible, setMaxProducible] = useState<{ max: number; limiting: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const [consumptionRates, setConsumptionRates] = useState<Record<string, number>>({}); // item_code → unidades/dia

  async function loadStock() {
    const [stockRes, movRes] = await Promise.all([
      supabase.from('stock_items').select('*').order('item_name'),
      supabase
        .from('stock_movements')
        .select('item_code, quantity, type, created_at')
        .eq('type', 'saida')
        .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString()),
    ]);
    setStock((stockRes.data ?? []) as StockItem[]);
    // Calcula consumo médio diário por item_code (últimos 90 dias)
    const totals: Record<string, number> = {};
    for (const m of (movRes.data ?? []) as any[]) {
      const code = (m.item_code ?? '').toUpperCase();
      totals[code] = (totals[code] ?? 0) + Math.abs(Number(m.quantity));
    }
    const rates: Record<string, number> = {};
    for (const [code, total] of Object.entries(totals)) {
      rates[code] = total / 90;
    }
    setConsumptionRates(rates);
  }

  async function loadMovements() {
    const { data } = await supabase
      .from('stock_movements')
      .select('id, item_code, item_name, quantity, type, notes, created_at, created_by, shipment:shipments(client_name, numero_venda)')
      .order('created_at', { ascending: false })
      .limit(100);
    setMovements((data ?? []) as unknown as Movement[]);
  }

  function reorderForecast(s: StockItem): { label: string; cls: string } | null {
    if (Number(s.min_quantity) <= 0) return null;
    const available = Number(s.quantity) - Number(s.reserved_quantity);
    if (available <= Number(s.min_quantity)) return { label: 'Repor agora', cls: 'text-red-700 font-semibold' };
    const rate = consumptionRates[(s.item_code ?? '').toUpperCase()];
    if (!rate || rate === 0) return { label: 'Sem histórico', cls: 'text-slate-400' };
    const days = Math.floor((available - Number(s.min_quantity)) / rate);
    if (days <= 7)  return { label: `Em ~${days}d`, cls: 'text-red-600 font-medium' };
    if (days <= 30) return { label: `Em ~${days}d`, cls: 'text-amber-600' };
    return { label: `Em ~${days}d`, cls: 'text-slate-400' };
  }

  async function loadNeeds() {
    // Itens dos pedidos pendentes
    const { data: pendingItems } = await supabase
      .from('shipment_items')
      .select('item_code, item_name, quantity, shipment:shipments!inner(id, client_name, numero_venda, status)')
      .eq('shipments.status', 'pending');

    // Disponível = físico − reservado
    const stockMap: Record<string, number> = {};
    for (const s of stock) stockMap[s.item_code] = Number(s.quantity) - Number(s.reserved_quantity);

    const needsMap: Record<string, NeedRow> = {};
    for (const it of (pendingItems ?? []) as any[]) {
      const code = (it.item_code ?? it.item_name ?? '').toUpperCase();
      if (!needsMap[code]) {
        needsMap[code] = {
          item_code: code,
          item_name: it.item_name ?? it.item_code ?? code,
          needed: 0, available: stockMap[code] ?? 0, to_buy: 0, shipments: [],
        };
      }
      needsMap[code].needed += Number(it.quantity ?? 1);
      const label = it.shipment?.numero_venda ? `#${it.shipment.numero_venda}` : it.shipment?.client_name ?? '?';
      if (!needsMap[code].shipments.includes(label)) needsMap[code].shipments.push(label);
    }
    const rows = Object.values(needsMap).map((r) => ({
      ...r,
      to_buy: Math.max(0, r.needed - r.available),
    })).sort((a, b) => b.to_buy - a.to_buy);
    setNeeds(rows);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadStock();
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (tab === 'needs' && needs.length === 0) loadNeeds();
    if (tab === 'history' && movements.length === 0) loadMovements();
    if (tab === 'capacity' && products.length === 0) {
      supabase.from('products').select('id, name, sku').order('name').then(({ data }) => {
        setProducts((data ?? []) as Product[]);
      });
    }
  }, [tab]);

  async function checkFeasibility(e: FormEvent) {
    e.preventDefault();
    if (!selectedProduct) return;
    setChecking(true);
    setFeasibility(null);
    setMaxProducible(null);
    const qty = Number(qtyInput);

    const product = products.find((p) => p.id === selectedProduct);
    if (!product) { setChecking(false); return; }

    // Busca BOM
    const { data: bom } = await supabase
      .from('bom_items')
      .select('quantity, component:components(id, name, sku, unit)')
      .eq('product_id', product.id);

    if (!bom?.length) {
      setFeasibility({ product: product.name, quantity_requested: qty, feasible: false, components_ok: 0, components_missing: 0, missing: [], all_components: [] });
      setChecking(false);
      return;
    }

    const analysis: BomAnalysis[] = [];
    let maxProd = Infinity;

    for (const item of bom as any[]) {
      const comp = item.component;
      const qtyPerUnit = Number(item.quantity);

      let stockRow: any = null;
      if (comp.id) {
        const { data } = await supabase.from('stock_items').select('quantity, reserved_quantity').eq('component_id', comp.id).maybeSingle();
        stockRow = data;
      }
      if (!stockRow && comp.sku) {
        const { data } = await supabase.from('stock_items').select('quantity, reserved_quantity').ilike('item_code', comp.sku).maybeSingle();
        stockRow = data;
      }

      const available = stockRow ? Number(stockRow.quantity) - Number(stockRow.reserved_quantity) : 0;
      const maxFromThis = qtyPerUnit > 0 ? Math.floor(available / qtyPerUnit) : Infinity;
      if (isFinite(maxFromThis)) maxProd = Math.min(maxProd, maxFromThis);

      if (qty > 0) {
        const needed = qtyPerUnit * qty;
        analysis.push({ component: comp.name, sku: comp.sku, unit: comp.unit ?? 'un', qty_per_unit: qtyPerUnit, needed, available, missing: Math.max(0, needed - available), ok: available >= needed });
      } else {
        analysis.push({ component: comp.name, sku: comp.sku, unit: comp.unit ?? 'un', qty_per_unit: qtyPerUnit, needed: 0, available, missing: 0, ok: true });
      }
    }

    if (qty > 0) {
      const missing = analysis.filter((a) => !a.ok);
      setFeasibility({ product: product.name, quantity_requested: qty, feasible: missing.length === 0, components_ok: analysis.length - missing.length, components_missing: missing.length, missing, all_components: analysis });
    }
    setMaxProducible({ max: isFinite(maxProd) ? maxProd : 0, limiting: analysis.reduce((min, a) => a.missing === 0 && a.available / a.qty_per_unit < (min ? min.available / min.qty_per_unit : Infinity) ? a : min, analysis[0])?.component ?? '' });
    setChecking(false);
  }

  const filteredStock = stock.filter((s) =>
    !search.trim() ||
    s.item_name.toLowerCase().includes(search.toLowerCase()) ||
    s.item_code.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => { setStockPage(1); }, [search]);
  useEffect(() => { setHistPage(1); }, [tab]);

  const pagedStock = filteredStock.slice((stockPage - 1) * PAGE_SIZE, stockPage * PAGE_SIZE);
  const pagedMovements = movements.slice((histPage - 1) * PAGE_SIZE, histPage * PAGE_SIZE);

  const shortages = needs.filter((n) => n.to_buy > 0);

  const TABS = [
    { key: 'stock',    label: 'Estoque atual' },
    { key: 'needs',    label: `O que comprar${shortages.length > 0 ? ` (${shortages.length})` : ''}` },
    { key: 'capacity', label: 'Capacidade produtiva' },
    { key: 'history',  label: 'Movimentações' },
  ] as const;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Estoque</h1>
        <p className="text-sm text-slate-500">
          Saldo de materiais, entradas, saídas e necessidade de compra baseada nos pedidos pendentes.
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Estoque atual ── */}
      {tab === 'stock' && (
        <>
          <div className="mb-4">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou código…"
            />
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Carregando…</p>
          ) : filteredStock.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-slate-500">
                  {stock.length === 0
                    ? 'Nenhum item no estoque ainda. Use o chat EGP: "chegou 100 sirenes brancas (EGPS1)".'
                    : 'Nenhum item bate com a busca.'}
                </p>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Código</th>
                      <th className="px-5 py-3">Item</th>
                      <th className="px-5 py-3 text-right">Físico</th>
                      <th className="px-5 py-3 text-right">Reservado</th>
                      <th className="px-5 py-3 text-right">Disponível</th>
                      <th className="px-5 py-3 text-right">Mín.</th>
                      <th className="px-5 py-3">Repor em</th>
                      <th className="px-5 py-3">Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedStock.map((s) => {
                      const available = Number(s.quantity) - Number(s.reserved_quantity);
                      const low = available <= Number(s.min_quantity) && Number(s.min_quantity) > 0;
                      const negative = available < 0;
                      return (
                        <tr key={s.id} className={cn('border-b border-slate-100 last:border-0', negative && 'bg-red-50')}>
                          <td className="px-5 py-3 font-mono text-xs text-slate-500">{s.item_code}</td>
                          <td className="px-5 py-3 font-medium text-slate-900">{s.item_name}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-slate-500">{fmtQty(s.quantity, s.unit)}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-amber-600">
                            {Number(s.reserved_quantity) > 0 ? fmtQty(s.reserved_quantity, s.unit) : '—'}
                          </td>
                          <td className={cn('px-5 py-3 text-right font-semibold tabular-nums', negative ? 'text-red-700' : low ? 'text-amber-700' : 'text-emerald-700')}>
                            {fmtQty(available, s.unit)}
                            {negative && <span className="ml-1 text-[10px] font-normal text-red-500">negativo</span>}
                            {!negative && low && <span className="ml-1 text-[10px] font-normal text-amber-500">baixo</span>}
                          </td>
                          <td className="px-5 py-3 text-right text-slate-400 tabular-nums">
                            {Number(s.min_quantity) > 0 ? fmtQty(s.min_quantity, s.unit) : '—'}
                          </td>
                          <td className="px-5 py-3 text-xs">
                            {(() => { const f = reorderForecast(s); return f ? <span className={f.cls}>{f.label}</span> : <span className="text-slate-300">—</span>; })()}
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-400">{fmtDate(s.updated_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination total={filteredStock.length} page={stockPage} pageSize={PAGE_SIZE} onChange={setStockPage} className="px-5" />
            </Card>
          )}
        </>
      )}

      {/* ── O que comprar ── */}
      {tab === 'needs' && (
        <>
          {shortages.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <strong>{shortages.length} item{shortages.length !== 1 ? 's' : ''} precisam ser comprados</strong> para cobrir os pedidos pendentes.
              Peça ao EGP: <em>"gera o relatório de compras"</em> para uma lista formatada.
            </div>
          )}
          {needs.length === 0 ? (
            <Card><CardBody><p className="text-sm text-slate-500">Nenhum pedido pendente com itens cadastrados.</p></CardBody></Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Item</th>
                      <th className="px-5 py-3 text-right">Necessário</th>
                      <th className="px-5 py-3 text-right">Em estoque</th>
                      <th className="px-5 py-3 text-right">Comprar</th>
                      <th className="px-5 py-3">Pedidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {needs.map((n) => (
                      <tr key={n.item_code} className={cn('border-b border-slate-100 last:border-0', n.to_buy > 0 && 'bg-red-50/40')}>
                        <td className="px-5 py-3">
                          <div className="font-medium text-slate-900">{n.item_name}</div>
                          <div className="font-mono text-[11px] text-slate-400">{n.item_code}</div>
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-700">{n.needed}</td>
                        <td className={cn('px-5 py-3 text-right tabular-nums font-medium', n.available < n.needed ? 'text-red-700' : 'text-emerald-700')}>
                          {n.available}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {n.to_buy > 0 ? (
                            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">{n.to_buy}</span>
                          ) : (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">OK</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">{n.shipments.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── Capacidade produtiva ── */}
      {tab === 'capacity' && (
        <div className="space-y-6">
          <Card>
            <CardBody>
              <form onSubmit={checkFeasibility} className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[200px]">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Produto</label>
                  <select
                    value={selectedProduct}
                    onChange={(e) => { setSelectedProduct(e.target.value); setFeasibility(null); setMaxProducible(null); }}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    required
                  >
                    <option value="">Selecione um produto…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="w-32">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Quantidade</label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={qtyInput}
                    onChange={(e) => setQtyInput(e.target.value)}
                    placeholder="ex: 50"
                  />
                </div>
                <Button type="submit" disabled={!selectedProduct || checking}>
                  {checking ? 'Verificando…' : 'Verificar'}
                </Button>
              </form>
            </CardBody>
          </Card>

          {maxProducible !== null && (
            <div className={cn(
              'rounded-lg border px-4 py-3 text-sm',
              maxProducible.max === 0
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            )}>
              {maxProducible.max === 0
                ? 'Estoque insuficiente — não é possível produzir nenhuma unidade com os componentes atuais.'
                : <>Com o estoque atual, é possível produzir <strong>{maxProducible.max} unidades</strong>.</>}
            </div>
          )}

          {feasibility && feasibility.all_components.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              BOM não cadastrado para este produto. Acesse a página de Produtos e adicione os componentes.
            </div>
          )}

          {feasibility && feasibility.all_components.length > 0 && (
            <Card>
              <div className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
                <span className="font-medium text-slate-900">{feasibility.product} × {feasibility.quantity_requested} unidades</span>
                <span className={cn(
                  'rounded-full px-3 py-1 text-xs font-semibold',
                  feasibility.feasible ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                )}>
                  {feasibility.feasible ? '✓ Produção viável' : `✗ Faltam ${feasibility.components_missing} componente${feasibility.components_missing !== 1 ? 's' : ''}`}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2">Componente</th>
                      <th className="px-5 py-2 text-right">Por unid.</th>
                      <th className="px-5 py-2 text-right">Total necessário</th>
                      <th className="px-5 py-2 text-right">Em estoque</th>
                      <th className="px-5 py-2 text-right">Falta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feasibility.all_components
                      .sort((a, b) => (a.ok ? 1 : -1) - (b.ok ? 1 : -1))
                      .map((c, i) => (
                      <tr key={i} className={cn('border-b border-slate-100 last:border-0', !c.ok && 'bg-red-50/50')}>
                        <td className="px-5 py-2.5">
                          <div className="font-medium text-slate-900">{c.component}</div>
                          {c.sku && <div className="font-mono text-[11px] text-slate-400">{c.sku}</div>}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-slate-500">{c.qty_per_unit} {c.unit}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums font-medium text-slate-700">{c.needed} {c.unit}</td>
                        <td className={cn('px-5 py-2.5 text-right tabular-nums font-medium', c.ok ? 'text-emerald-700' : 'text-red-700')}>
                          {c.available} {c.unit}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          {c.missing > 0 ? (
                            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">{c.missing} {c.unit}</span>
                          ) : (
                            <span className="text-emerald-500 text-xs">✓</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Movimentações ── */}
      {tab === 'history' && (
        <Card>
          {movements.length === 0 ? (
            <CardBody><p className="text-sm text-slate-500">Nenhuma movimentação registrada.</p></CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Data</th>
                    <th className="px-5 py-3">Tipo</th>
                    <th className="px-5 py-3">Item</th>
                    <th className="px-5 py-3 text-right">Qtd</th>
                    <th className="px-5 py-3">Ref / Obs</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedMovements.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-2 text-xs text-slate-400 whitespace-nowrap">{fmtDate(m.created_at)}</td>
                      <td className="px-5 py-2">
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          m.type === 'entrada' ? 'bg-emerald-100 text-emerald-700' :
                          m.type === 'saida'   ? 'bg-red-100 text-red-700' :
                                                  'bg-slate-100 text-slate-600'
                        )}>
                          {m.type}
                        </span>
                      </td>
                      <td className="px-5 py-2 font-medium text-slate-900">{m.item_name}</td>
                      <td className={cn('px-5 py-2 text-right tabular-nums font-semibold', m.quantity > 0 ? 'text-emerald-700' : 'text-red-700')}>
                        {m.quantity > 0 ? '+' : ''}{m.quantity}
                      </td>
                      <td className="px-5 py-2 text-xs text-slate-500">
                        {(m.shipment as any)?.numero_venda ? `Pedido #${(m.shipment as any).numero_venda}` : ''}
                        {(m.shipment as any)?.client_name && !(m.shipment as any)?.numero_venda ? (m.shipment as any).client_name : ''}
                        {m.notes ? (m.shipment ? ` · ${m.notes}` : m.notes) : ''}
                        {m.created_by && <span className="ml-1 text-slate-400">· {m.created_by.split('@')[0]}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination total={movements.length} page={histPage} pageSize={PAGE_SIZE} onChange={setHistPage} className="px-5" />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
