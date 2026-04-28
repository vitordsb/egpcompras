import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface Titulo {
  id: string;
  client_name: string;
  valor: number;
  vencimento: string | null;
  status: string;
  data_entrada: string;
  data_pagamento: string | null;
  numero_titulo: string | null;
  numero_nfe: string | null;
  numero_venda: string | null;
  financeira: { id: string; nome: string } | null;
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (s: string | null) =>
  s ? new Date(s + (s.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('pt-BR') : '—';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  aberto:    { label: 'Em aberto',  cls: 'bg-amber-100 text-amber-700' },
  pago:      { label: 'Pago',       cls: 'bg-emerald-100 text-emerald-700' },
  devolvido: { label: 'Devolvido',  cls: 'bg-sky-100 text-sky-700' },
  protestado:{ label: 'Protestado', cls: 'bg-red-100 text-red-700' },
};

type TabKey = 'aberto' | 'pago' | 'devolvido' | 'protestado' | 'todos';

export default function RelatorioFinanceiraPage() {
  const [titulos, setTitulos] = useState<Titulo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('aberto');
  const hoje = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('titulos')
        .select('id, client_name, valor, vencimento, status, data_entrada, data_pagamento, numero_titulo, numero_nfe, numero_venda, financeira:financeiras(id,nome)')
        .order('created_at', { ascending: false })
        .limit(500);
      setTitulos((data ?? []) as unknown as Titulo[]);
      setLoading(false);
    })();
  }, []);

  const displayed = tab === 'todos' ? titulos : titulos.filter((t) => t.status === tab);

  // Resumo por financeira (só em aberto)
  const byFin = new Map<string, { nome: string; total: number; vencidos: number; count: number }>();
  for (const t of titulos.filter((t) => t.status === 'aberto')) {
    const key = t.financeira?.nome ?? 'Sem financeira';
    if (!byFin.has(key)) byFin.set(key, { nome: key, total: 0, vencidos: 0, count: 0 });
    const e = byFin.get(key)!;
    e.total += Number(t.valor);
    e.count++;
    if (t.vencimento && t.vencimento < hoje) e.vencidos++;
  }
  const summary = Array.from(byFin.values()).sort((a, b) => b.total - a.total);
  const totalAberto = summary.reduce((s, e) => s + e.total, 0);

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'aberto',    label: 'Em aberto'  },
    { key: 'pago',      label: 'Pagos'      },
    { key: 'devolvido', label: 'Devolvidos' },
    { key: 'protestado',label: 'Protestados'},
    { key: 'todos',     label: 'Todos'      },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Relatório Financeira</h1>
        <p className="text-sm text-slate-500">Visão consolidada de títulos por financeira.</p>
      </div>

      {/* Cards de resumo por financeira */}
      {summary.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {summary.map((e) => (
            <Card key={e.nome}>
              <CardBody>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{e.nome}</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{fmtBRL(e.total)}</div>
                <div className="mt-1 flex gap-3 text-xs text-slate-500">
                  <span>{e.count} título{e.count !== 1 ? 's' : ''}</span>
                  {e.vencidos > 0 && (
                    <span className="font-medium text-red-600">{e.vencidos} vencido{e.vencidos !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
          {summary.length > 1 && (
            <Card>
              <CardBody>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Total geral</div>
                <div className="mt-1 text-xl font-bold text-brand-700">{fmtBRL(totalAberto)}</div>
                <div className="mt-1 text-xs text-slate-500">em aberto</div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* Tabs de status */}
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {t.label}
            {t.key !== 'todos' && (
              <span className="ml-1.5 text-slate-400">
                ({titulos.filter((x) => x.status === t.key).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : displayed.length === 0 ? (
        <Card><CardBody>
          <p className="text-sm text-slate-500">Nenhum título {tab !== 'todos' ? `com status "${tab}"` : ''}.</p>
          {tab === 'aberto' && titulos.length === 0 && (
            <p className="mt-2 text-xs text-slate-400">
              Use o chat EGP para registrar: <em>"pedido X ficou na financeira Y"</em>
            </p>
          )}
        </CardBody></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Financeira</th>
                  <th className="px-5 py-3">NF / Título</th>
                  <th className="px-5 py-3">Entrada</th>
                  <th className="px-5 py-3">Vencimento</th>
                  <th className="px-5 py-3 text-right">Valor</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((t) => {
                  const st = STATUS_MAP[t.status] ?? STATUS_MAP.aberto;
                  const vencido = t.status === 'aberto' && t.vencimento && t.vencimento < hoje;
                  return (
                    <tr key={t.id} className={cn('border-b border-slate-100 last:border-0', vencido && 'bg-red-50')}>
                      <td className="px-5 py-3 font-medium text-slate-900">{t.client_name}</td>
                      <td className="px-5 py-3 text-slate-600">{t.financeira?.nome ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-500 text-xs">
                        {t.numero_nfe && <div>NF {t.numero_nfe}</div>}
                        {t.numero_titulo && <div>Título {t.numero_titulo}</div>}
                        {t.numero_venda && <div>Venda #{t.numero_venda}</div>}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{fmtDate(t.data_entrada)}</td>
                      <td className={cn('px-5 py-3', vencido ? 'font-medium text-red-600' : 'text-slate-500')}>
                        {fmtDate(t.vencimento)}
                        {vencido && ' ⚠'}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-slate-900">{fmtBRL(Number(t.valor))}</td>
                      <td className="px-5 py-3">
                        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', st.cls)}>
                          {st.label}
                        </span>
                        {t.data_pagamento && (
                          <div className="mt-0.5 text-[10px] text-slate-400">em {fmtDate(t.data_pagamento)}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
