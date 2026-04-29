// Endpoint chamado pelo cron externo (cron-job.org) a cada 15-30 min.
// Verifica quais tarefas devem rodar agora e executa o agente EGP para cada uma.
//
// Segurança: requer header Authorization: Bearer <CRON_SECRET> para evitar
// execuções não autorizadas. Configure CRON_SECRET nos env vars do Vercel.

import { createClient } from '@supabase/supabase-js';

const BRAZIL_OFFSET_HOURS = -3;

function getBrazilNow() {
  const utc = new Date();
  const brt = new Date(utc.getTime() + BRAZIL_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    date: brt,
    dayOfWeek: brt.getUTCDay(),           // 0=dom … 6=sáb
    timeStr: brt.toISOString().slice(11, 16), // "HH:MM" UTC-adjusted
  };
}

function supabaseAdmin() {
  // Usa VITE_SUPABASE_URL diretamente — evita conflito com variáveis internas do Vercel
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('VITE_SUPABASE_URL não configurada');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function callAgentAPI(instruction) {
  // Chama o agente EGP via API interna — reutiliza a mesma lógica do frontend.
  // Em produção, o agente precisa da VITE_GEMINI_API_KEY disponível no servidor.
  // Como Vite não injeta vars no servidor, usamos GEMINI_API_KEY diretamente.
  const apiKey = process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  // Importa as tools e o executor
  // Nota: como estamos no servidor, importamos o supabase com service role
  const supabase = supabaseAdmin();

  // System instruction para tarefas agendadas
  const systemInstruction = `Você é o EGP, IA interna da EGP Tecnologia. Hoje é ${new Date().toLocaleDateString('pt-BR')}.

Execute a tarefa abaixo e retorne APENAS um resumo humano do resultado — nunca mencione nomes de ferramentas, chamadas de API, parâmetros técnicos ou detalhes de execução interna.

Formato esperado: markdown simples, máximo 10 linhas. Use bullets quando listar itens. Seja direto: comece pelo resultado, não pelo processo. Exemplo correto: "3 pedidos pendentes: SYVAL (#5814), TELEVES (#5799), VORTEX (#5553). Todos com saída atrasada." Exemplo errado: "Chamei a ferramenta list_shipments com status=pending e obtive 3 resultados..."`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: instruction }] }],
    config: { systemInstruction, temperature: 0.1 },
  });

  return response.text ?? '(sem resposta)';
}

export default async function handler(req, res) {
  // Verificação de segurança
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let supabase;
  try {
    supabase = supabaseAdmin();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const { dayOfWeek, timeStr } = getBrazilNow();

  // Busca tarefas habilitadas cuja schedule_time bate com o horário atual (±5 min de janela)
  const [hh, mm] = timeStr.split(':').map(Number);
  const minuteOfDay = hh * 60 + mm;

  const { data: tasks, error: fetchErr } = await supabase
    .from('scheduled_tasks')
    .select('*')
    .eq('enabled', true);

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const due = (tasks ?? []).filter((t) => {
    const [th, tm] = t.schedule_time.split(':').map(Number);
    const taskMinute = th * 60 + tm;
    const diff = Math.abs(minuteOfDay - taskMinute);
    if (diff > 5 && diff < 1440 - 5) return false; // fora da janela de ±5 min
    if (t.days_of_week && !t.days_of_week.includes(dayOfWeek)) return false;
    // Evita rodar duas vezes: última execução deve ter sido há mais de 30 min
    if (t.last_run_at) {
      const lastRun = new Date(t.last_run_at);
      if (Date.now() - lastRun.getTime() < 30 * 60 * 1000) return false;
    }
    return true;
  });

  const results = [];
  for (const task of due) {
    const { data: run } = await supabase
      .from('scheduled_task_runs')
      .insert({ task_id: task.id })
      .select('id')
      .single();

    const runId = run?.id;
    let result = '';
    let status = 'ok';

    try {
      result = await callAgentAPI(task.instruction);
    } catch (err) {
      result = `Erro: ${err instanceof Error ? err.message : String(err)}`;
      status = 'error';
    }

    const now = new Date().toISOString();
    if (runId) {
      await supabase.from('scheduled_task_runs').update({ completed_at: now, result, status }).eq('id', runId);
    }
    await supabase.from('scheduled_tasks').update({ last_run_at: now, last_result: result, last_status: status, updated_at: now }).eq('id', task.id);
    results.push({ task: task.name, status, result: result.slice(0, 200) });
  }

  return res.status(200).json({ checked: (tasks ?? []).length, executed: due.length, results });
}
