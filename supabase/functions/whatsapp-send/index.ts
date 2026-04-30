// Proxy seguro para envio de mensagens WhatsApp.
// Aceita: { to, text } para mensagem livre OU { to, template: { name, params[] } } para template aprovado.
// O WA_TOKEN nunca vai pro frontend.

const WA_TOKEN    = Deno.env.get('WA_TOKEN') ?? '';
const WA_PHONE_ID = Deno.env.get('WA_PHONE_ID') ?? '';
const SUPA_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const SUPA_JWT    = Deno.env.get('SUPA_SERVICE_JWT') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

async function logMessage(phone: string, direction: 'in' | 'out', text: string) {
  await fetch(`${SUPA_URL}/rest/v1/whatsapp_messages`, {
    method: 'POST',
    headers: {
      apikey: SUPA_JWT,
      Authorization: `Bearer ${SUPA_JWT}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ phone, direction, text }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: {
    to?: string;
    text?: string;
    template?: { name: string; language?: string; params?: string[] };
  };
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400, headers: CORS }); }

  const { to, text, template } = body;
  if (!to) return new Response(JSON.stringify({ error: 'to é obrigatório' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!text && !template) return new Response(JSON.stringify({ error: 'text OU template é obrigatório' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  // Normaliza número: remove não-dígitos, garante código BR se não tiver DDI
  const digits = to.replace(/\D/g, '');
  const phone = digits.startsWith('55') ? digits : `55${digits}`;

  // Monta payload — template se fornecido, senão texto livre
  let payload: Record<string, unknown>;
  let logText: string;

  if (template) {
    const params = template.params ?? [];
    payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language ?? 'pt_BR' },
        components: params.length > 0 ? [
          { type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) },
        ] : [],
      },
    };
    logText = `[template:${template.name}] ${params.join(' | ')}`;
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    };
    logText = text!;
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

  await logMessage(phone, 'out', logText);

  return new Response(JSON.stringify({ sent: true, to: phone, message_id: json.messages?.[0]?.id }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
