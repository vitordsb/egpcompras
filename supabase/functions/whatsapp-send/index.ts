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

async function logMessage(phone: string, direction: 'in' | 'out', text: string, sentBy: string | null) {
  await fetch(`${SUPA_URL}/rest/v1/whatsapp_messages`, {
    method: 'POST',
    headers: {
      apikey: SUPA_JWT,
      Authorization: `Bearer ${SUPA_JWT}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ phone, direction, text, sent_by: sentBy }),
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
    template?: { name: string; language?: string; params?: string[] };
    sender_label?: string;
  };
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400, headers: CORS }); }

  const { to, text, image_url, template, sender_label } = body;
  const senderFirstName = senderName(sender_label);
  if (!to) return new Response(JSON.stringify({ error: 'to é obrigatório' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!text && !template && !image_url) return new Response(JSON.stringify({ error: 'text, image_url OU template é obrigatório' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  // Normaliza número: remove não-dígitos, garante código BR se não tiver DDI
  const digits = to.replace(/\D/g, '');
  const phone = digits.startsWith('55') ? digits : `55${digits}`;

  // Monta payload — imagem, template ou texto livre
  let payload: Record<string, unknown>;
  let logText: string;

  if (image_url) {
    // Mensagem de imagem (gerada pela IA ou externa)
    const caption = text
      ? (senderFirstName ? `*${senderFirstName} · EGP*\n\n${text}` : text)
      : (senderFirstName ? `*${senderFirstName} · EGP*` : undefined);
    payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'image',
      image: { link: image_url, ...(caption ? { caption } : {}) },
    };
    logText = `[imagem] ${caption ?? image_url}`;
  } else if (template) {
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

  await logMessage(phone, 'out', logText, sender_label ?? null);

  return new Response(JSON.stringify({ sent: true, to: phone, message_id: json.messages?.[0]?.id }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
