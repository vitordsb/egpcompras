// Gera imagem via Fal.ai (flux/schnell), armazena no Supabase Storage wa-images
// e retorna a URL pública permanente.
// FAL_KEY nunca vai pro frontend.
//
// Aceita dois modos:
//   { prompt, image_size? }           → gera via Fal.ai e armazena
//   { image_data: "<base64 JPEG>" }   → upload direto (ex: canvas composited no frontend)

const FAL_KEY  = Deno.env.get('FAL_KEY') ?? '';
const SUPA_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPA_JWT = Deno.env.get('SUPA_SERVICE_JWT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function jsonError(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function uploadBuffer(buffer: ArrayBuffer, contentType: string): Promise<string | null> {
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const res = await fetch(`${SUPA_URL}/storage/v1/object/wa-images/${fileName}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPA_JWT}`, 'Content-Type': contentType, 'x-upsert': 'false' },
    body: buffer,
  });
  if (!res.ok) return null;
  return `${SUPA_URL}/storage/v1/object/public/wa-images/${fileName}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: { prompt?: string; image_size?: string; image_data?: string };
  try { body = await req.json(); } catch { return jsonError('Invalid JSON'); }

  // ── Modo 2: upload direto de imagem já renderizada (base64 JPEG do canvas) ──
  if (body.image_data) {
    try {
      const bytes = Uint8Array.from(atob(body.image_data), (c) => c.charCodeAt(0));
      const publicUrl = await uploadBuffer(bytes.buffer, 'image/jpeg');
      if (!publicUrl) return jsonError('Falha no upload da imagem');
      return jsonOk({ url: publicUrl, stored: true });
    } catch {
      return jsonError('image_data inválido (esperado base64 JPEG)');
    }
  }

  // ── Modo 1: geração via Fal.ai ──
  const { prompt, image_size = 'landscape_4_3' } = body;
  if (!prompt?.trim()) return jsonError('prompt ou image_data é obrigatório');

  const falRes = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: prompt.trim(),
      image_size,
      num_inference_steps: 4,
      num_images: 1,
      enable_safety_checker: true,
    }),
  });

  if (!falRes.ok) {
    const err = await falRes.json().catch(() => ({}));
    return jsonError((err as any).detail ?? `Fal.ai error ${falRes.status}`);
  }

  const falData = await falRes.json();
  const tempUrl: string | undefined = falData.images?.[0]?.url;
  if (!tempUrl) return jsonError('Fal.ai não retornou imagem');

  // Baixa e armazena permanentemente
  const imgRes = await fetch(tempUrl);
  if (!imgRes.ok) return jsonOk({ url: tempUrl, stored: false });

  const contentType = imgRes.headers.get('Content-Type') ?? 'image/jpeg';
  const imgBuffer = await imgRes.arrayBuffer();
  const publicUrl = await uploadBuffer(imgBuffer, contentType);

  return jsonOk(publicUrl ? { url: publicUrl, stored: true } : { url: tempUrl, stored: false });
});
