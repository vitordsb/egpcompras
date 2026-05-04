const VERIFY_TOKEN   = Deno.env.get('WA_VERIFY_TOKEN') ?? '';
const WA_APP_SECRET  = Deno.env.get('WA_APP_SECRET')   ?? '';
const WA_TOKEN       = Deno.env.get('WA_TOKEN')        ?? '';
const WA_PHONE_ID    = Deno.env.get('WA_PHONE_ID')     ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')  ?? '';
const SUPA_URL       = Deno.env.get('SUPABASE_URL')    ?? '';
const SUPA_JWT       = Deno.env.get('SUPA_SERVICE_JWT') ?? '';

const supaHeaders = {
  'apikey': SUPA_JWT,
  'Authorization': `Bearer ${SUPA_JWT}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

// ── Valida assinatura HMAC-SHA256 da Meta ─────────────────────────────────────
async function verifyMetaSignature(rawBody: ArrayBuffer, sig: string): Promise<boolean> {
  if (!WA_APP_SECRET) return true;
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(WA_APP_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const computed = await crypto.subtle.sign('HMAC', key, rawBody);
    const hex = 'sha256=' + Array.from(new Uint8Array(computed))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === sig;
  } catch { return false; }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function dbSelect(table: string, filters: Record<string, string>, extra = ''): Promise<any[]> {
  const params = new URLSearchParams(
    Object.entries(filters).map(([k, v]) => [k, `eq.${v}`])
  );
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?${params}${extra}`, { headers: supaHeaders });
  if (!res.ok) return [];
  return await res.json();
}

async function dbInsert(table: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: 'POST', headers: supaHeaders, body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function dbUpdate(table: string, id: string, body: Record<string, unknown>): Promise<void> {
  if (!id) throw new Error(`dbUpdate(${table}): id vazio — abortando para evitar update em massa`);
  await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH', headers: supaHeaders, body: JSON.stringify(body),
  });
}

// ── Sessão ────────────────────────────────────────────────────────────────────
async function getSession(phone: string): Promise<{ id: string; history: any[]; status: string }> {
  const rows = await dbSelect('whatsapp_sessions', { phone });
  if (rows.length > 0) return { id: rows[0].id, history: rows[0].history ?? [], status: rows[0].status ?? 'active' };
  const created = await dbInsert('whatsapp_sessions', { phone, history: [], status: 'active' });
  if (!created?.id) throw new Error(`getSession: falha ao criar sessão para ${phone}`);
  return { id: created.id, history: [], status: 'active' };
}

async function saveSession(id: string, history: any[]): Promise<void> {
  await dbUpdate('whatsapp_sessions', id, { history, updated_at: new Date().toISOString() });
}

// ── Catálogo (injetado no system prompt) ─────────────────────────────────────
async function buildCatalog(): Promise<string> {
  try {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/products_with_cost?select=name,sale_price_brl,sku,description&order=name`,
      { headers: supaHeaders },
    );
    const products: any[] = res.ok ? await res.json() : [];
    if (!Array.isArray(products) || products.length === 0) return '';
    return '═══ CATÁLOGO ═══\n' + products.map((p: any) => {
      const price = p.sale_price_brl
        ? `R$ ${Number(p.sale_price_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        : 'consultar';
      return `• ${p.name}${p.sku ? ` (${p.sku})` : ''}: ${price}${p.description ? ` — ${p.description}` : ''}`;
    }).join('\n');
  } catch { return ''; }
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────
async function sendWA(to: string, text: string): Promise<void> {
  await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
}

async function logMsg(phone: string, direction: 'in' | 'out', text: string, wamid?: string): Promise<void> {
  await dbInsert('whatsapp_messages', {
    phone, direction, text,
    ...(wamid ? { message_id: wamid } : {}),
  }).catch(() => {});
}

// ── Tools declarations ────────────────────────────────────────────────────────
const TOOL_DECLARATIONS = [
  {
    name: 'find_products',
    description:
      'Busca produtos do catálogo EGP por nome parcial e retorna lista numerada para o cliente escolher. ' +
      'SEMPRE use quando o cliente mencionar algo ambíguo (ex: "12V", "controle", "fonte", "cerca"). ' +
      'Apresente a lista e pergunte qual o cliente deseja antes de prosseguir.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Termo de busca. Ex: "controle", "12V", "eletrificador", "nobreak".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'check_stock',
    description:
      'Consulta o estoque de um produto específico já identificado. ' +
      'SEMPRE chame antes de confirmar disponibilidade. ' +
      'Se estoque for zero, registre o pedido mesmo assim via create_order_intent — nunca diga "sem estoque" ao cliente.',
    parameters: {
      type: 'OBJECT',
      properties: {
        product_name: {
          type: 'STRING',
          description: 'Nome exato ou próximo do produto já confirmado pelo cliente.',
        },
      },
      required: ['product_name'],
    },
  },
  {
    name: 'get_active_promotions',
    description:
      'Retorna promoções vigentes. Chame ao apresentar um produto para ver se há oferta ativa. ' +
      'Mencione a promoção de forma natural dentro da resposta, nunca como abertura.',
    parameters: {
      type: 'OBJECT',
      properties: {
        product_name: {
          type: 'STRING',
          description: 'Nome do produto para filtrar promoções. Omita para retornar todas as promoções ativas.',
        },
      },
    },
  },
  {
    name: 'create_order_intent',
    description:
      'Registra a intenção de compra após coletar nome do cliente, produto(s) e quantidade. ' +
      'Use somente após o cliente confirmar o pedido. Não use para simples consultas de preço.',
    parameters: {
      type: 'OBJECT',
      properties: {
        client_name: { type: 'STRING', description: 'Nome do cliente.' },
        items: {
          type: 'ARRAY',
          description: 'Lista de produtos.',
          items: {
            type: 'OBJECT',
            properties: {
              name:       { type: 'STRING', description: 'Nome do produto.' },
              quantity:   { type: 'NUMBER', description: 'Quantidade.' },
              unit_price: { type: 'NUMBER', description: 'Preço unitário em BRL.' },
            },
            required: ['name', 'quantity'],
          },
        },
        forma_pagamento: { type: 'STRING', description: 'Forma de pagamento. Ex: PIX, boleto, cartão.' },
      },
      required: ['client_name', 'items'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Transfere a conversa para uma vendedora humana. Use quando: ' +
      'cliente pedir para falar com vendedora, dúvida técnica específica de instalação, ' +
      'negociação de preço em volume, ou você não souber responder com certeza.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          description: '"client_requested" | "technical_doubt" | "price_negotiation" | "bot_uncertain"',
        },
      },
      required: ['reason'],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  phone: string,
  sessionId: string,
): Promise<string> {
  try {
    switch (name) {

      case 'find_products': {
        const q = encodeURIComponent(String(args.query ?? ''));
        const res = await fetch(
          `${SUPA_URL}/rest/v1/products_with_cost` +
          `?select=name,sale_price_brl,sku,description` +
          `&name=ilike.*${q}*&order=name&limit=8`,
          { headers: supaHeaders },
        );
        const rows: any[] = res.ok ? await res.json() : [];
        if (rows.length === 0) {
          return JSON.stringify({ found: false, message: `Nenhum produto encontrado para "${args.query}". Peça mais detalhes ao cliente.` });
        }
        const list = rows.map((p: any, i: number) => {
          const price = p.sale_price_brl
            ? `R$ ${Number(p.sale_price_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            : 'consultar';
          return { index: i + 1, name: p.name, sku: p.sku, price, description: p.description };
        });
        return JSON.stringify({ found: true, products: list });
      }

      case 'check_stock': {
        const q = encodeURIComponent(String(args.product_name ?? ''));
        const res = await fetch(
          `${SUPA_URL}/rest/v1/stock_items` +
          `?select=item_name,quantity,reserved_quantity,unit` +
          `&item_name=ilike.*${q}*&order=item_name&limit=5`,
          { headers: supaHeaders },
        );
        const rows: any[] = res.ok ? await res.json() : [];
        if (rows.length === 0) {
          // Produto não encontrado no estoque — ainda assim permite registrar pedido
          return JSON.stringify({ found: false, in_stock: false, product_name: args.product_name });
        }
        const items = rows.map(s => {
          const qty = Number(s.quantity) - Number(s.reserved_quantity);
          return { name: s.item_name, in_stock: qty > 0, quantity: qty, unit: s.unit ?? 'un' };
        });
        return JSON.stringify(items);
      }

      case 'get_active_promotions': {
        const now = new Date().toISOString();
        const productName = String(args.product_name ?? '').trim();
        const base =
          `${SUPA_URL}/rest/v1/promotions` +
          `?select=title,description_for_bot` +
          `&active=eq.true` +
          `&starts_at=lte.${now}` +
          `&ends_at=gte.${now}` +
          `&order=ends_at&limit=5`;
        const url = productName
          ? `${base}&or=(title.ilike.*${encodeURIComponent(productName)}*,sku.ilike.*${encodeURIComponent(productName)}*)`
          : base;
        const res  = await fetch(url, { headers: supaHeaders });
        const rows: any[] = res.ok ? await res.json() : [];
        if (rows.length === 0) return JSON.stringify({ promotions: [], message: 'Sem promoções ativas no momento.' });
        return JSON.stringify({ promotions: rows.map(r => ({ title: r.title, description: r.description_for_bot })) });
      }

      case 'create_order_intent': {
        const clientName = String(args.client_name ?? '').trim();
        const items      = Array.isArray(args.items) ? args.items : [];
        if (!clientName || items.length === 0) {
          return JSON.stringify({ success: false, error: 'client_name e items são obrigatórios' });
        }
        const intent = await dbInsert('order_intents', {
          session_id:      sessionId || null,
          phone,
          client_name:     clientName,
          items:           JSON.stringify(items),
          forma_pagamento: args.forma_pagamento ? String(args.forma_pagamento) : null,
          status:          'pending',
        });
        if (!intent?.id) return JSON.stringify({ success: false, error: 'Falha ao registrar pedido no banco' });
        const summary = items.map((it: any) => `${it.quantity}x ${it.name}`).join(', ');
        return JSON.stringify({
          success:   true,
          intent_id: intent.id,
          message:   `Pedido registrado com sucesso: ${summary} para ${clientName}. Nossa equipe confirmará em breve.`,
        });
      }

      case 'escalate_to_human': {
        // Busca primeira vendedora disponível
        const selRes  = await fetch(
          `${SUPA_URL}/rest/v1/sellers?select=id,name,whatsapp_number&status=eq.available&order=name&limit=1`,
          { headers: supaHeaders },
        );
        const sellers: any[] = selRes.ok ? await selRes.json() : [];
        const seller  = sellers[0] ?? { name: 'nossa equipe', whatsapp_number: null };

        // Marca sessão como handoff
        await dbUpdate('whatsapp_sessions', sessionId, {
          status:               'handoff',
          assigned_agent_phone: seller.whatsapp_number,
          handoff_requested_at: new Date().toISOString(),
        });

        // Notifica vendedora no WhatsApp dela
        if (seller.whatsapp_number) {
          const notify =
            `🔔 *Novo atendimento EGP*\n\n` +
            `Cliente: ${phone}\n` +
            `Motivo: ${args.reason ?? 'solicitado'}\n\n` +
            `Responda diretamente para o número acima.`;
          await sendWA(seller.whatsapp_number, notify).catch(() => {});
        }

        return JSON.stringify({
          success:     true,
          agent_name:  seller.name,
          agent_phone: seller.whatsapp_number,
          message:     `Conversa transferida para ${seller.name}.`,
        });
      }

      default:
        return JSON.stringify({ error: `Tool desconhecida: ${name}` });
    }
  } catch (e) {
    console.error(`executeTool(${name}):`, e);
    return JSON.stringify({ error: String(e) });
  }
}

// ── Gemini com Function Calling ───────────────────────────────────────────────
async function callGemini(
  history: any[],
  userText: string,
  catalog: string,
  phone: string,
  sessionId: string,
): Promise<string> {
  const system = `Você é a *EGP Atendimento*, assistente virtual da EGP Tecnologia — empresa brasileira especializada em equipamentos de segurança eletrônica.

Seu tom é: caloroso, confiante, direto. Como uma vendedora experiente que conhece bem os produtos e quer ajudar de verdade. Não é robótico nem formal demais.

*FORMATAÇÃO WhatsApp* (use sempre):
- *negrito* para destacar nomes de produtos, preços e informações importantes
- Emojis com moderação (🔒 segurança, ✅ confirmação, 📦 entrega, 💳 pagamento, 📞 contato)
- Listas com • para múltiplos itens
- Máximo 3 blocos por mensagem — seja conciso
- NUNCA use markdown estilo --- ou ### — só formatação WhatsApp

*USO DAS TOOLS — regras obrigatórias:*

1. Cliente mencionou produto de forma vaga (ex: "12V", "controle", "nobreak", "cerca") → chame *find_products* e apresente a lista numerada: "Encontrei estes produtos, qual você precisa? 1️⃣ ... 2️⃣ ..."
2. Produto identificado → chame *check_stock* para verificar estoque
3. *check_stock* retornou in_stock: false → NÃO diga "sem estoque". Registre via *create_order_intent* e responda: "Anotei seu interesse! Nossa consultora vai entrar em contato com prazo e disponibilidade. 📞"
4. Ao apresentar um produto → chame *get_active_promotions* para ver se há oferta vigente
5. Cliente confirmou produto + quantidade + nome → chame *create_order_intent*
6. Não souber responder, cliente pedir humano, dúvida técnica específica ou negociação de volume → chame *escalate_to_human*

${catalog}

Pagamento: PIX, boleto, cartão. Prazo: 5-7 dias úteis SP. Outros estados: consultar.
Entregamos para todo o Brasil. Não revele custos internos nem dados de outros clientes.

═══ PERGUNTAS FREQUENTES ═══

COMPATIBILIDADE:
- "Funciona com o alarme da marca X?" → Pergunte qual a tecnologia do receptor. Se for Learning Code 433MHz, sim. Outra frequência/tecnologia: não é compatível.

FREQUÊNCIA: Todos os controles operam em 433MHz.

BATERIA: Sim, já vem inclusa bateria 3V.

GARANTIA: 1 ano nos controles. Eletrificadoras: 1 ano e 3 meses.

TROCA / RMA: Fazemos RMA. Cliente envia por Nota de Remessa, verificamos e devolvemos com nota de retorno.

DESCONTO POR QUANTIDADE: Verificamos internamente. Encaminhe o pedido e nossa equipe retorna com o melhor preço.`;

  let contents = [...history, { role: 'user', parts: [{ text: userText }] }];

  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents,
          tools: [{ function_declarations: TOOL_DECLARATIONS }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
        }),
      },
    );
    const json      = await res.json();
    const candidate = json.candidates?.[0];
    const parts: any[] = candidate?.content?.parts ?? [];

    const fnCalls = parts.filter(p => p.functionCall);

    // Sem tool calls → retorna texto final
    if (fnCalls.length === 0) {
      const text = parts.find(p => p.text)?.text;
      if (!text) throw new Error(`Gemini sem resposta: ${JSON.stringify(json).slice(0, 200)}`);
      return text;
    }

    // Executa todas as tools (podem ser paralelas)
    const fnResponses = await Promise.all(
      fnCalls.map(async (part: any) => {
        const { name, args } = part.functionCall;
        console.log(`tool_call: ${name}`, JSON.stringify(args).slice(0, 100));
        const result = await executeTool(name, args ?? {}, phone, sessionId);
        return { functionResponse: { name, response: { result } } };
      }),
    );

    // Adiciona resposta do modelo + resultados das tools e continua o loop
    contents = [
      ...contents,
      { role: 'model', parts },
      { role: 'user',  parts: fnResponses },
    ];
  }

  throw new Error('Gemini: loop de tools excedeu limite de iterações');
}

// ── Main ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // ── GET: verificação do webhook pelo Meta ──
  if (req.method === 'GET') {
    const u = new URL(req.url);
    if (
      u.searchParams.get('hub.mode') === 'subscribe' &&
      VERIFY_TOKEN &&
      u.searchParams.get('hub.verify_token') === VERIFY_TOKEN
    ) return new Response(u.searchParams.get('hub.challenge'), { status: 200 });
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('ok');

  // Lê corpo raw uma vez (necessário para HMAC)
  let rawBody: ArrayBuffer;
  try { rawBody = await req.arrayBuffer(); } catch { return new Response('ok'); }

  // Valida assinatura Meta
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  if (!(await verifyMetaSignature(rawBody, sig))) {
    console.error('Webhook: assinatura inválida — possível spoofing');
    return new Response('Forbidden', { status: 403 });
  }

  let body: any;
  try { body = JSON.parse(new TextDecoder().decode(rawBody)); } catch { return new Response('ok'); }

  const change = body?.entry?.[0]?.changes?.[0]?.value;

  // ── Status de entrega (delivered / read / failed) ──
  const statuses = change?.statuses;
  if (Array.isArray(statuses) && statuses.length > 0) {
    for (const st of statuses) {
      const messageId: string = st.id;
      const rawStatus: string = st.status;
      const status =
        rawStatus === 'delivered' ? 'delivered' :
        rawStatus === 'read'      ? 'read'      :
        rawStatus === 'failed'    ? 'failed'    :
        rawStatus === 'sent'      ? 'sent'      : null;
      if (status && messageId) {
        await fetch(
          `${SUPA_URL}/rest/v1/whatsapp_messages?message_id=eq.${encodeURIComponent(messageId)}`,
          { method: 'PATCH', headers: { ...supaHeaders, Prefer: 'return=minimal' }, body: JSON.stringify({ delivery_status: status }) },
        ).catch(() => {});
        if (status === 'failed' && st.errors?.length) {
          console.error(`Delivery failed ${messageId}:`, JSON.stringify(st.errors));
        }
      }
    }
    return new Response('ok');
  }

  const msg = change?.messages?.[0];
  if (!msg || msg.type !== 'text') return new Response('ok');

  const phone = msg.from as string;
  const wamid = msg.id   as string | undefined;
  let   text  = (msg.text?.body ?? '') as string;

  if (!text || change?.metadata?.phone_number_id === phone) return new Response('ok');

  // Dedup: ignora mensagem já processada
  if (wamid) {
    const existing = await dbSelect('whatsapp_messages', { message_id: wamid });
    if (existing.length > 0) return new Response('ok');
  }

  // Sanitização de input
  text = text
    .replace(/%%PEDIDO%%[\s\S]*?%%FIM%%/g, '')
    .replace(/%%PEDIDO%%|%%FIM%%/g, '')
    .trim()
    .slice(0, 1500);
  if (!text) return new Response('ok');

  try {
    await logMsg(phone, 'in', text, wamid);

    const session = await getSession(phone);

    // ── Se em handoff: não processa com IA, apenas loga ──
    if (session.status === 'handoff') {
      // Responde uma vez para o cliente saber que está aguardando
      const lastMsgs = await dbSelect('whatsapp_messages', { phone }, '&direction=eq.out&order=created_at.desc&limit=2');
      const alreadyNotified = lastMsgs.some(m => m.text?.includes('aguardando atendimento'));
      if (!alreadyNotified) {
        await sendWA(phone, 'Você está aguardando atendimento com uma de nossas consultoras. Ela responderá em breve! 📞');
        await logMsg(phone, 'out', 'Você está aguardando atendimento com uma de nossas consultoras. Ela responderá em breve! 📞');
      }
      return new Response('ok');
    }

    const catalog = await buildCatalog();
    const reply   = await callGemini(session.history, text, catalog, phone, session.id);

    const newHistory = [
      ...(session.history ?? []),
      { role: 'user',  parts: [{ text }] },
      { role: 'model', parts: [{ text: reply }] },
    ].slice(-20);

    await Promise.all([
      saveSession(session.id, newHistory),
      logMsg(phone, 'out', reply),
      sendWA(phone, reply),
    ]);
  } catch (e) {
    console.error('Webhook error:', e);
    await sendWA(phone, 'Desculpe, ocorreu um erro. Tente novamente em instantes.').catch(() => {});
  }

  return new Response('ok', { status: 200 });
});
