import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, STATUS_PILL, formatDate } from '../expedicao/shared';

interface Row {
  id: string;
  client_name: string;
  numero_venda: string | null;
  data_venda: string | null;
  valor_total: number | null;
  status: string;
  data_prevista: string | null;
  created_at: string;
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function SemNotaPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('shipments')
        .select('id, client_name, numero_venda, data_venda, valor_total, status, data_prevista, created_at')
        .is('numero_nfe', null)
        .order('created_at', { ascending: false })
        .limit(300);
      setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      `${r.client_name} ${r.numero_venda ?? ''}`.toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Pedidos sem Nota</h1>
        <p className="text-sm text-slate-500">
          Pedidos registrados que ainda não têm NF emitida.
        </p>
      </div>

      <div className="mb-4">
        <input
          type="search"
          placeholder="Buscar por cliente ou venda…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card><div className="px-5 py-4 text-sm text-slate-500">Nenhum pedido sem NF encontrado.</div></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Venda</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Saída prevista</th>
                  <th className="px-5 py-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-900">{r.client_name}</td>
                    <td className="px-5 py-3 text-slate-500">
                      {r.numero_venda ? `#${r.numero_venda}` : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', STATUS_PILL[r.status as keyof typeof STATUS_PILL])}>
                        {STATUS_LABEL[r.status as keyof typeof STATUS_LABEL]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(r.data_prevista)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {r.valor_total != null ? fmtBRL(r.valor_total) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
