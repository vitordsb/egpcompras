// Proxy seguro para envio de mensagens WhatsApp.
// Aceita: { to, text } para mensagem livre OU { to, template: { name, params[] } } para template aprovado.
// O WA_TOKEN nunca vai pro frontend.
//
// Fallback automático janela 24h: quando body inclui template_fallback,
// a função consulta whatsapp_messages e:
//   - Se há mensagem inbound nas últimas 24h → manda livre (image/text)
//   - Se NÃO há (janela fechada) → usa template_fallback com header IMAGE

const WA_TOKEN    = Deno.env.get('WA_TOKEN') ?? '';
const WA_PHONE_ID = Deno.env.get('WA_PHONE_ID') ?? '';
const SUPA_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const SUPA_JWT    = Deno.env.get('SUPA_SERVICE_JWT') ?? '';
// Template default pro flyer (env var pra trocar quando flyer_comemorativo_egp
// for aprovado pela Meta). Hoje cai no promo_imagem_egp que já tá aprovado.
const WA_FLYER_TEMPLATE = Deno.env.get('WA_FLYER_TEMPLATE') ?? 'promo_imagem_egp';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

/**
 * Verifica se há mensagem inbound nas últimas 24h pra esse número.
 * Retorna true → janela aberta, pode mandar livre.
 * Retorna false → janela fechada, precisa template.
 */
async function isWindowOpen(phone: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `${SUPA_URL}/rest/v1/whatsapp_messages?phone=eq.${encodeURIComponent(phone)}&direction=eq.in&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPA_JWT,
        Authorization: `Bearer ${SUPA_JWT}`,
      },
    });
    if (!res.ok) {
      console.warn('[wa-send] window check fail', res.status);
      return false; // conservador: se não dá pra checar, assume fechada
    }
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn('[wa-send] window check error:', err);
    return false;
  }
}

async function logMessage(
  phone: string,
  direction: 'in' | 'out',
  text: string,
  sentBy: string | null,
  messageId?: string,
) {
  await fetch(`${SUPA_URL}/rest/v1/whatsapp_messages`, {
    method: 'POST',
    headers: {
      apikey: SUPA_JWT,
      Authorization: `Bearer ${SUPA_JWT}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      phone,
      direction,
      text,
      sent_by: sentBy,
      message_id: messageId ?? null,
      delivery_status: 'sent',
    }),
  }).catch(() => {});
}

// Extrai o primeiro nome de um email/label e capitaliza.
// "vitor@grupoegp.com.br" → "Vitor"
// "Nathanna" → "Nathanna"
function senderName(label: string | undefined | null): string | null {
  if (!label) return null;
  const local = label.includes('@') ? label.split('@')[0] : label;
  if (!local) return null;
  return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: {
    to?: string;
    text?: string;
    image_url?: string;
    template?: {
      name: string;
      language?: string;
      params?: string[];
      image_url?: string; // para templates com header IMAGE (ex: promo_imagem_egp)
    };
    /** Quando informado, ativa fallback automático de janela 24h:
     *  - Janela aberta → manda image/text livre
     *  - Janela fechada → manda como template (com image_url no header e
     *    body_params no body). Útil pra flyers comemorativos que podem
     *    ser enviados pra clientes que não conversaram nas últimas 24h.
     */
    template_fallback?: {
      name?: string; // default WA_FLYER_TEMPLATE
      language?: string; // default pt_BR
      body_params?: string[]; // params do body do template
    };
    /** Default false. Se true, força envio como imagem livre mesmo fora
     *  da janela 24h (Meta vai rejeitar se cliente não tiver opt-in
     *  recente — use por sua conta e risco). */
    force_image?: boolean;
    sender_label?: string;
  };
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400, headers: CORS }); }

  const { to, text, image_url, template, sender_label } = body;
  const forceImage = Boolean(body.force_image);
  // Quando vem imagem SEM force_image, sempre ativa o fallback automático
  // (mesmo se o cliente não passou template_fallback explícito). Assim
  // protege contra calls antigos que não conhecem o param novo.
  const template_fallback = body.template_fallback ?? (image_url && !forceImage ? {} : undefined);
  const senderFirstName = senderName(sender_label);
  if (!to) return new Response(JSON.stringify({ error: 'to é obrigatório' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!text && !template && !image_url) return new Response(JSON.stringify({ error: 'text, image_url OU template é obrigatório' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  // Normaliza número: remove não-dígitos, garante código BR se não tiver DDI
  const digits = to.replace(/\D/g, '');
  const phone = digits.startsWith('55') ? digits : `55${digits}`;

  // Monta payload — imagem, template ou texto livre
  let payload: Record<string, unknown>;
  let logText: string;
  let usedFallback = false;

  if (image_url) {
    // Mensagem de imagem (gerada pela IA ou externa)
    const caption = text
      ? (senderFirstName ? `*${senderFirstName} · EGP*\n\n${text}` : text)
      : (senderFirstName ? `*${senderFirstName} · EGP*` : undefined);

    // Se foi pedido fallback, checa janela 24h. Se fechada, usa template.
    let useTemplate = false;
    if (template_fallback) {
      const open = await isWindowOpen(phone);
      console.log(`[wa-send] window check ${phone}: ${open ? 'OPEN' : 'CLOSED'}`);
      useTemplate = !open;
    }

    if (useTemplate) {
      // Janela fechada — usa template aprovado com header IMAGE
      const tmplName = template_fallback?.name ?? WA_FLYER_TEMPLATE;
      const tmplLang = template_fallback?.language ?? 'pt_BR';
      // body_params: usa explícito se passado, senão usa o text (caption)
      // ou um fallback genérico pra não falhar (template exige {{1}})
      const fallbackBody = text || 'Mensagem da EGP Tecnologia';
      const tmplParams = template_fallback?.body_params && template_fallback.body_params.length > 0
        ? template_fallback.body_params
        : [fallbackBody];

      const components: Record<string, unknown>[] = [];
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: image_url } }],
      });
      if (tmplParams.length > 0) {
        components.push({
          type: 'body',
          parameters: tmplParams.map((p) => ({ type: 'text', text: p })),
        });
      }

      payload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: tmplName,
          language: { code: tmplLang },
          components,
        },
      };
      usedFallback = true;
      logText = `[template:${tmplName}] [imagem] ${tmplParams.join(' | ')}`;
    } else {
      payload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'image',
        image: { link: image_url, ...(caption ? { caption } : {}) },
      };
      logText = `[imagem] ${caption ?? image_url}`;
    }
  } else if (template) {
    const params   = template.params ?? [];
    const tmplImgUrl = template.image_url;

    // Monta components: header com imagem (se houver) + body com params
    const components: Record<string, unknown>[] = [];
    if (tmplImgUrl) {
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: tmplImgUrl } }],
      });
    }
    if (params.length > 0) {
      components.push({
        type: 'body',
        parameters: params.map((p) => ({ type: 'text', text: p })),
      });
    }

    payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language ?? 'pt_BR' },
        components,
      },
    };
    logText = `[template:${template.name}]${tmplImgUrl ? ' [imagem]' : ''} ${params.join(' | ')}`;
  } else {
    // Prefixa "*Nome · EGP*" pra cliente saber quem está falando
    const finalText = senderFirstName
      ? `*${senderFirstName} · EGP*\n\n${text}`
      : text!;
    payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: finalText },
    };
    logText = finalText;
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok) {
    return new Response(JSON.stringify({ error: json.error?.message ?? 'Falha ao enviar', details: json }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const messageId: string | undefined = json.messages?.[0]?.id;
  await logMessage(phone, 'out', logText, sender_label ?? null, messageId);

  return new Response(JSON.stringify({
    sent: true,
    to: phone,
    message_id: messageId,
    used_template_fallback: usedFallback,
    delivery_method: usedFallback ? 'template_24h_fallback' : (template ? 'template' : (image_url ? 'image' : 'text')),
  }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
