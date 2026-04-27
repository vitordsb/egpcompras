import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';

interface UsageRow {
  id: string;
  created_at: string;
  model: string;
  prompt_tokens: number;
  response_tokens: number;
  total_tokens: number;
  tool_calls_count: number;
  api_requests_count: number;
  duration_ms: number | null;
  user_message: string | null;
}

interface PeriodSummary {
  calls: number;        // chamadas do agente (mensagens do usuário)
  apiRequests: number;  // requests reais à API (cada chamada faz N)
  tokens: number;
  promptTokens: number;
  responseTokens: number;
}

const ZERO: PeriodSummary = {
  calls: 0,
  apiRequests: 0,
  tokens: 0,
  promptTokens: 0,
  responseTokens: 0,
};

// Limites do PAID TIER (tier 1) do Gemini 2.5 Flash. Aplicáveis quando o projeto
// tem billing ativado, mesmo pagando com créditos de teste do Google Cloud.
// Referência: ai.google.dev/gemini-api/docs/rate-limits — tier 1.
// Quando subir pra tier 2/3, ou voltar pra free, ajustar essas constantes.
const RPM_LIMIT = 2_000;       // requests/minuto
const TPM_LIMIT = 4_000_000;   // tokens/minuto
const TPD_LIMIT = 100_000_000; // tokens/dia (estimativa segura — não há cap rígido publicado)

function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function summarize(sinceIso: string | null): Promise<PeriodSummary> {
  let query = supabase
    .from('ai_usage')
    .select('prompt_tokens, response_tokens, total_tokens, api_requests_count', {
      count: 'exact',
    });
  if (sinceIso) query = query.gte('created_at', sinceIso);
  const { data, count } = await query;
  if (!data) return { ...ZERO, calls: count ?? 0 };
  const sum = data.reduce(
    (acc: PeriodSummary, r: any) => ({
      calls: acc.calls,
      apiRequests: acc.apiRequests + Number(r.api_requests_count ?? 0),
      promptTokens: acc.promptTokens + Number(r.prompt_tokens ?? 0),
      responseTokens: acc.responseTokens + Number(r.response_tokens ?? 0),
      tokens: acc.tokens + Number(r.total_tokens ?? 0),
    }),
    { ...ZERO }
  );
  return { ...sum, calls: count ?? data.length };
}

export default function AiUsagePage() {
  const [lastMin, setLastMin] = useState<PeriodSummary>(ZERO);
  const [today, setToday] = useState<PeriodSummary>(ZERO);
  const [last7, setLast7] = useState<PeriodSummary>(ZERO);
  const [last30, setLast30] = useState<PeriodSummary>(ZERO);
  const [allTime, setAllTime] = useState<PeriodSummary>(ZERO);
  const [recent, setRecent] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const oneMinAgo = new Date(Date.now() - 60 * 1000);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOf7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const startOf30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [m, t, w, mo, total, recentRes] = await Promise.all([
        summarize(oneMinAgo.toISOString()),
        summarize(startOfToday.toISOString()),
        summarize(startOf7.toISOString()),
        summarize(startOf30.toISOString()),
        summarize(null),
        supabase
          .from('ai_usage')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      setLastMin(m);
      setToday(t);
      setLast7(w);
      setLast30(mo);
      setAllTime(total);
      if (recentRes.error) throw new Error(recentRes.error.message);
      setRecent((recentRes.data ?? []) as UsageRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar uso.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rpmPct = Math.min(100, (lastMin.apiRequests / RPM_LIMIT) * 100);
  const tpmPct = Math.min(100, (lastMin.tokens / TPM_LIMIT) * 100);
  const tpdPct = Math.min(100, (today.tokens / TPD_LIMIT) * 100);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Consumo IA</h1>
          <p className="text-sm text-slate-500">
            Tokens e requests da API Gemini consumidos pelo assistente Comprador.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          atualizar
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : (
        <>
          {/* Limites — paid tier ativo */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Limites · Gemini 2.5 Flash (paid tier)</CardTitle>
            </CardHeader>
            <CardBody className="space-y-5">
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <strong>✓ Paid tier ativo</strong> — você ativou billing no Google Cloud (créditos
                de teste ou cartão). O cap de 20 requests/dia que existia no free tier não vale
                mais. Limites abaixo são do <strong>tier 1</strong>; sobem automaticamente
                conforme o projeto madura.
              </div>
              <LimitGauge
                label="Requests por minuto (RPM)"
                hint="Cada mensagem sua faz N requests à API (uma por rodada de tool calls). No paid tier 1, limite muito alto."
                current={lastMin.apiRequests}
                limit={RPM_LIMIT}
                pct={rpmPct}
                window="último minuto"
              />
              <LimitGauge
                label="Tokens por minuto (TPM)"
                hint="Soma de prompt + resposta enviados/recebidos no último minuto."
                current={lastMin.tokens}
                limit={TPM_LIMIT}
                pct={tpmPct}
                window="último minuto"
              />
              <LimitGauge
                label="Tokens hoje (TPD)"
                hint="Não há cap rígido por dia no paid tier — o que vale é o orçamento do billing. Acompanhe custo no Google Cloud Console → Billing."
                current={today.tokens}
                limit={TPD_LIMIT}
                pct={tpdPct}
                window="hoje"
              />
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <strong>Atenção aos créditos de teste:</strong> os $300 do Google Cloud têm validade
                de 90 dias. Configure um alerta de billing em{' '}
                <a
                  href="https://console.cloud.google.com/billing/budgets"
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-600 underline"
                >
                  console.cloud.google.com/billing/budgets
                </a>{' '}
                pra não levar susto quando expirarem.
              </div>
            </CardBody>
          </Card>

          {/* Cards de período */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard title="Hoje" period={today} highlight />
            <SummaryCard title="Últimos 7 dias" period={last7} />
            <SummaryCard title="Últimos 30 dias" period={last30} />
            <SummaryCard title="Total acumulado" period={allTime} />
          </div>

          {/* Histórico */}
          <Card>
            <CardHeader>
              <CardTitle>Últimas {recent.length} chamadas</CardTitle>
            </CardHeader>
            {recent.length === 0 ? (
              <CardBody>
                <p className="text-sm text-slate-600">
                  Nenhuma chamada registrada ainda. Use o assistente Comprador pra começar.
                </p>
              </CardBody>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Quando</th>
                      <th className="px-5 py-3">Pergunta</th>
                      <th className="px-5 py-3 text-right">Reqs</th>
                      <th className="px-5 py-3 text-right">Prompt</th>
                      <th className="px-5 py-3 text-right">Resposta</th>
                      <th className="px-5 py-3 text-right">Total</th>
                      <th className="px-5 py-3 text-right">Tools</th>
                      <th className="px-5 py-3 text-right">Duração</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-5 py-3 text-slate-600 whitespace-nowrap">
                          {new Date(r.created_at).toLocaleString('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-5 py-3 text-slate-700 max-w-xs truncate">
                          {r.user_message ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-slate-900">
                          {r.api_requests_count || 0}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-600">
                          {formatNumber(r.prompt_tokens)}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-600">
                          {formatNumber(r.response_tokens)}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-700">
                          {formatNumber(r.total_tokens)}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-600">
                          {r.tool_calls_count}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-500 whitespace-nowrap">
                          {formatDuration(r.duration_ms)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function LimitGauge({
  label,
  hint,
  current,
  limit,
  pct,
  window,
}: {
  label: string;
  hint: string;
  current: number;
  limit: number;
  pct: number;
  window: string;
}) {
  const color = pct < 70 ? 'bg-emerald-500' : pct < 90 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className="text-xs text-slate-500">
          <strong className="text-slate-700">{formatNumber(current)}</strong> /{' '}
          {formatNumber(limit)}
          <span className="ml-2 text-slate-400">({pct.toFixed(1)}%)</span>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full transition-all ${color}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {hint} <span className="text-slate-400">· janela: {window}</span>
      </p>
    </div>
  );
}

function SummaryCard({
  title,
  period,
  highlight,
}: {
  title: string;
  period: PeriodSummary;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      <div
        className={`mt-1 text-2xl font-semibold ${
          highlight ? 'text-brand-700' : 'text-slate-900'
        }`}
      >
        {formatNumber(period.tokens)}
      </div>
      <div className="text-xs text-slate-500">
        tokens · {period.calls} chamada(s) · {period.apiRequests} reqs
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-slate-400">
        <span>↑ {formatNumber(period.promptTokens)}</span>
        <span>↓ {formatNumber(period.responseTokens)}</span>
      </div>
    </div>
  );
}
