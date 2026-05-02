// Gera imagem via Fal.ai, aplica branding EGP (logo + CNPJ) via jimp e armazena.
// FAL_KEY nunca vai pro frontend.
//
// Modos:
//   { prompt, image_size? }         → gera via Fal.ai + branding + armazena
//   { image_data: "<base64 JPEG>" } → upload direto (canvas já aplicou branding no browser)

import Jimp from 'npm:jimp@0.22.12';

const FAL_KEY  = Deno.env.get('FAL_KEY') ?? '';
const SUPA_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPA_JWT = Deno.env.get('SUPA_SERVICE_JWT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const LOGO_URL  = `${SUPA_URL}/storage/v1/object/public/product-images/branding/logo.png`;
const CNPJ_TEXT = 'CNPJ: 40.116.124/0001-51';
const CORP_NAME = 'EGP IND E COM LTDA';

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

async function uploadBuffer(buffer: ArrayBuffer | Uint8Array, contentType = 'image/jpeg'): Promise<string | null> {
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  const res = await fetch(`${SUPA_URL}/storage/v1/object/wa-images/${fileName}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPA_JWT}`, 'Content-Type': contentType, 'x-upsert': 'false' },
    body: buffer,
  });
  if (!res.ok) return null;
  return `${SUPA_URL}/storage/v1/object/public/wa-images/${fileName}`;
}

async function applyBranding(imageBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    // Carrega imagem gerada
    const img = await Jimp.read(Buffer.from(imageBuffer));
    const W = img.getWidth();
    const H = img.getHeight();

    // Faixa escura no rodapé (gradiente manual linha por linha)
    const stripH = Math.round(H * 0.14);
    for (let y = H - stripH; y < H; y++) {
      const progress = (y - (H - stripH)) / stripH; // 0→1
      const alpha = Math.round(progress * 185); // 0→185 (72% de 255)
      for (let x = 0; x < W; x++) {
        const existing = img.getPixelColor(x, y);
        const { r, g, b } = Jimp.intToRGBA(existing);
        // Mistura com preto pelo alpha calculado
        const nr = Math.round(r * (1 - progress * 0.72));
        const ng = Math.round(g * (1 - progress * 0.72));
        const nb = Math.round(b * (1 - progress * 0.72));
        img.setPixelColor(Jimp.rgbaToInt(nr, ng, nb, 255), x, y);
      }
    }

    // Logo
    const logoRes = await fetch(LOGO_URL);
    if (logoRes.ok) {
      const logoBuffer = await logoRes.arrayBuffer();
      const logo = await Jimp.read(Buffer.from(logoBuffer));
      const logoW = Math.round(W * 0.24);
      logo.resize(logoW, Jimp.AUTO);
      const pad   = Math.round(W * 0.025);
      const logoY = H - logo.getHeight() - pad;
      img.composite(logo, pad, logoY, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 1, opacityDest: 1 });
    }

    // Texto CNPJ + nome (jimp usa fontes bitmap pré-renderizadas)
    try {
      const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
      const pad  = Math.round(W * 0.025);
      const nameW = img.measureText(font, CORP_NAME);
      const cnpjW = img.measureText(font, CNPJ_TEXT);
      img.print(font, W - nameW - pad, H - 44, CORP_NAME);
      img.print(font, W - cnpjW - pad, H - 24, CNPJ_TEXT);
    } catch {
      // Fallback silencioso se fonte falhar — imagem sai sem texto mas com logo
    }

    const jpegBuffer = await img.getBufferAsync(Jimp.MIME_JPEG);
    return jpegBuffer.buffer as ArrayBuffer;
  } catch (err) {
    // Se branding falhar, retorna imagem original sem modificação
    console.error('applyBranding error:', err);
    return imageBuffer;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: { prompt?: string; image_size?: string; image_data?: string };
  try { body = await req.json(); } catch { return jsonError('Invalid JSON'); }

  // ── Modo 2: upload direto de imagem já renderizada (canvas do browser com branding) ──
  if (body.image_data) {
    try {
      const bytes = Uint8Array.from(atob(body.image_data), (c) => c.charCodeAt(0));
      const publicUrl = await uploadBuffer(bytes.buffer);
      if (!publicUrl) return jsonError('Falha no upload da imagem');
      return jsonOk({ url: publicUrl, stored: true });
    } catch {
      return jsonError('image_data inválido (esperado base64 JPEG)');
    }
  }

  // ── Modo 1: geração via Fal.ai + branding server-side ──
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

  // Baixa imagem bruta
  const imgRes = await fetch(tempUrl);
  if (!imgRes.ok) return jsonOk({ url: tempUrl, stored: false, branded: false });
  const rawBuffer = await imgRes.arrayBuffer();

  // Aplica branding (logo + faixa + CNPJ)
  const brandedBuffer = await applyBranding(rawBuffer);

  // Armazena imagem final
  const publicUrl = await uploadBuffer(brandedBuffer);
  return jsonOk(publicUrl
    ? { url: publicUrl, stored: true, branded: true }
    : { url: tempUrl, stored: false, branded: false }
  );
});
