// Geração/edição de imagem via Gemini 2.5 Flash Image (Nano Banana).
// Usado pelos flyers comemorativos: aceita prompt + imagem de referência
// opcional. Aplica branding EGP via Jimp e armazena em wa-images.
//
// Body:
//   { prompt, reference_image_url?, skip_product_overlay?, lighter_branding? }

import Jimp from 'npm:jimp@0.22.12';

const GEMINI_API_KEY =
  Deno.env.get('GEMINI_API_KEY') ??
  Deno.env.get('VITE_GEMINI_API_KEY') ??
  '';
const SUPA_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPA_JWT = Deno.env.get('SUPA_SERVICE_JWT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const LOGO_URL = `${SUPA_URL}/storage/v1/object/public/product-images/branding/logo.png`;

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

interface CompositingOptions {
  skipProductOverlay?: boolean;
  lighterBranding?: boolean;
}

// Reusa exatamente a mesma lógica do generate-image: barra rosa lateral +
// cartão branco com logo + "EGP" + bordas rosa. Try/catch granular.
async function applyEgpBranding(imageBuffer: ArrayBuffer, opts: CompositingOptions): Promise<ArrayBuffer> {
  let img: any;
  try {
    img = await Jimp.read(Buffer.from(imageBuffer));
  } catch (err) {
    console.error('[gemini-branding] Jimp.read FAIL:', err);
    return imageBuffer;
  }
  const W = img.getWidth();
  const H = img.getHeight();
  console.log(`[gemini-branding] start: ${W}x${H}, lighter=${opts.lighterBranding}`);

  const EGP_PINK = { r: 0xCB, g: 0x14, b: 0x64 };
  const pad = Math.round(W * 0.03);

  try {
    // 1. Barra rosa lateral
    if (opts.lighterBranding) {
      try {
        const stripeW = Math.max(6, Math.round(W * 0.012));
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < stripeW; x++) {
            img.setPixelColor(Jimp.rgbaToInt(EGP_PINK.r, EGP_PINK.g, EGP_PINK.b, 255), x, y);
          }
        }
        console.log('[gemini-branding] stripe OK');
      } catch (e) { console.error('[gemini-branding] stripe FAIL:', e); }
    }

    // 2. Cartão EGP no canto
    if (opts.lighterBranding) {
      let logo: any = null;
      try {
        const logoRes = await fetch(LOGO_URL);
        if (logoRes.ok) {
          const logoBuf = await logoRes.arrayBuffer();
          logo = await Jimp.read(Buffer.from(logoBuf));
          const logoW = Math.round(W * 0.20);
          logo.resize(logoW, Jimp.AUTO);
        }
      } catch (e) { console.error('[gemini-branding] logo FAIL:', e); }

      let egpFont: any = null;
      for (const f of [Jimp.FONT_SANS_64_BLACK, Jimp.FONT_SANS_32_BLACK, Jimp.FONT_SANS_16_BLACK]) {
        try { egpFont = await Jimp.loadFont(f); break; } catch { /* try next */ }
      }

      try {
        const egpText = 'EGP';
        const textW = egpFont ? img.measureText(egpFont, egpText) : 0;
        const textH = egpFont ? img.measureTextHeight(egpFont, egpText, textW) : 0;
        const gap = Math.round(W * 0.015);
        const logoW = logo ? logo.getWidth() : 0;
        const logoH = logo ? logo.getHeight() : 0;
        const contentH = Math.max(logoH, textH);
        const contentW = logoW + (egpFont && logoW > 0 ? gap : 0) + textW;
        const cardPad = Math.round(W * 0.022);
        const cardW = contentW + cardPad * 2;
        const cardH = contentH + cardPad * 2;
        const cardX = pad;
        const cardY = H - cardH - pad;

        // Cartão branco
        for (let y = Math.max(0, cardY); y < Math.min(H, cardY + cardH); y++) {
          for (let x = Math.max(0, cardX); x < Math.min(W, cardX + cardW); x++) {
            img.setPixelColor(Jimp.rgbaToInt(255, 255, 255, 255), x, y);
          }
        }
        // Borda rosa
        const borderH = Math.max(3, Math.round(W * 0.005));
        for (let y = cardY + cardH; y < cardY + cardH + borderH && y < H; y++) {
          for (let x = Math.max(0, cardX); x < Math.min(W, cardX + cardW); x++) {
            img.setPixelColor(Jimp.rgbaToInt(EGP_PINK.r, EGP_PINK.g, EGP_PINK.b, 255), x, y);
          }
        }
        for (let y = Math.max(0, cardY - borderH); y < cardY; y++) {
          for (let x = Math.max(0, cardX); x < Math.min(W, cardX + cardW); x++) {
            img.setPixelColor(Jimp.rgbaToInt(EGP_PINK.r, EGP_PINK.g, EGP_PINK.b, 255), x, y);
          }
        }
        if (logo) {
          const logoYInCard = cardY + Math.round((cardH - logoH) / 2);
          img.composite(logo, cardX + cardPad, logoYInCard, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 1, opacityDest: 1 });
        }
        if (egpFont) {
          const textX = cardX + cardPad + logoW + (logoW > 0 ? gap : 0);
          const textY = cardY + Math.round((cardH - textH) / 2);
          img.print(egpFont, textX, textY, egpText);
        }
        if (!logo && !egpFont) {
          const fbSize = Math.round(W * 0.08);
          for (let y = H - fbSize - pad; y < H - pad && y < H; y++) {
            for (let x = pad; x < pad + fbSize && x < W; x++) {
              img.setPixelColor(Jimp.rgbaToInt(EGP_PINK.r, EGP_PINK.g, EGP_PINK.b, 255), x, y);
            }
          }
        }
        console.log('[gemini-branding] card OK');
      } catch (e) { console.error('[gemini-branding] card FAIL:', e); }
    }
  } catch (err) {
    console.error('[gemini-branding] outer FAIL:', err);
  }

  try {
    const buf = await img.getBufferAsync(Jimp.MIME_JPEG);
    return (buf as Buffer).buffer as ArrayBuffer;
  } catch (err) {
    console.error('[gemini-branding] serialize FAIL:', err);
    return imageBuffer;
  }
}

// Converte ArrayBuffer pra base64 sem estourar memory pra imagens grandes
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  if (!GEMINI_API_KEY) return jsonError('GEMINI_API_KEY não configurada no projeto Supabase', 500);

  let body: {
    prompt?: string;
    reference_image_url?: string;
    skip_product_overlay?: boolean;
    lighter_branding?: boolean;
  };
  try { body = await req.json(); } catch { return jsonError('Invalid JSON'); }

  const prompt = (body.prompt ?? '').trim();
  if (!prompt) return jsonError('prompt é obrigatório');

  // Baixa imagem de referência (se houver) e converte pra base64
  let referenceBase64: string | null = null;
  let referenceMime = 'image/jpeg';
  if (body.reference_image_url) {
    try {
      const refRes = await fetch(body.reference_image_url);
      if (refRes.ok) {
        const refBuf = await refRes.arrayBuffer();
        referenceBase64 = arrayBufferToBase64(refBuf);
        referenceMime = refRes.headers.get('content-type') ?? 'image/jpeg';
        console.log(`[gemini] referência carregada: ${(refBuf.byteLength / 1024).toFixed(1)}KB, mime=${referenceMime}`);
      } else {
        console.warn(`[gemini] falha ao baixar referência: ${refRes.status}`);
      }
    } catch (err) {
      console.warn('[gemini] erro ao buscar referência:', err);
    }
  }

  // Monta request para Gemini 2.5 Flash Image (Nano Banana)
  const parts: any[] = [{ text: prompt }];
  if (referenceBase64) {
    parts.push({ inlineData: { mimeType: referenceMime, data: referenceBase64 } });
  }

  const geminiRes = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          temperature: 0.8,
        },
      }),
    },
  );

  if (!geminiRes.ok) {
    const errJson = await geminiRes.json().catch(() => ({}));
    console.error('[gemini] error:', errJson);
    return jsonError((errJson as any).error?.message ?? `Gemini API error ${geminiRes.status}`);
  }

  const data = await geminiRes.json();
  const imagePart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
  if (!imagePart?.inlineData?.data) {
    console.error('[gemini] sem inlineData no retorno:', JSON.stringify(data).slice(0, 500));
    return jsonError('Gemini não retornou imagem — tente reformular o prompt');
  }

  const rawBuffer = Uint8Array.from(atob(imagePart.inlineData.data), (c) => c.charCodeAt(0)).buffer;
  const brandedBuffer = await applyEgpBranding(rawBuffer, {
    skipProductOverlay: body.skip_product_overlay ?? true,
    lighterBranding: body.lighter_branding ?? true,
  });

  const publicUrl = await uploadBuffer(brandedBuffer);
  return jsonOk({
    url: publicUrl,
    stored: !!publicUrl,
    branded: true,
    model_used: 'gemini-nano-banana',
    had_reference: !!referenceBase64,
  });
});
