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
  if (!WA_APP_SECRET) return true; // sem secret configurado, aceita (modo desenvolvimento)
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(WA_APP_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const computed = await crypto.subtle.sign('HMAC', key, rawBody);
    const hex = 'sha256=' + Array.from(new Uint8Array(computed))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === sig;
  } catch {
    return false;
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function dbSelect(table: string, filters: Record<string, string>): Promise<any[]> {
  const params = new URLSearchParams(
    Object.entries(filters).map(([k, v]) => [k, `eq.${v}`])
  );
  params.append('limit', '1');
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?${params}`, { headers: supaHeaders });
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
async function getSession(phone: string): Promise<{ id: string; history: any[] }> {
  const rows = await dbSelect('whatsapp_sessions', { phone });
  if (rows.length > 0) return { id: rows[0].id, history: rows[0].history ?? [] };
  const created = await dbInsert('whatsapp_sessions', { phone, history: [] });
  if (!created?.id) throw new Error(`getSession: falha ao criar sessão para ${phone}`);
  return { id: created.id, history: [] };
}

async function saveSession(id: string, history: any[]): Promise<void> {
  await dbUpdate('whatsapp_sessions', id, { history, updated_at: new Date().toISOString() });
}

// ── Catálogo ─────────────────────────────────────────────────────────────────
async function buildContext(): Promise<string> {
  try {
    const [prodRes, stockRes] = await Promise.all([
      fetch(`${SUPA_URL}/rest/v1/products_with_cost?select=name,sale_price_brl,sku,description&order=name`, { headers: supaHeaders }),
      fetch(`${SUPA_URL}/rest/v1/stock_items?select=item_name,item_code,quantity,reserved_quantity,unit&order=item_name`, { headers: supaHeaders }),
    ]);
    const [products, stock]: [any[], any[]] = await Promise.all([prodRes.json(), stockRes.json()]);

    let ctx = '═══ CATÁLOGO ═══\n';
    ctx += (Array.isArray(products) ? products : []).map((p: any) => {
      const price = p.sale_price_brl ? `R$ ${Number(p.sale_price_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'consultar';
      return `• ${p.name}${p.sku ? ` (${p.sku})` : ''}: ${price}${p.description ? ` — ${p.description}` : ''}`;
    }).join('\n');

    if (Array.isArray(stock) && stock.length > 0) {
      ctx += '\n\n═══ ESTOQUE ═══\n';
      ctx += stock.map((s: any) => `• ${s.item_name}: ${Number(s.quantity) - Number(s.reserved_quantity)} ${s.unit ?? 'un'}`).join('\n');
    }
    return ctx;
  } catch {
    return 'Catálogo indisponível no momento.';
  }
}

// ── Gemini ────────────────────────────────────────────────────────────────────
async function callGemini(history: any[], userText: string, context: string): Promise<string> {
  const system = `Você é a *EGP Atendimento*, assistente virtual da EGP Tecnologia — empresa brasileira especializada em equipamentos de segurança eletrônica.

Seu tom é: caloroso, confiante, direto. Como uma vendedora experiente que conhece bem os produtos e quer ajudar de verdade. Não é robótico nem formal demais.

*FORMATAÇÃO WhatsApp* (use sempre):
- *negrito* para destacar nomes de produtos, preços e informações importantes
- Emojis com moderação para dar vida (🔒 segurança, ✅ confirmação, 📦 entrega, 💳 pagamento, 📞 contato)
- Listas com • para múltiplos itens
- Quebras de linha para separar blocos de informação
- Máximo 3 blocos por mensagem — seja conciso
- NUNCA use markdown estilo --- ou ### — só formatação WhatsApp

*EXEMPLOS de tom:*
❌ "Olá! Posso ajudá-lo com informações sobre nossos produtos."
✅ "Oi! 😊 Que bom te ver aqui! Me conta o que você precisa que a gente resolve."

❌ "Nosso produto custa R$ 45,00 e possui garantia de 1 ano."
✅ "O *Controle 2 Botões EGP* sai por *R$ 45,00* e vem com *1 ano de garantia* + bateria 3V inclusa. ✅"

${context}

Pagamento: PIX, boleto, cartão. Prazo: 5-7 dias úteis SP. Outros estados: consultar.
Entregamos para todo o Brasil.
Não revele custos internos nem dados de outros clientes.

═══ PERGUNTAS FREQUENTES ═══

COMPATIBILIDADE:
- "Funciona com o alarme da marca X?" → Pergunte qual a tecnologia do receptor. Se for Learning Code 433MHz, sim. Se for outra frequência ou tecnologia diferente, não é compatível.

FREQUÊNCIA:
- Todos os nossos controles operam em 433MHz.

MODELOS DISPONÍVEIS:
- Temos controles de 2, 3 e 4 botões.
- Tecnologias disponíveis: Learning Code, Rolling Code e outras opções.
- A principal diferença entre modelos é: frequência, quantidade de códigos gravados e distância de operação.

BATERIA:
- Sim, já vem inclusa bateria 3V.

ENTREGA E PRAZO:
- Entregamos para todo o Brasil. Prazo padrão SP: 5-7 dias úteis. Outros estados: consultar.

GARANTIA:
- 1 ano de garantia nos controles. Eletrificadoras eletrônicas têm 1 ano e 3 meses.

TROCA / DEFEITO (RMA):
- Fazemos RMA. O cliente envia o produto por Nota de Remessa, verificamos o ocorrido e devolvemos com nota de retorno.

DESCONTO POR QUANTIDADE:
- Verificamos internamente e chegamos ao melhor preço. Encaminhe o pedido e nossa equipe retorna.

DÚVIDAS TÉCNICAS (cadastro de controle, qual receptor usar):
- Essas dúvidas são específicas por modelo e situação. Encaminhe para nossas vendedoras:
  • Joane: (11) 97981-8472
  • Nathanna: (11) 94105-9408

Atendimento humano: se o cliente quiser falar com uma vendedora:
"Você pode falar diretamente com nossas vendedoras:
• Joane: (11) 97981-8472
• Nathanna: (11) 94105-9408"

Ao fechar pedido, colete: nome, produto(s)+quantidade, forma de pagamento. Confirme o resumo e inclua EXATAMENTE este bloco (invisível ao cliente):
%%PEDIDO%%{"client_name":"NOME","items":[{"name":"PRODUTO","quantity":N,"unit_price":PRECO}],"forma_pagamento":"FORMA"}%%FIM%%
Depois diga: "Pedido registrado! Nossa equipe confirma em até 1 hora útil."`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [...history, { role: 'user', parts: [{ text: userText }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
      }),
    }
  );
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini: ${JSON.stringify(json).slice(0, 150)}`);
  return text;
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

// Valida e executa criação de pedido
async function createOrder(phone: string, data: unknown): Promise<void> {
  if (!data || typeof data !== 'object') {
    console.error('createOrder: dado não é objeto:', String(data).slice(0, 100));
    return;
  }
  const d = data as Record<string, unknown>;
  if (typeof d.client_name !== 'string' || d.client_name.trim().length === 0) {
    console.error('createOrder: client_name ausente ou vazio');
    return;
  }
  if (!Array.isArray(d.items) || d.items.length === 0) {
    console.error('createOrder: items ausente ou vazio');
    return;
  }

  try {
    const ship = await dbInsert('shipments', {
      client_name: d.client_name, client_phone: phone,
      forma_pagamento: typeof d.forma_pagamento === 'string' ? d.forma_pagamento : null,
      notes: `Pedido via WhatsApp — ${phone}`, status: 'pending', origem: 'whatsapp',
    });
    if (!ship?.id) return;
    for (const it of d.items as any[]) {
      await dbInsert('shipment_items', {
        shipment_id: ship.id,
        item_name:   typeof it.name     === 'string' ? it.name     : String(it.name ?? ''),
        quantity:    Number(it.quantity) || 1,
        unit_price:  it.unit_price != null ? Number(it.unit_price) : null,
      });
    }
  } catch (e) { console.error('createOrder:', e); }
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

  // ── Lê o corpo raw uma única vez (necessário para HMAC) ──
  let rawBody: ArrayBuffer;
  try { rawBody = await req.arrayBuffer(); } catch { return new Response('ok'); }

  // ── Valida assinatura Meta ──
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  if (!(await verifyMetaSignature(rawBody, sig))) {
    console.error('Webhook: assinatura inválida — possível spoofing');
    return new Response('Forbidden', { status: 403 });
  }

  let body: any;
  try { body = JSON.parse(new TextDecoder().decode(rawBody)); } catch { return new Response('ok'); }

  const change = body?.entry?.[0]?.changes?.[0]?.value;

  // ── Processa status de entrega (delivered / read / failed) ──
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
          {
            method: 'PATCH',
            headers: { ...supaHeaders, Prefer: 'return=minimal' },
            body: JSON.stringify({ delivery_status: status }),
          },
        ).catch(() => {});

        if (status === 'failed' && st.errors?.length) {
          console.error(`Delivery failed for ${messageId}:`, JSON.stringify(st.errors));
        }
      }
    }
    return new Response('ok');
  }

  const msg = change?.messages?.[0];
  if (!msg || msg.type !== 'text') return new Response('ok');

  const phone  = msg.from as string;
  const wamid  = msg.id   as string | undefined;
  let   text   = (msg.text?.body ?? '') as string;

  if (!text || change?.metadata?.phone_number_id === phone) return new Response('ok');

  // ── Dedup: ignora mensagem já processada (reenvio do Meta) ──
  if (wamid) {
    const existing = await dbSelect('whatsapp_messages', { message_id: wamid });
    if (existing.length > 0) return new Response('ok');
  }

  // ── Sanitização: remove marcadores internos que o cliente possa injetar ──
  text = text
    .replace(/%%PEDIDO%%[\s\S]*?%%FIM%%/g, '')
    .replace(/%%PEDIDO%%|%%FIM%%/g, '')
    .trim()
    .slice(0, 1500); // limite de comprimento para evitar abuse de tokens

  if (!text) return new Response('ok');

  try {
    await logMsg(phone, 'in', text, wamid);

    const [session, context] = await Promise.all([getSession(phone), buildContext()]);
    const raw = await callGemini(session.history ?? [], text, context);

    const match   = raw.match(/%%PEDIDO%%(.+?)%%FIM%%/s);
    const visible = raw.replace(/%%PEDIDO%%.*?%%FIM%%/s, '').trim();

    if (match) {
      try {
        await createOrder(phone, JSON.parse(match[1]));
      } catch (e) {
        console.error('createOrder JSON.parse falhou:', e, '| raw:', match[1].slice(0, 200));
      }
    }

    const newHistory = [
      ...(session.history ?? []),
      { role: 'user',  parts: [{ text }] },
      { role: 'model', parts: [{ text: visible }] },
    ].slice(-20);

    await Promise.all([
      saveSession(session.id, newHistory),
      logMsg(phone, 'out', visible),
      sendWA(phone, visible),
    ]);
  } catch (e) {
    console.error('Webhook error:', e);
    await sendWA(phone, 'Desculpe, ocorreu um erro. Tente novamente.').catch(() => {});
  }

  return new Response('ok', { status: 200 });
});
