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
// SECURITY: se WA_APP_SECRET não estiver configurado, NEGAR ao invés de
// aceitar. Antes o fallback era `return true` que deixava o webhook
// completamente aberto pra qualquer POST se a env var sumisse.
async function verifyMetaSignature(rawBody: ArrayBuffer, sig: string): Promise<boolean> {
  if (!WA_APP_SECRET) {
    console.error('[wa-webhook] WA_APP_SECRET ausente — recusando todas as requisições');
    return false;
  }
  if (!sig) return false;
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

// ── Rate limit por phone — proteção contra spam drenando quota Gemini ────────
// Checa quantas mensagens INBOUND recebemos desse número nos últimos 60s.
// Se excedeu o limite, retorna true (bloqueado). Log estruturado pra auditoria.
const RATE_LIMIT_PER_MINUTE = 10;
async function isRateLimited(phone: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 1000).toISOString();
  const url = `${SUPA_URL}/rest/v1/whatsapp_messages?phone=eq.${encodeURIComponent(phone)}&direction=eq.in&created_at=gte.${encodeURIComponent(since)}&select=id`;
  try {
    const res = await fetch(url, { headers: supaHeaders });
    if (!res.ok) return false; // fail-open: se não der pra checar, não bloqueia
    const rows = await res.json();
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count >= RATE_LIMIT_PER_MINUTE) {
      console.warn(`[wa-webhook] rate limit: phone=${phone} count=${count}/min — bloqueado`);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[wa-webhook] rate limit check failed:', err);
    return false;
  }
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
interface Session {
  id: string;
  history: any[];
  status: string;
  human_takeover: boolean;
}
async function getSession(phone: string): Promise<Session> {
  const rows = await dbSelect('whatsapp_sessions', { phone });
  if (rows.length > 0) return {
    id: rows[0].id,
    history: rows[0].history ?? [],
    status: rows[0].status ?? 'active',
    human_takeover: rows[0].human_takeover === true,
  };
  const created = await dbInsert('whatsapp_sessions', { phone, history: [], status: 'active' });
  if (!created?.id) throw new Error(`getSession: falha ao criar sessão para ${phone}`);
  return { id: created.id, history: [], status: 'active', human_takeover: false };
}

async function saveSession(id: string, history: any[]): Promise<void> {
  await dbUpdate('whatsapp_sessions', id, { history, updated_at: new Date().toISOString() });
}

// ── Catálogo (injetado no system prompt) ─────────────────────────────────────
async function buildCatalog(): Promise<string> {
  try {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/products_with_cost?select=name,sku,description,sale_price_brl,show_price&order=name`,
      { headers: supaHeaders },
    );
    const products: any[] = res.ok ? await res.json() : [];
    if (!Array.isArray(products) || products.length === 0) return '';
    return '═══ PRODUTOS EGP ═══\n' + products.map((p: any) => {
      const price = p.show_price && p.sale_price_brl
        ? ` — R$ ${Number(p.sale_price_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        : '';
      return `• ${p.name}${p.sku ? ` (${p.sku})` : ''}${price}${p.description ? ` — ${p.description}` : ''}`;
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
    name: 'lookup_client_by_cnpj',
    description:
      'Verifica se um CNPJ já está cadastrado no sistema da EGP. Use quando o cliente disser que já é cliente e fornecer o CNPJ, antes de pedir mais dados de cadastro. Se encontrar, retorna razão social e nome do comprador conhecido — assim você não precisa pedir de novo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        cnpj: { type: 'STRING', description: 'CNPJ informado pelo cliente. Aceita com ou sem máscara.' },
      },
      required: ['cnpj'],
    },
  },
  {
    name: 'create_order_intent',
    description:
      'Registra a intenção de compra DEPOIS de coletar todos os dados de qualificação B2B. NUNCA chame antes de ter: produto+quantidade, identificação do cliente (CNPJ + razão social) e nome do comprador. Para cliente novo, também precisa de endereço completo. Não use para simples consultas de preço.',
    parameters: {
      type: 'OBJECT',
      properties: {
        cnpj:           { type: 'STRING', description: 'CNPJ do cliente (obrigatório em B2B).' },
        razao_social:   { type: 'STRING', description: 'Razão social da empresa.' },
        comprador_nome: { type: 'STRING', description: 'Nome da pessoa que está fazendo o pedido (comprador/responsável).' },
        endereco_rua:        { type: 'STRING', description: 'Apenas para cliente novo. Logradouro.' },
        endereco_numero:     { type: 'STRING', description: 'Apenas para cliente novo. Número do endereço.' },
        endereco_cidade:     { type: 'STRING', description: 'Apenas para cliente novo.' },
        endereco_estado:     { type: 'STRING', description: 'Apenas para cliente novo. UF (ex: SP, MG).' },
        endereco_complemento:{ type: 'STRING', description: 'Apenas para cliente novo. Complemento ou observação de entrega.' },
        is_existing_client:  { type: 'BOOLEAN', description: 'true se o CNPJ já estava cadastrado (lookup_client_by_cnpj retornou found=true).' },
        items: {
          type: 'ARRAY',
          description: 'Lista de produtos do pedido.',
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
      required: ['cnpj', 'razao_social', 'comprador_nome', 'items', 'is_existing_client'],
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
          `?select=name,sku,description,sale_price_brl,show_price` +
          `&name=ilike.*${q}*&order=name&limit=8`,
          { headers: supaHeaders },
        );
        const rows: any[] = res.ok ? await res.json() : [];
        if (rows.length === 0) {
          return JSON.stringify({ found: false, message: `Nenhum produto encontrado para "${args.query}". Peça mais detalhes ao cliente.` });
        }
        const list = rows.map((p: any, i: number) => {
          const entry: Record<string, unknown> = { index: i + 1, name: p.name, sku: p.sku, description: p.description };
          if (p.show_price && p.sale_price_brl) {
            entry.price = `R$ ${Number(p.sale_price_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
          }
          return entry;
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

      case 'lookup_client_by_cnpj': {
        const rawCnpj = String(args.cnpj ?? '').trim();
        const digits = rawCnpj.replace(/\D/g, '');
        if (digits.length !== 14) {
          return JSON.stringify({ found: false, message: 'CNPJ deve ter 14 dígitos. Peça pro cliente conferir.' });
        }
        // Tenta com máscara e sem máscara
        const masked = `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
        const res = await fetch(
          `${SUPA_URL}/rest/v1/client_contacts?select=id,name,trade_name,cnpj,whatsapp_phone,email,address&or=(cnpj.eq.${digits},cnpj.eq.${encodeURIComponent(masked)})&limit=1`,
          { headers: supaHeaders },
        );
        const rows: any[] = res.ok ? await res.json() : [];
        if (rows.length === 0) {
          return JSON.stringify({ found: false, message: 'CNPJ não encontrado. Cliente é novo — peça os dados de cadastro (razão social, nome do comprador, endereço completo).' });
        }
        const c = rows[0];
        return JSON.stringify({
          found: true,
          razao_social: c.name,
          trade_name: c.trade_name,
          comprador_conhecido: null, // pode ser estendido futuramente
          message: `Cliente já cadastrado: ${c.name}. Confirme com o comprador o nome dele e siga com o pedido — não peça os dados de endereço, já temos.`,
        });
      }

      case 'create_order_intent': {
        const cnpjRaw       = String(args.cnpj ?? '').trim();
        const cnpjDigits    = cnpjRaw.replace(/\D/g, '');
        const razaoSocial   = String(args.razao_social ?? '').trim();
        const compradorNome = String(args.comprador_nome ?? '').trim();
        const items         = Array.isArray(args.items) ? args.items : [];
        const isExisting    = Boolean(args.is_existing_client);
        if (cnpjDigits.length !== 14 || !razaoSocial || !compradorNome || items.length === 0) {
          return JSON.stringify({ success: false, error: 'cnpj válido (14 dígitos), razao_social, comprador_nome e items são obrigatórios.' });
        }
        const cnpjMasked = `${cnpjDigits.slice(0, 2)}.${cnpjDigits.slice(2, 5)}.${cnpjDigits.slice(5, 8)}/${cnpjDigits.slice(8, 12)}-${cnpjDigits.slice(12, 14)}`;

        // Monta endereço (só esperamos pra cliente novo)
        const enderecoParts: string[] = [];
        if (args.endereco_rua) enderecoParts.push(String(args.endereco_rua).trim());
        if (args.endereco_numero) enderecoParts.push(String(args.endereco_numero).trim());
        if (args.endereco_cidade || args.endereco_estado) {
          enderecoParts.push([args.endereco_cidade, args.endereco_estado].filter(Boolean).map(String).map((s) => s.trim()).join('/'));
        }
        if (args.endereco_complemento) enderecoParts.push(`obs: ${String(args.endereco_complemento).trim()}`);
        const enderecoCompleto = enderecoParts.length > 0 ? enderecoParts.join(', ') : null;

        // Cria/atualiza client_contacts (cadastro CRM)
        const lookupRes = await fetch(
          `${SUPA_URL}/rest/v1/client_contacts?select=id&or=(cnpj.eq.${cnpjDigits},cnpj.eq.${encodeURIComponent(cnpjMasked)})&limit=1`,
          { headers: supaHeaders },
        );
        const existingRows: any[] = lookupRes.ok ? await lookupRes.json() : [];
        const existingId = existingRows[0]?.id ?? null;

        if (existingId) {
          // Atualiza WhatsApp e endereço (se vier) sem sobrescrever razão social
          const updates: Record<string, unknown> = { whatsapp_phone: phone };
          if (enderecoCompleto) updates.address = enderecoCompleto;
          await dbUpdate('client_contacts', existingId, updates);
        } else {
          await dbInsert('client_contacts', {
            name: razaoSocial,
            cnpj: cnpjMasked,
            whatsapp_phone: phone,
            address: enderecoCompleto,
          });
        }

        // Cria intent enriquecida
        const intent = await dbInsert('order_intents', {
          session_id:      sessionId || null,
          phone,
          client_name:     razaoSocial,
          collected_lead_data: JSON.stringify({
            cnpj: cnpjMasked,
            razao_social: razaoSocial,
            comprador_nome: compradorNome,
            endereco: enderecoCompleto,
            is_existing_client: isExisting,
          }),
          items:           JSON.stringify(items),
          forma_pagamento: args.forma_pagamento ? String(args.forma_pagamento) : null,
          status:          'pending',
        });
        if (!intent?.id) return JSON.stringify({ success: false, error: 'Falha ao registrar pedido no banco' });
        const summary = items.map((it: any) => `${it.quantity}x ${it.name}`).join(', ');
        return JSON.stringify({
          success:   true,
          intent_id: intent.id,
          message:   `Pedido registrado: ${summary} para ${razaoSocial} (${cnpjMasked}). Comprador: ${compradorNome}. A vendedora vai entrar em contato em breve.`,
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
  const system = `Você é a assistente comercial da EGP Tecnologia — indústria brasileira B2B de equipamentos de segurança eletrônica (controles, eletrificadoras, fontes, cabos). Atende revendedores, instaladores e distribuidores.

═══ TOM E ESTILO B2B ═══
- Profissional e direto, sem ser frio. Escreva como um atendimento comercial competente.
- SEM emojis. NUNCA use 😊 😉 🎉 🙏 etc.
- SEM gírias: nada de "Show!", "Perfeito!", "Anotado!", "Beleza", "Tranquilo".
- Trate o cliente formalmente (você, sem "amigo"/"meu querido"). "Sr/Sra" só se o cliente usar primeiro.
- *Negrito* SÓ em nome de produto e valor. Nada de markdown decorativo (###, ---, bullets desnecessários).
- Frases curtas e completas. Máximo 4 linhas por mensagem.
- UMA pergunta por mensagem. Não enche o cliente com 3 perguntas de uma vez.
- PROIBIDO repetir o que o cliente disse antes de responder.

Exemplos:
❌ "Show! 50 peças do Eletrificador EGP 12.000. Só me fala seu nome..."
✅ "Confere: 50 unidades do *Eletrificador EGP 12.000*. Você já é cliente da EGP?"

❌ "Anotado! 📝 Pedido registrado, nossa consultora fala em breve."
✅ "Pedido registrado. A vendedora entrará em contato pra confirmar prazo e condição comercial."

❌ "Olá! 😊 Como posso te ajudar hoje?"
✅ "Bom dia. Em que posso ajudar?"

═══ REGRAS DE PRODUTO E PREÇO ═══
- Produto com preço no catálogo → pode informar.
- Produto SEM preço no catálogo → nunca invente. Responda: "Vou pedir pra vendedora te passar a melhor condição." e chame escalate_to_human(reason="price_negotiation").
- NUNCA mencione estoque, "indisponível", "sem estoque", "esgotado" — proibido em qualquer contexto.

═══ FLUXO DE VENDA (B2B — vendedora fecha) ═══

PASSO 1 — Identificar produto e quantidade
- Cliente menciona produto vago ("controle", "12V") → find_products → mostre opções numeradas: "1. *Produto X* — R$ Y\\n2. *Produto Z* — R$ W"
- Pergunte qual quer e a quantidade.

PASSO 2 — Qualificação B2B (OBRIGATÓRIO antes de criar pedido)
Quando tiver produto+quantidade, pergunte: "Você já é cliente cadastrado da EGP?"

  CASO A — JÁ É CLIENTE:
  - Peça apenas o CNPJ.
  - Quando receber, chame lookup_client_by_cnpj.
  - Se found=true: peça SOMENTE o nome do comprador (quem está fazendo o pedido). Não peça endereço.
  - Se found=false: avise "Não encontrei esse CNPJ no nosso sistema. Vou cadastrar como cliente novo." e siga pro CASO B coletando o resto.

  CASO B — CLIENTE NOVO (ou CNPJ não localizado):
  Colete em mensagens separadas, UMA pergunta por vez (não despeje checklist):
  1. CNPJ
  2. Razão social
  3. Nome do comprador (quem está fazendo o pedido)
  4. Endereço de entrega: rua e número
  5. Cidade e estado (UF)
  6. Complemento ou observação de entrega (opcional — pode pular se cliente não tiver)

PASSO 3 — Confirmação e registro
- Quando tiver TUDO (produto+qty + CNPJ + razão social + comprador + endereço se novo), faça uma confirmação resumida:
  "Confirmando o pedido:
  *2x Eletrificador EGP 12.000*
  CNPJ: 00.000.000/0001-00
  Comprador: Fulano de Tal
  Posso registrar?"
- Após o cliente confirmar (sim/ok/pode), chame create_order_intent com is_existing_client=true ou false conforme o lookup.
- Resposta final: "Pedido registrado. A vendedora vai entrar em contato em breve pra confirmar prazo, frete e condição comercial."

═══ OUTROS ═══
- Promoção ativa relevante → get_active_promotions e mencione naturalmente no fluxo.
- Cliente pede pra falar com humano, dúvida técnica de instalação, negociação fora do tabelado → escalate_to_human.
- Pagamento: PIX, boleto ou cartão. A condição é negociada com a vendedora.
- Entrega: prazo confirmado pela vendedora.
- Compatibilidade controles: Learning Code 433MHz.
- Garantia: 1 ano controles, 1 ano e 3 meses eletrificadoras.
- RMA: cliente envia por Nota de Remessa, devolvemos com nota de retorno.

${catalog}`;

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
          generationConfig: { temperature: 0.9, maxOutputTokens: 400 },
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

    // ── Rate limit: protege quota Gemini contra spam ──
    if (await isRateLimited(phone)) {
      // Não responde (silent drop). Log já registrado em isRateLimited.
      return new Response('ok');
    }

    const session = await getSession(phone);

    // ── Se em handoff OU vendedora ativou modo manual: não chama IA ──
    if (session.status === 'handoff' || session.human_takeover === true) {
      // Em modo manual (vendedora assumiu), não envia mensagem automática
      // alguma — só registra o inbound e deixa a vendedora responder.
      if (session.human_takeover === true) {
        console.log(`[wa-webhook] human_takeover ativo pro phone ${phone} — IA não responde`);
        return new Response('ok');
      }
      // Em handoff (handoff_requested → aguardando vendedora pegar):
      // notifica o cliente uma vez que está aguardando.
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
