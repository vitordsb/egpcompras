import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import Pagination from '@/components/ui/Pagination';

const PAGE_SIZE = 25;

interface Row {
  id: string;
  client_name: string;
  numero_nfe: string | null;
  numero_venda: string | null;
  data_venda: string | null;
  valor_total: number | null;
  forma_pagamento: string | null;
  status: string;
  created_at: string;
  titulos: { id: string; financeira: { nome: string } | null; valor: number; status: string; vencimento: string | null }[];
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (s: string | null) =>
  s ? new Date(s + (s.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('pt-BR') : '—';

const TITULO_STATUS: Record<string, { label: string; cls: string }> = {
  aberto:    { label: 'Em aberto',  cls: 'bg-amber-100 text-amber-700' },
  pago:      { label: 'Pago',       cls: 'bg-emerald-100 text-emerald-700' },
  devolvido: { label: 'Devolvido',  cls: 'bg-sky-100 text-sky-700' },
  protestado:{ label: 'Protestado', cls: 'bg-red-100 text-red-700' },
};

export default function ComNotaPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('shipments')
        .select(`id, client_name, numero_nfe, numero_venda, data_venda, valor_total, forma_pagamento, status, created_at,
          titulos(id, valor, status, vencimento, financeira:financeiras(nome))`)
        .not('numero_nfe', 'is', null)
        .order('created_at', { ascending: false })
        .limit(300);
      setRows((data ?? []) as unknown as Row[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      `${r.client_name} ${r.numero_nfe ?? ''} ${r.numero_venda ?? ''}`.toLowerCase().includes(q)
    );
  }, [rows, search]);

  useEffect(() => { setPage(1); }, [search]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalAberto = rows.reduce((acc, r) => {
    return acc + r.titulos.filter((t) => t.status === 'aberto').reduce((s, t) => s + Number(t.valor), 0);
  }, 0);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Pedidos com Nota</h1>
        <p className="text-sm text-slate-500">
          Pedidos que já têm NF emitida. Títulos em financeira aparecem aqui.
        </p>
      </div>

      {totalAberto > 0 && (
        <div className="mb-5 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm">
          <span className="font-medium text-amber-800">Total em aberto nas financeiras:</span>
          <span className="font-bold text-amber-900">{fmtBRL(totalAberto)}</span>
        </div>
      )}

      <div className="mb-4">
        <input
          type="search"
          placeholder="Buscar por cliente, NF ou venda…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card><div className="px-5 py-4 text-sm text-slate-500">Nenhum pedido com NF encontrado.</div></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">NF / Venda</th>
                  <th className="px-5 py-3">Data</th>
                  <th className="px-5 py-3 text-right">Valor</th>
                  <th className="px-5 py-3">Financeira / Título</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-900">{r.client_name}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {r.numero_nfe && <div>NF {r.numero_nfe}</div>}
                      {r.numero_venda && <div className="text-xs text-slate-400">Venda #{r.numero_venda}</div>}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{fmtDate(r.data_venda ?? r.created_at)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {r.valor_total != null ? fmtBRL(r.valor_total) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {r.titulos.length === 0 ? (
                        <span className="text-xs text-slate-300">Sem título</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {r.titulos.map((t) => {
                            const st = TITULO_STATUS[t.status] ?? TITULO_STATUS.aberto;
                            return (
                              <div key={t.id} className="flex items-center gap-2 text-xs">
                                <span className="font-medium text-slate-700">{t.financeira?.nome ?? '—'}</span>
                                <span className="text-slate-400">{fmtBRL(Number(t.valor))}</span>
                                {t.vencimento && <span className="text-slate-400">vence {fmtDate(t.vencimento)}</span>}
                                <span className={cn('rounded-full px-2 py-0.5 font-medium', st.cls)}>{st.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} className="px-5" />
        </Card>
      )}
    </div>
  );
}
