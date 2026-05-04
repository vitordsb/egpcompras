// Gerencia templates WhatsApp Business via Meta Graph API.
// GET  → lista templates existentes com status
// POST { action:'create', template, sample_image_url? } → envia para aprovação
// POST { action:'delete', name }                        → deleta um template

const WA_TOKEN = Deno.env.get('WA_TOKEN') ?? '';
const WABA_ID  = Deno.env.get('WABA_ID')  ?? '';
const API_VER  = 'v20.0';

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

// Faz upload de uma imagem para o Meta Upload Sessions API e retorna o handle
async function uploadImageToMeta(imageUrl: string): Promise<string> {
  // 1. Baixa a imagem
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Não conseguiu baixar a imagem: ${imgRes.status}`);
  const imgBuffer  = await imgRes.arrayBuffer();
  const imgSize    = imgBuffer.byteLength;
  const imgType    = imgRes.headers.get('Content-Type') ?? 'image/jpeg';

  // 2. Cria uma sessão de upload no Meta
  const sessionRes = await fetch(
    `https://graph.facebook.com/${API_VER}/app/uploads` +
    `?file_length=${imgSize}&file_type=${encodeURIComponent(imgType)}&messaging_product=whatsapp`,
    { method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}` } },
  );
  const sessionJson = await sessionRes.json();
  if (!sessionRes.ok || !sessionJson.id) {
    throw new Error(`Upload session falhou: ${JSON.stringify(sessionJson).slice(0, 200)}`);
  }
  const uploadId: string = sessionJson.id;

  // 3. Envia os bytes da imagem
  const uploadRes = await fetch(`https://graph.facebook.com/${API_VER}/${uploadId}`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${WA_TOKEN}`,
      file_offset:    '0',
      'Content-Type': imgType,
    },
    body: imgBuffer,
  });
  const uploadJson = await uploadRes.json();
  if (!uploadRes.ok || !uploadJson.h) {
    throw new Error(`Upload falhou: ${JSON.stringify(uploadJson).slice(0, 200)}`);
  }

  return uploadJson.h as string;
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
      return ok({ waba_id: WABA_ID, templates: json.data ?? [] });
    }

    // ── POST ─────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      let body: {
        action?: string;
        template?: Record<string, unknown>;
        name?: string;
        sample_image_url?: string;
      };
      try { body = await req.json(); } catch { return jsonErr('JSON inválido'); }

      // Delete
      if (body.action === 'delete') {
        if (!body.name) return jsonErr('name é obrigatório');
        const res  = await fetch(
          `https://graph.facebook.com/${API_VER}/${WABA_ID}/message_templates` +
          `?name=${encodeURIComponent(body.name)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${WA_TOKEN}` } },
        );
        const json = await res.json();
        if (!res.ok) return jsonErr(json.error?.message ?? 'Falha ao deletar', 400, json);
        return ok({ deleted: true, name: body.name });
      }

      // Create
      if (!body.template) return jsonErr('template é obrigatório');

      const components = body.template.components as Record<string, unknown>[] | undefined;

      // Se o template tem header IMAGE e foi fornecida uma sample_image_url,
      // faz upload para o Meta e injeta o handle no componente de header
      if (body.sample_image_url && Array.isArray(components)) {
        const headerIdx = components.findIndex((c) => c.type === 'HEADER' && c.format === 'IMAGE');
        if (headerIdx >= 0) {
          const handle = await uploadImageToMeta(body.sample_image_url);
          components[headerIdx] = {
            ...components[headerIdx],
            example: { header_handle: [handle] },
          };
        }
      }

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
