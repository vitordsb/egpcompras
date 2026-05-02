// Gera imagem via Fal.ai, composta produto real + branding EGP via jimp e armazena.
// FAL_KEY nunca vai pro frontend.
//
// Modos:
//   { prompt, image_size?, product_filename? }  → gera + produto + branding + armazena
//   { image_data: "<base64 JPEG>" }             → upload direto (browser já aplicou branding)

import Jimp from 'npm:jimp@0.22.12';

const FAL_KEY  = Deno.env.get('FAL_KEY') ?? '';
const SUPA_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPA_JWT = Deno.env.get('SUPA_SERVICE_JWT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const LOGO_URL = `${SUPA_URL}/storage/v1/object/public/product-images/branding/logo.png`;
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

async function uploadBuffer(buffer: ArrayBuffer | Uint8Array): Promise<string | null> {
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  const res = await fetch(`${SUPA_URL}/storage/v1/object/wa-images/${fileName}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPA_JWT}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
    body: buffer,
  });
  if (!res.ok) return null;
  return `${SUPA_URL}/storage/v1/object/public/wa-images/${fileName}`;
}

async function applyBrandingAndProduct(
  imageBuffer: ArrayBuffer,
  productFilename?: string,
): Promise<ArrayBuffer> {
  try {
    const img = await Jimp.read(Buffer.from(imageBuffer));
    const W = img.getWidth();
    const H = img.getHeight();

    // 1. Foto do produto centralizada (se fornecida)
    if (productFilename) {
      const encoded    = encodeURIComponent(`${productFilename}.png`);
      const productUrl = `${SUPA_URL}/storage/v1/object/public/product-images/products/${encoded}`;
      const pRes = await fetch(productUrl);
      if (pRes.ok) {
        const pBuf    = await pRes.arrayBuffer();
        const product = await Jimp.read(Buffer.from(pBuf));

        // Escala para caber em 55% largura × 72% altura (reserva espaço para branding)
        const maxW  = Math.round(W * 0.55);
        const maxH  = Math.round(H * 0.72);
        const scale = Math.min(maxW / product.getWidth(), maxH / product.getHeight());
        product.resize(Math.round(product.getWidth() * scale), Math.round(product.getHeight() * scale));

        const px = Math.round((W - product.getWidth())  / 2);
        const py = Math.round((H - product.getHeight()) / 2 - H * 0.04);

        // Sombra simples: clona, escurece e composta ligeiramente deslocada
        const shadow = product.clone().color([{ apply: 'darken', params: [80] }]);
        img.composite(shadow, px + 6, py + 8, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 0.35, opacityDest: 1 });
        img.composite(product, px, py, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 1, opacityDest: 1 });
      }
    }

    // 2. Faixa escura no rodapé (gradiente linha a linha)
    const stripH = Math.round(H * 0.15);
    for (let y = H - stripH; y < H; y++) {
      const t = (y - (H - stripH)) / stripH; // 0→1
      const dim = t * 0.75;
      for (let x = 0; x < W; x++) {
        const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y));
        img.setPixelColor(
          Jimp.rgbaToInt(Math.round(r * (1 - dim)), Math.round(g * (1 - dim)), Math.round(b * (1 - dim)), 255),
          x, y,
        );
      }
    }

    // 3. Logo EGP
    const logoRes = await fetch(LOGO_URL);
    if (logoRes.ok) {
      const logoBuf = await logoRes.arrayBuffer();
      const logo    = await Jimp.read(Buffer.from(logoBuf));
      const logoW   = Math.round(W * 0.24);
      logo.resize(logoW, Jimp.AUTO);
      const pad   = Math.round(W * 0.025);
      const logoY = H - logo.getHeight() - pad;
      img.composite(logo, pad, logoY, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 1, opacityDest: 1 });
    }

    // 4. CNPJ + nome (fonte bitmap jimp)
    try {
      const font  = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
      const pad   = Math.round(W * 0.025);
      const nameW = img.measureText(font, CORP_NAME);
      const cnpjW = img.measureText(font, CNPJ_TEXT);
      img.print(font, W - nameW - pad, H - 44, CORP_NAME);
      img.print(font, W - cnpjW - pad, H - 24, CNPJ_TEXT);
    } catch { /* fallback silencioso */ }

    const buf = await img.getBufferAsync(Jimp.MIME_JPEG);
    return (buf as Buffer).buffer as ArrayBuffer;
  } catch (err) {
    console.error('applyBrandingAndProduct error:', err);
    return imageBuffer; // fallback: imagem sem modificação
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body: { prompt?: string; image_size?: string; image_data?: string; product_filename?: string };
  try { body = await req.json(); } catch { return jsonError('Invalid JSON'); }

  // ── Modo upload direto (browser já fez o compositing) ──
  if (body.image_data) {
    try {
      const bytes = Uint8Array.from(atob(body.image_data), (c) => c.charCodeAt(0));
      const url   = await uploadBuffer(bytes.buffer);
      if (!url) return jsonError('Falha no upload da imagem');
      return jsonOk({ url, stored: true });
    } catch {
      return jsonError('image_data inválido');
    }
  }

  // ── Modo geração via Fal.ai ──
  const { prompt, image_size = 'landscape_4_3', product_filename } = body;
  if (!prompt?.trim()) return jsonError('prompt ou image_data é obrigatório');

  const falRes = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt.trim(), image_size, num_inference_steps: 4, num_images: 1, enable_safety_checker: true }),
  });

  if (!falRes.ok) {
    const err = await falRes.json().catch(() => ({}));
    return jsonError((err as any).detail ?? `Fal.ai error ${falRes.status}`);
  }

  const falData = await falRes.json();
  const tempUrl: string | undefined = falData.images?.[0]?.url;
  if (!tempUrl) return jsonError('Fal.ai não retornou imagem');

  const imgRes = await fetch(tempUrl);
  if (!imgRes.ok) return jsonOk({ url: tempUrl, stored: false, branded: false });

  const rawBuffer    = await imgRes.arrayBuffer();
  const brandedBuffer = await applyBrandingAndProduct(rawBuffer, product_filename ?? undefined);

  const publicUrl = await uploadBuffer(brandedBuffer);
  return jsonOk(publicUrl
    ? { url: publicUrl, stored: true, branded: true }
    : { url: tempUrl, stored: false, branded: false }
  );
});
