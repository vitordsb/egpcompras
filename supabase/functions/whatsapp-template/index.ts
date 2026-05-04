// Gerencia templates WhatsApp Business via Meta Graph API.
// GET  → lista templates existentes com status
// POST { action:'create', template:{...} } → envia para aprovação da Meta
// POST { action:'delete', name }           → deleta um template

const WA_TOKEN    = Deno.env.get('WA_TOKEN') ?? '';
const WA_PHONE_ID = Deno.env.get('WA_PHONE_ID') ?? '';
const WABA_ID     = Deno.env.get('WABA_ID') ?? '';     // WhatsApp Business Account ID
const API_VER     = 'v20.0';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function jsonErr(msg: string, status = 400, details?: unknown) {
  return new Response(JSON.stringify({ error: msg, details }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!WA_TOKEN) return jsonErr('WA_TOKEN não configurado', 500);
  if (!WABA_ID)  return jsonErr('WABA_ID não configurado. Adicione o secret WABA_ID com o ID da sua conta WhatsApp Business.', 500);

  try {
    // ── GET: lista templates ──────────────────────────────────────────────
    if (req.method === 'GET') {
      const res  = await fetch(
        `https://graph.facebook.com/${API_VER}/${WABA_ID}/message_templates` +
        `?limit=100&fields=name,status,category,language,components,rejected_reason`,
        { headers: { Authorization: `Bearer ${WA_TOKEN}` } },
      );
      const json = await res.json();
      if (!res.ok) return jsonErr(json.error?.message ?? 'Falha ao listar templates', 400, json);
      return ok({ waba_id: WABA_ID, phone_id: WA_PHONE_ID, templates: json.data ?? [] });
    }

    // ── POST ─────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      let body: { action?: string; template?: Record<string, unknown>; name?: string };
      try { body = await req.json(); } catch { return jsonErr('JSON inválido'); }

      // Delete
      if (body.action === 'delete') {
        if (!body.name) return jsonErr('name é obrigatório');
        const res  = await fetch(
          `https://graph.facebook.com/${API_VER}/${WABA_ID}/message_templates?name=${encodeURIComponent(body.name)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${WA_TOKEN}` } },
        );
        const json = await res.json();
        if (!res.ok) return jsonErr(json.error?.message ?? 'Falha ao deletar', 400, json);
        return ok({ deleted: true, name: body.name });
      }

      // Create
      if (!body.template) return jsonErr('template é obrigatório');
      const res  = await fetch(
        `https://graph.facebook.com/${API_VER}/${WABA_ID}/message_templates`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body.template),
        },
      );
      const json = await res.json();
      if (!res.ok) return jsonErr(json.error?.message ?? 'Falha ao criar template', 400, json);
      return ok({ created: true, id: json.id, status: json.status, waba_id: WABA_ID });
    }

    return new Response('Method not allowed', { status: 405, headers: CORS });
  } catch (e: unknown) {
    return jsonErr(e instanceof Error ? e.message : String(e), 500);
  }
});
