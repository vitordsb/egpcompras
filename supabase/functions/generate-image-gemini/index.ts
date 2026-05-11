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

// Post-process MÍNIMO: como o próprio Nano Banana agora coloca o logo
// EGP nativamente (recebe o logo como inlineData), aqui só adiciona uma
// fina barra rosa lateral como reforço sutil da identidade visual.
// Cartão branco com logo NÃO é mais sobreposto — atrapalharia o logo que
// o Gemini já colocou organicamente.
async function applyEgpBranding(imageBuffer: ArrayBuffer, opts: CompositingOptions): Promise<ArrayBuffer> {
  if (!opts.lighterBranding) {
    // Modo branding completo (produto promocional) usa a Edge Function
    // generate-image. Aqui só aplicamos o stripe em modo lighter.
    return imageBuffer;
  }
  let img: any;
  try {
    img = await Jimp.read(Buffer.from(imageBuffer));
  } catch (err) {
    console.error('[gemini-branding] Jimp.read FAIL:', err);
    return imageBuffer;
  }
  const W = img.getWidth();
  const H = img.getHeight();
  const EGP_PINK = { r: 0xCB, g: 0x14, b: 0x64 };

  try {
    const stripeW = Math.max(4, Math.round(W * 0.008));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < stripeW; x++) {
        img.setPixelColor(Jimp.rgbaToInt(EGP_PINK.r, EGP_PINK.g, EGP_PINK.b, 255), x, y);
      }
    }
    console.log(`[gemini-branding] thin pink stripe applied ${W}x${H}`);
  } catch (err) {
    console.error('[gemini-branding] stripe FAIL:', err);
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
        console.log(`[gemini] referência carregada: ${(refBuf.byteLength / 1024).toFixed(1)}KB`);
      } else {
        console.warn(`[gemini] falha ao baixar referência: ${refRes.status}`);
      }
    } catch (err) {
      console.warn('[gemini] erro ao buscar referência:', err);
    }
  }

  // SEMPRE baixa o logo EGP e manda como input — assim o Nano Banana
  // desenha ele de verdade no flyer, integrado nativamente, em vez de
  // depender de compositing post-process por cima.
  let logoBase64: string | null = null;
  let logoMime = 'image/png';
  try {
    const logoRes = await fetch(LOGO_URL);
    if (logoRes.ok) {
      const logoBuf = await logoRes.arrayBuffer();
      logoBase64 = arrayBufferToBase64(logoBuf);
      logoMime = logoRes.headers.get('content-type') ?? 'image/png';
      console.log(`[gemini] logo EGP carregado: ${(logoBuf.byteLength / 1024).toFixed(1)}KB`);
    } else {
      console.warn(`[gemini] falha ao baixar logo: ${logoRes.status}`);
    }
  } catch (err) {
    console.warn('[gemini] erro ao buscar logo:', err);
  }

  // Monta request para Gemini Nano Banana com instruções claras de uso
  // de cada imagem. ORDEM IMPORTA — o Gemini distingue "imagem 1" vs "imagem 2"
  // pelo texto que vem ANTES de cada uma.
  const parts: any[] = [];
  if (referenceBase64) {
    parts.push({ text: 'REFERENCE IMAGE (use as visual style/composition inspiration — keep similar mood, color treatment, layout style):' });
    parts.push({ inlineData: { mimeType: referenceMime, data: referenceBase64 } });
  }
  if (logoBase64) {
    parts.push({ text: 'COMPANY LOGO (place this exact logo prominently in the bottom-left corner of the final design — must be clearly visible and recognizable, around 18-22% of image width):' });
    parts.push({ inlineData: { mimeType: logoMime, data: logoBase64 } });
  }
  parts.push({
    text:
      'TASK: Generate a high-quality social media flyer following the prompt below. ' +
      (referenceBase64 ? 'Adapt the reference image style/composition but apply the EGP brand identity and theme described. ' : '') +
      (logoBase64 ? 'INTEGRATE the EGP logo image (shown above) into the bottom-left corner of the design — keep the logo shape and colors EXACTLY as provided. Do not redraw, recreate or modify the logo — composite the actual logo image into the design. ' : '') +
      '\n\nPROMPT:\n' + prompt,
  });

  // Modelos disponíveis (em ordem de qualidade decrescente). Tenta o primeiro,
  // se falhar com 404 (modelo não existe pra essa key), cai pro próximo.
  const MODEL_FALLBACKS = [
    'gemini-3.1-flash-image-preview',
    'gemini-2.5-flash-image',
    'nano-banana-pro-preview',
  ];

  let geminiRes: Response | null = null;
  let lastErr: any = null;
  let modelUsed = '';
  for (const model of MODEL_FALLBACKS) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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
    if (r.ok) {
      geminiRes = r;
      modelUsed = model;
      console.log(`[gemini] model usado: ${model}`);
      break;
    }
    lastErr = await r.json().catch(() => ({ status: r.status }));
    console.warn(`[gemini] model ${model} falhou:`, lastErr);
    // Se foi 404/not found, tenta o próximo. Outros erros (auth, quota) param aqui.
    const errMsg = (lastErr as any).error?.message ?? '';
    if (!/not found|is not supported|404/i.test(errMsg) && r.status !== 404) {
      geminiRes = r;
      break;
    }
  }

  if (!geminiRes) {
    return jsonError((lastErr as any)?.error?.message ?? 'Nenhum modelo Gemini de imagem disponível');
  }

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
    model_used: modelUsed || 'gemini-image',
    had_reference: !!referenceBase64,
  });
});
