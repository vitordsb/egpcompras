import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

interface StockItem {
  id: string;
  item_code: string;
  item_name: string;
  quantity: number;
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
  shipment: { client_name: string; numero_venda: string | null } | null;
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

type Tab = 'stock' | 'needs' | 'history';

export default function EstoquePage() {
  const [tab, setTab] = useState<Tab>('stock');
  const [stock, setStock] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [needs, setNeeds] = useState<NeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  async function loadStock() {
    const { data } = await supabase
      .from('stock_items')
      .select('*')
      .order('item_name');
    setStock((data ?? []) as StockItem[]);
  }

  async function loadMovements() {
    const { data } = await supabase
      .from('stock_movements')
      .select('id, item_code, item_name, quantity, type, notes, created_at, shipment:shipments(client_name, numero_venda)')
      .order('created_at', { ascending: false })
      .limit(100);
    setMovements((data ?? []) as unknown as Movement[]);
  }

  async function loadNeeds() {
    // Itens dos pedidos pendentes
    const { data: pendingItems } = await supabase
      .from('shipment_items')
      .select('item_code, item_name, quantity, shipment:shipments!inner(id, client_name, numero_venda, status)')
      .eq('shipments.status', 'pending');

    const stockMap: Record<string, number> = {};
    for (const s of stock) stockMap[s.item_code] = Number(s.quantity);

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
  }, [tab]);

  const filteredStock = stock.filter((s) =>
    !search.trim() ||
    s.item_name.toLowerCase().includes(search.toLowerCase()) ||
    s.item_code.toLowerCase().includes(search.toLowerCase())
  );

  const shortages = needs.filter((n) => n.to_buy > 0);

  const TABS = [
    { key: 'stock',   label: 'Estoque atual' },
    { key: 'needs',   label: `O que comprar${shortages.length > 0 ? ` (${shortages.length})` : ''}` },
    { key: 'history', label: 'Movimentações' },
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
                      <th className="px-5 py-3 text-right">Saldo</th>
                      <th className="px-5 py-3 text-right">Mín.</th>
                      <th className="px-5 py-3">Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStock.map((s) => {
                      const low = Number(s.quantity) <= Number(s.min_quantity) && Number(s.min_quantity) > 0;
                      const negative = Number(s.quantity) < 0;
                      return (
                        <tr key={s.id} className={cn('border-b border-slate-100 last:border-0', negative && 'bg-red-50')}>
                          <td className="px-5 py-3 font-mono text-xs text-slate-500">{s.item_code}</td>
                          <td className="px-5 py-3 font-medium text-slate-900">{s.item_name}</td>
                          <td className={cn('px-5 py-3 text-right font-semibold tabular-nums', negative ? 'text-red-700' : low ? 'text-amber-700' : 'text-slate-900')}>
                            {fmtQty(s.quantity, s.unit)}
                            {negative && <span className="ml-1 text-[10px] font-normal text-red-500">negativo</span>}
                            {!negative && low && <span className="ml-1 text-[10px] font-normal text-amber-500">baixo</span>}
                          </td>
                          <td className="px-5 py-3 text-right text-slate-400 tabular-nums">
                            {Number(s.min_quantity) > 0 ? fmtQty(s.min_quantity, s.unit) : '—'}
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-400">{fmtDate(s.updated_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
                  {movements.map((m) => (
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
