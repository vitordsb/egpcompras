// Gera imagem via Fal.ai (flux/schnell), armazena no Supabase Storage wa-images
// e retorna a URL pública permanente.
// FAL_KEY nunca vai pro frontend.

const FAL_KEY  = Deno.env.get('FAL_KEY') ?? '';
const SUPA_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPA_JWT = Deno.env.get('SUPA_SERVICE_JWT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

function jsonError(msg: string, status = 400) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status, headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: { prompt?: string; image_size?: string };
  try { body = await req.json(); } catch { return jsonError('Invalid JSON'); }

  const { prompt, image_size = 'landscape_4_3' } = body;
  if (!prompt?.trim()) return jsonError('prompt é obrigatório');

  // 1. Gera imagem no Fal.ai (flux/schnell — ~2s, ~$0.003/img)
  const falRes = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
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

  // 2. Baixa a imagem e guarda no Supabase Storage para URL permanente
  const imgRes = await fetch(tempUrl);
  if (!imgRes.ok) {
    // Fal URLs são efêmeras (~1h) — retorna como fallback sem armazenar
    return new Response(
      JSON.stringify({ url: tempUrl, stored: false }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  const contentType = imgRes.headers.get('Content-Type') ?? 'image/jpeg';
  const imgBuffer = await imgRes.arrayBuffer();
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  const uploadRes = await fetch(
    `${SUPA_URL}/storage/v1/object/wa-images/${fileName}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPA_JWT}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body: imgBuffer,
    },
  );

  if (!uploadRes.ok) {
    // Upload falhou — retorna URL do Fal como fallback
    return new Response(
      JSON.stringify({ url: tempUrl, stored: false }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  const publicUrl = `${SUPA_URL}/storage/v1/object/public/wa-images/${fileName}`;

  return new Response(
    JSON.stringify({ url: publicUrl, stored: true }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
