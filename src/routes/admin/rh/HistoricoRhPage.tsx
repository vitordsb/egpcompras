import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Pagamento {
  id: string;
  competencia_mes: number;
  competencia_ano: number;
  mes_pagamento_mes: number;
  mes_pagamento_ano: number;
  salario: number;
  dias_trabalhados: number;
  transporte_total: number;
  adiantamento: number;
  a_emitir: number;
  a_receber: number;
  status: string;
  prestador: { nome: string } | null;
}

const MESES = [
  'Jan','Fev','Mar','Abr','Mai','Jun',
  'Jul','Ago','Set','Out','Nov','Dez',
];

function fmt(v: number | null) {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function HistoricoRhPage() {
  const now = new Date();
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAno, setFilterAno] = useState(now.getFullYear());
  const [filterMes, setFilterMes] = useState<number | ''>('');

  useEffect(() => {
    let q = supabase.from('pagamentos_prestadores')
      .select('*, prestador:prestadores(nome)')
      .eq('competencia_ano', filterAno)
      .order('competencia_mes', { ascending: false })
      .order('prestador_id');
    if (filterMes !== '') q = (q as any).eq('competencia_mes', filterMes);
    q.then(({ data }) => {
      setPagamentos((data ?? []) as Pagamento[]);
      setLoading(false);
    });
  }, [filterAno, filterMes]);

  const anos = [2024, 2025, 2026, 2027];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Histórico</h1>
          <p className="text-sm text-slate-500">{pagamentos.length} registro(s)</p>
        </div>
        <div className="flex gap-2">
          <select
            value={filterMes}
            onChange={(e) => setFilterMes(e.target.value === '' ? '' : Number(e.target.value))}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos os meses</option>
            {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={filterAno}
            onChange={(e) => setFilterAno(Number(e.target.value))}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : pagamentos.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum pagamento registrado para este período.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Prestador</th>
                <th className="px-4 py-3 text-center">Referente a</th>
                <th className="px-4 py-3 text-right">Salário</th>
                <th className="px-4 py-3 text-right">Transporte</th>
                <th className="px-4 py-3 text-right">Adiantamento</th>
                <th className="px-4 py-3 text-right">A Emitir</th>
                <th className="px-4 py-3 text-right">A Receber</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagamentos.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{p.prestador?.nome ?? '—'}</td>
                  <td className="px-4 py-3 text-center text-slate-500">
                    {MESES[p.competencia_mes - 1]}/{p.competencia_ano}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{fmt(p.salario)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{fmt(p.transporte_total)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{p.adiantamento > 0 ? fmt(p.adiantamento) : '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-800">{fmt(p.a_emitir)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-brand-700">{fmt(p.a_receber)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.status === 'pago' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {p.status === 'pago' ? 'Pago' : 'Calculado'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
