import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { isLate } from '@/routes/admin/expedicao/shared';
import MarkdownText from '@/components/MarkdownText';
import type { ShipmentStatus } from '@/types/db';

interface TaskRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  result: string | null;
  task: { name: string } | null;
}

interface LateShipment {
  id: string;
  client_name: string;
  numero_venda: string | null;
  numero_nfe: string | null;
  data_prevista: string;
  valor_total: number | null;
}

interface MemoryHealth {
  count: number;
  level: 'ok' | 'warning' | 'critical';
}

interface WhatsAppConv {
  phone: string;
  updated_at: string;
  lastMsg: string;
}

interface CriticalStock {
  item_code: string;
  item_name: string;
  quantity: number;
  reserved_quantity: number;
  min_quantity: number;
  unit: string;
}

interface OverdueTitle {
  id: string;
  client_name: string;
  valor: number;
  vencimento: string;
  numero_nfe: string | null;
  financeira: { nome: string } | null;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function daysLate(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso + 'T00:00:00');
  return Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function fmtPhone(p: string) {
  const d = p.replace(/\D/g, '');
  if (d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return p;
}

export default function BriefingPage() {
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [lateShipments, setLateShipments] = useState<LateShipment[]>([]);
  const [overdueTitles, setOverdueTitles] = useState<OverdueTitle[]>([]);
  const [memoryHealth, setMemoryHealth] = useState<MemoryHealth | null>(null);
  const [whatsappConvs, setWhatsappConvs] = useState<WhatsAppConv[]>([]);
  const [criticalStock, setCriticalStock] = useState<CriticalStock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const today = new Date().toISOString().slice(0, 10);

      const [runsRes, shipmentsRes, titlesRes, memoriesRes, waRes, stockRes] = await Promise.all([
        supabase
          .from('scheduled_task_runs')
          .select('id, started_at, completed_at, status, result, task:scheduled_tasks(name)')
          .gte('started_at', since24h)
          .order('started_at', { ascending: false })
          .limit(20),

        supabase
          .from('shipments')
          .select('id, client_name, numero_venda, numero_nfe, data_prevista, valor_total, status')
          .eq('status', 'pending' as ShipmentStatus)
          .lt('data_prevista', today)
          .not('data_prevista', 'is', null)
          .order('data_prevista', { ascending: true })
          .limit(20),

        supabase
          .from('titulos')
          .select('id, client_name, valor, vencimento, numero_nfe, financeira:financeiras(nome)')
          .eq('status', 'aberto')
          .lt('vencimento', today)
          .not('vencimento', 'is', null)
          .order('vencimento', { ascending: true })
          .limit(20),

        supabase.from('agent_memories').select('id', { count: 'exact', head: true }),

        // WhatsApp — conversas das últimas 48h
        supabase
          .from('whatsapp_sessions')
          .select('phone, updated_at')
          .gte('updated_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
          .order('updated_at', { ascending: false })
          .limit(5),

        // Estoque crítico — abaixo do mínimo
        supabase
          .from('stock_items')
          .select('item_code, item_name, quantity, reserved_quantity, min_quantity, unit')
          .gt('min_quantity', 0)
          .limit(50),
      ]);

      setRuns((runsRes.data ?? []) as unknown as TaskRun[]);
      setLateShipments((shipmentsRes.data ?? []).filter((s: any) => isLate(s)) as LateShipment[]);
      setOverdueTitles((titlesRes.data ?? []) as unknown as OverdueTitle[]);
      const memCount = memoriesRes.count ?? 0;
      setMemoryHealth({
        count: memCount,
        level: memCount >= 80 ? 'critical' : memCount >= 50 ? 'warning' : 'ok',
      });

      // WhatsApp — busca última mensagem de cada conversa
      const sessions = (waRes.data ?? []) as any[];
      const convs: WhatsAppConv[] = await Promise.all(
        sessions.map(async (s) => {
          const { data: msgs } = await supabase
            .from('whatsapp_messages')
            .select('text, direction')
            .eq('phone', s.phone)
            .order('created_at', { ascending: false })
            .limit(1);
          const last = msgs?.[0] as any;
          return {
            phone: s.phone,
            updated_at: s.updated_at,
            lastMsg: last ? `${last.direction === 'in' ? '👤 ' : '🤖 '}${last.text?.slice(0, 70)}` : '',
          };
        })
      );
      setWhatsappConvs(convs);

      // Estoque crítico
      const stockItems = (stockRes.data ?? []) as CriticalStock[];
      setCriticalStock(
        stockItems
          .filter((s) => (Number(s.quantity) - Number(s.reserved_quantity)) <= Number(s.min_quantity))
          .sort((a, b) => (Number(a.quantity) - Number(a.reserved_quantity)) - (Number(b.quantity) - Number(b.reserved_quantity)))
          .slice(0, 10)
      );

      setLoading(false);
    }
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  const allClear = !loading && runs.length === 0 && lateShipments.length === 0 && overdueTitles.length === 0 && criticalStock.length === 0;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">{greeting()}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {loading && (
        <p className="text-sm text-slate-500">Carregando…</p>
      )}

      {allClear && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
          Tudo em dia — nenhuma tarefa rodou nas últimas 24h, nenhum pedido atrasado e nenhum título vencido.
        </div>
      )}

      {!loading && (
        <div className="space-y-8">

          {/* ---- IA: o que aconteceu ---- */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                IA — últimas 24h
              </h2>
              <Link to="/admin/tarefas" className="text-xs text-brand-600 hover:underline">
                ver todas
              </Link>
            </div>

            {runs.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhuma tarefa executou nas últimas 24h.</p>
            ) : (
              <div className="space-y-3">
                {runs.map((r) => (
                  <div
                    key={r.id}
                    className={cn(
                      'rounded-lg border bg-white',
                      r.status === 'error' ? 'border-red-200' : 'border-slate-200'
                    )}
                  >
                    {/* Cabeçalho da tarefa */}
                    <div className={cn(
                      'flex items-center justify-between gap-3 rounded-t-lg px-4 py-2.5',
                      r.status === 'error' ? 'bg-red-50' : 'bg-slate-50',
                      'border-b',
                      r.status === 'error' ? 'border-red-100' : 'border-slate-100'
                    )}>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          r.status === 'ok' ? 'bg-emerald-500' : r.status === 'error' ? 'bg-red-500' : 'bg-slate-300'
                        )} />
                        <span className="text-sm font-semibold text-slate-900">
                          {(r.task as any)?.name ?? 'Tarefa'}
                        </span>
                        {r.status === 'error' && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600">
                            erro
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">
                        {fmtDate(r.started_at)} às {fmtTime(r.started_at)}
                      </span>
                    </div>

                    {/* Resultado renderizado como markdown */}
                    {r.result && (
                      <div className="px-4 py-3 text-sm text-slate-700 [&_ul]:mt-1 [&_ul]:space-y-0.5 [&_li]:text-sm [&_strong]:font-semibold [&_strong]:text-slate-900">
                        <MarkdownText text={r.result} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ---- Pedidos atrasados ---- */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Pedidos atrasados
                {lateShipments.length > 0 && (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    {lateShipments.length}
                  </span>
                )}
              </h2>
              <Link to="/admin/expedicao/pedidos" className="text-xs text-brand-600 hover:underline">
                ver pedidos
              </Link>
            </div>

            {lateShipments.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum pedido atrasado.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Cliente</th>
                      <th className="px-4 py-2.5">Venda / NFe</th>
                      <th className="px-4 py-2.5">Prevista</th>
                      <th className="px-4 py-2.5">Atraso</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lateShipments.map((s) => {
                      const days = daysLate(s.data_prevista);
                      return (
                        <tr key={s.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-2.5 font-medium text-slate-900">{s.client_name}</td>
                          <td className="px-4 py-2.5 text-slate-500">
                            {s.numero_venda ? `#${s.numero_venda}` : ''}
                            {s.numero_venda && s.numero_nfe ? ' · ' : ''}
                            {s.numero_nfe ? `NF ${s.numero_nfe}` : ''}
                            {!s.numero_venda && !s.numero_nfe ? '—' : ''}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{fmtDate(s.data_prevista)}</td>
                          <td className="px-4 py-2.5">
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              {days === 1 ? '1 dia' : `${days} dias`}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-600">
                            {s.valor_total != null ? fmtMoney(Number(s.valor_total)) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ---- Títulos vencidos ---- */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Títulos vencidos
                {overdueTitles.length > 0 && (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    {overdueTitles.length}
                  </span>
                )}
              </h2>
              <Link to="/admin/financeira/com-nota" className="text-xs text-brand-600 hover:underline">
                ver financeira
              </Link>
            </div>

            {overdueTitles.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum título vencido em aberto.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Cliente</th>
                      <th className="px-4 py-2.5">Financeira</th>
                      <th className="px-4 py-2.5">Vencimento</th>
                      <th className="px-4 py-2.5">Atraso</th>
                      <th className="px-4 py-2.5 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueTitles.map((t) => {
                      const days = daysLate(t.vencimento);
                      return (
                        <tr key={t.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-2.5 font-medium text-slate-900">{t.client_name}</td>
                          <td className="px-4 py-2.5 text-slate-500">
                            {(t.financeira as any)?.nome ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{fmtDate(t.vencimento)}</td>
                          <td className="px-4 py-2.5">
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              {days === 1 ? '1 dia' : `${days} dias`}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                            {fmtMoney(Number(t.valor))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ---- WhatsApp ---- */}
          {whatsappConvs.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  WhatsApp — últimas 48h
                  <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    {whatsappConvs.length}
                  </span>
                </h2>
                <Link to="/admin/whatsapp" className="text-xs text-brand-600 hover:underline">
                  ver conversas
                </Link>
              </div>
              <div className="space-y-2">
                {whatsappConvs.map((c) => (
                  <Link
                    key={c.phone}
                    to="/admin/whatsapp"
                    className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-sm">
                      💬
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">{fmtPhone(c.phone)}</span>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {new Date(c.updated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {c.lastMsg && <p className="mt-0.5 truncate text-xs text-slate-500">{c.lastMsg}</p>}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ---- Estoque crítico ---- */}
          {criticalStock.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Estoque crítico
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {criticalStock.length}
                  </span>
                </h2>
                <Link to="/admin/estoque" className="text-xs text-brand-600 hover:underline">
                  ver estoque
                </Link>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Item</th>
                      <th className="px-4 py-2.5 text-right">Disponível</th>
                      <th className="px-4 py-2.5 text-right">Mínimo</th>
                      <th className="px-4 py-2.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criticalStock.map((s) => {
                      const avail = Number(s.quantity) - Number(s.reserved_quantity);
                      const negative = avail < 0;
                      return (
                        <tr key={s.item_code} className={cn('border-b border-slate-100 last:border-0', negative && 'bg-red-50/40')}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-slate-900">{s.item_name}</div>
                            <div className="font-mono text-[11px] text-slate-400">{s.item_code}</div>
                          </td>
                          <td className={cn('px-4 py-2.5 text-right font-semibold tabular-nums', negative ? 'text-red-700' : 'text-amber-700')}>
                            {avail} {s.unit}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                            {Number(s.min_quantity)} {s.unit}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', negative ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
                              {negative ? 'Negativo' : 'Abaixo do mín.'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Saúde do sistema — só aparece quando há algo a dizer */}
          {memoryHealth && memoryHealth.level !== 'ok' && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Saúde do sistema
              </h2>
              {memoryHealth.level === 'critical' ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <strong>⚠ Memórias: hora de migrar para busca vetorial</strong>
                  <p className="mt-1 text-red-700">
                    {memoryHealth.count} memórias (~{Math.round(memoryHealth.count * 75).toLocaleString('pt-BR')} tokens por chamada).
                    Acima de 80 entradas a qualidade começa a cair. Peça ao Vex para implementar RAG com pgvector.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <strong>Memórias crescendo</strong> — {memoryHealth.count} entradas (~{Math.round(memoryHealth.count * 75).toLocaleString('pt-BR')} tokens/chamada).
                  Ainda OK, mas fique de olho. Acima de 80 vale migrar para busca vetorial.
                </div>
              )}
            </section>
          )}

        </div>
      )}
    </div>
  );
}
