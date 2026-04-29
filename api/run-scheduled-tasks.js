// Endpoint chamado pelo cron externo (cron-job.org) a cada 15-30 min.
// Verifica quais tarefas devem rodar agora e executa o agente EGP para cada uma.
// Usa tool calling real para buscar dados do banco — sem alucinações.

import { createClient } from '@supabase/supabase-js';

const BRAZIL_OFFSET_HOURS = -3;

function getBrazilNow() {
  const utc = new Date();
  const brt = new Date(utc.getTime() + BRAZIL_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    date: brt,
    dayOfWeek: brt.getUTCDay(),
    timeStr: brt.toISOString().slice(11, 16),
  };
}

function supabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('VITE_SUPABASE_URL não configurada');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ── Ferramentas de leitura disponíveis para tarefas agendadas ─────────────────

const TOOL_DECLARATIONS = [
  {
    name: 'list_shipments',
    description: 'Lista pedidos de saída. Filtros opcionais: status (pending/shipped/returned/cancelled), client_name, limit.',
    parameters: {
      type: 'OBJECT',
      properties: {
        status:      { type: 'STRING' },
        client_name: { type: 'STRING' },
        limit:       { type: 'NUMBER' },
      },
    },
  },
  {
    name: 'list_late_shipments',
    description: 'Lista pedidos pendentes com data prevista anterior a hoje (atrasados).',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_stock_alerts',
    description: 'Lista itens de estoque com saldo negativo, zerado ou abaixo do mínimo configurado.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_stock_needs',
    description: 'Cruza estoque atual com pedidos pendentes e retorna o que precisa ser comprado.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_overdue_titles',
    description: 'Lista títulos/duplicatas com vencimento anterior a hoje ainda em aberto.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_purchase_needs',
    description: 'Lista itens registrados como faltando para os pedidos (módulo Falta Comprar).',
    parameters: {
      type: 'OBJECT',
      properties: {
        status: { type: 'STRING', description: 'pendente | pedido | chegou. Omitir = pendente+pedido.' },
      },
    },
  },
  {
    name: 'get_summary',
    description: 'Retorna um resumo rápido: total de pedidos por status, títulos em aberto, alertas de estoque.',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

async function executeTool(name, args, supabase) {
  const today = new Date().toISOString().slice(0, 10);

  switch (name) {
    case 'list_shipments': {
      let q = supabase
        .from('shipments')
        .select('id, client_name, numero_nfe, numero_venda, status, data_prevista, valor_total')
        .order('created_at', { ascending: false })
        .limit(Number(args.limit ?? 30));
      if (args.status) q = q.eq('status', args.status);
      if (args.client_name) q = q.ilike('client_name', `%${args.client_name}%`);
      const { data } = await q;
      return { shipments: data ?? [] };
    }

    case 'list_late_shipments': {
      const { data } = await supabase
        .from('shipments')
        .select('id, client_name, numero_venda, numero_nfe, data_prevista, valor_total')
        .eq('status', 'pending')
        .lt('data_prevista', today)
        .not('data_prevista', 'is', null)
        .order('data_prevista', { ascending: true });
      return { late_count: (data ?? []).length, shipments: data ?? [] };
    }

    case 'get_stock_alerts': {
      const { data } = await supabase
        .from('stock_items')
        .select('item_code, item_name, quantity, reserved_quantity, min_quantity, unit');
      const alerts = (data ?? []).filter(s => {
        const avail = Number(s.quantity) - Number(s.reserved_quantity);
        return avail < 0 || Number(s.quantity) === 0 || (Number(s.min_quantity) > 0 && avail < Number(s.min_quantity));
      }).map(s => ({
        item_code: s.item_code,
        item_name: s.item_name,
        available: Number(s.quantity) - Number(s.reserved_quantity),
        min_quantity: Number(s.min_quantity),
        unit: s.unit,
      }));
      return { count: alerts.length, alerts };
    }

    case 'get_stock_needs': {
      const { data: stockItems } = await supabase
        .from('stock_items')
        .select('item_code, quantity, reserved_quantity, unit');
      const { data: pendingItems } = await supabase
        .from('shipment_items')
        .select('item_code, item_name, quantity, shipment:shipments!inner(client_name, numero_venda, status)')
        .eq('shipments.status', 'pending');

      const stockMap = {};
      for (const s of stockItems ?? []) {
        stockMap[s.item_code] = { avail: Number(s.quantity) - Number(s.reserved_quantity), unit: s.unit };
      }
      const needsMap = {};
      for (const it of pendingItems ?? []) {
        const code = (it.item_code ?? it.item_name ?? '').toUpperCase();
        if (!needsMap[code]) needsMap[code] = { item_name: it.item_name ?? code, needed: 0 };
        needsMap[code].needed += Number(it.quantity ?? 1);
      }
      const needs = Object.entries(needsMap).map(([code, n]) => {
        const avail = stockMap[code]?.avail ?? 0;
        return { item_code: code, item_name: n.item_name, needed: n.needed, available: avail, to_buy: Math.max(0, n.needed - avail) };
      }).filter(n => n.to_buy > 0);
      return { items_to_buy: needs.length, needs };
    }

    case 'list_overdue_titles': {
      const { data } = await supabase
        .from('titulos')
        .select('client_name, valor, vencimento, financeira:financeiras(nome)')
        .eq('status', 'aberto')
        .lt('vencimento', today)
        .not('vencimento', 'is', null)
        .order('vencimento', { ascending: true });
      const total = (data ?? []).reduce((s, t) => s + Number(t.valor), 0);
      return { count: (data ?? []).length, total_value: total, titles: data ?? [] };
    }

    case 'list_purchase_needs': {
      const status = args.status ?? null;
      let q = supabase
        .from('purchase_needs')
        .select('item_name, quantity, unit, status, shipment:shipments(client_name, numero_venda)')
        .order('updated_at', { ascending: false })
        .limit(50);
      if (status) q = q.eq('status', status);
      else q = q.in('status', ['pendente', 'pedido']);
      const { data } = await q;
      return { count: (data ?? []).length, needs: data ?? [] };
    }

    case 'get_summary': {
      const [shipmentsRes, titlesRes, stockRes] = await Promise.all([
        supabase.from('shipments').select('status'),
        supabase.from('titulos').select('status, valor').eq('status', 'aberto'),
        supabase.from('stock_items').select('quantity, reserved_quantity, min_quantity'),
      ]);
      const byStatus = { pending: 0, shipped: 0, returned: 0, cancelled: 0 };
      for (const s of shipmentsRes.data ?? []) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
      const lateRes = await supabase.from('shipments').select('id').eq('status', 'pending').lt('data_prevista', today).not('data_prevista', 'is', null);
      const titlesTotal = (titlesRes.data ?? []).reduce((s, t) => s + Number(t.valor), 0);
      const stockAlerts = (stockRes.data ?? []).filter(s => {
        const avail = Number(s.quantity) - Number(s.reserved_quantity);
        return avail < 0 || (Number(s.min_quantity) > 0 && avail < Number(s.min_quantity));
      }).length;
      return {
        shipments: byStatus,
        late_shipments: (lateRes.data ?? []).length,
        open_titles_count: (titlesRes.data ?? []).length,
        open_titles_total: titlesTotal,
        stock_alerts: stockAlerts,
      };
    }

    default:
      return { error: `Ferramenta desconhecida: ${name}` };
  }
}

async function callAgentAPI(instruction, supabase) {
  const apiKey = process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY não configurada');

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = `Você é o EGP, IA interna da EGP Tecnologia. Hoje é ${new Date().toLocaleDateString('pt-BR')}.
Use as ferramentas disponíveis para buscar os dados reais do sistema e então retorne um resumo claro.
Formato: markdown simples, máximo 10 linhas. Use bullets para listas. Seja direto — comece pelo resultado.
NUNCA invente dados. Se a ferramenta retornar lista vazia, diga que não há itens.
NUNCA mencione nomes de ferramentas, parâmetros ou detalhes técnicos no resumo final.`;

  const contents = [{ role: 'user', parts: [{ text: instruction }] }];
  const MAX_STEPS = 8;

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        temperature: 0.1,
      },
    });

    const calls = response.functionCalls ?? [];

    // Sem tool calls — resposta final
    if (!calls.length) {
      return response.text ?? '(sem resposta)';
    }

    // Adiciona a resposta do modelo ao histórico
    const modelParts = calls.map(c => ({ functionCall: { name: c.name, args: c.args ?? {} } }));
    contents.push({ role: 'model', parts: modelParts });

    // Executa todas as tool calls e adiciona respostas
    const responseParts = await Promise.all(
      calls.map(async (call) => {
        const result = await executeTool(call.name, call.args ?? {}, supabase);
        return {
          functionResponse: {
            name: call.name,
            response: result,
          },
        };
      })
    );
    contents.push({ role: 'user', parts: responseParts });
  }

  return '(limite de passos atingido)';
}

export default async function handler(req, res) {
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
    if (diff > 5 && diff < 1440 - 5) return false;
    if (t.days_of_week && !t.days_of_week.includes(dayOfWeek)) return false;
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
      result = await callAgentAPI(task.instruction, supabase);
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
