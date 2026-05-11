// Gera imagem via Fal.ai, composta produto real + branding EGP via jimp e armazena.
// FAL_KEY nunca vai pro frontend.
//
// Modos:
//   { prompt, image_size?, product_filename?, model?, reference_image_url?,
//     skip_product_overlay?, lighter_branding? }  → gera + composição + armazena
//   { image_data: "<base64 JPEG>" }               → upload direto

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

interface CompositingOptions {
  productFilename?: string;
  skipProductOverlay?: boolean;
  lighterBranding?: boolean;
}

async function applyBrandingAndProduct(
  imageBuffer: ArrayBuffer,
  opts: CompositingOptions,
): Promise<ArrayBuffer> {
  try {
    const img = await Jimp.read(Buffer.from(imageBuffer));
    const W = img.getWidth();
    const H = img.getHeight();

    // 1. Foto do produto centralizada (apenas se NÃO for skip_product_overlay)
    if (opts.productFilename && !opts.skipProductOverlay) {
      const encoded    = encodeURIComponent(`${opts.productFilename}.png`);
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

    // 2. Faixa escura no rodapé (apenas no modo branding completo)
    //    Em lighterBranding (flyers comemorativos com texto da própria IA),
    //    pula a faixa pra não cobrir o design — só o logo no canto.
    if (!opts.lighterBranding) {
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
    }

    // 3. Logo EGP no canto inferior esquerdo
    //    Em lighterBranding (flyer): logo maior + texto "EGP" ao lado +
    //    barra rosa fina na lateral esquerda pra reforçar identidade.
    const EGP_PINK = { r: 0xCB, g: 0x14, b: 0x64 }; // #CB1464

    if (opts.lighterBranding) {
      // Barra rosa vertical fina na lateral esquerda — accent visual da marca
      const stripeW = Math.max(4, Math.round(W * 0.008));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < stripeW; x++) {
          img.setPixelColor(
            Jimp.rgbaToInt(EGP_PINK.r, EGP_PINK.g, EGP_PINK.b, 255),
            x, y,
          );
        }
      }
    }

    const logoRes = await fetch(LOGO_URL);
    if (logoRes.ok) {
      const logoBuf = await logoRes.arrayBuffer();
      const logo    = await Jimp.read(Buffer.from(logoBuf));
      // Logo: 22% no lighterBranding (era 16%), 24% no completo
      const logoW   = Math.round(W * (opts.lighterBranding ? 0.22 : 0.24));
      logo.resize(logoW, Jimp.AUTO);
      const pad   = Math.round(W * 0.03);
      const logoY = H - logo.getHeight() - pad;

      // Em lighterBranding, adiciona "cartão" branco arredondado atrás do
      // logo + nome "EGP" ao lado em fonte grande pra reforçar a marca.
      if (opts.lighterBranding) {
        // Carrega fonte grande pro nome EGP
        let egpFont: any = null;
        try {
          egpFont = await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);
        } catch { /* fallback */ }

        const egpText = 'EGP';
        const textW = egpFont ? img.measureText(egpFont, egpText) : 0;
        const textH = egpFont ? img.measureTextHeight(egpFont, egpText, textW) : 0;
        const gap   = Math.round(W * 0.015);

        // Cartão branco que envolve logo + texto
        const cardPad = Math.round(W * 0.018);
        const cardW   = logo.getWidth() + (egpFont ? gap + textW : 0) + cardPad * 2;
        const cardH   = Math.max(logo.getHeight(), textH) + cardPad * 2;
        const cardX   = pad - cardPad;
        const cardY   = H - cardH - pad + cardPad;

        for (let y = Math.max(0, cardY); y < Math.min(H, cardY + cardH); y++) {
          for (let x = Math.max(0, cardX); x < Math.min(W, cardX + cardW); x++) {
            // Branco sólido com leve transparência onde tem fundo escuro
            const c = Jimp.intToRGBA(img.getPixelColor(x, y));
            img.setPixelColor(
              Jimp.rgbaToInt(
                Math.round(c.r * 0.06 + 255 * 0.94),
                Math.round(c.g * 0.06 + 255 * 0.94),
                Math.round(c.b * 0.06 + 255 * 0.94),
                255,
              ),
              x, y,
            );
          }
        }

        // Borda rosa fina embaixo do cartão (acent EGP)
        const borderH = Math.max(2, Math.round(W * 0.004));
        for (let y = cardY + cardH - borderH; y < cardY + cardH; y++) {
          for (let x = Math.max(0, cardX); x < Math.min(W, cardX + cardW); x++) {
            img.setPixelColor(
              Jimp.rgbaToInt(EGP_PINK.r, EGP_PINK.g, EGP_PINK.b, 255),
              x, y,
            );
          }
        }

        // Logo (centralizado verticalmente no cartão)
        const logoYInCard = cardY + Math.round((cardH - logo.getHeight()) / 2);
        img.composite(logo, pad, logoYInCard, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 1, opacityDest: 1 });

        // Texto "EGP" ao lado direito do logo
        if (egpFont) {
          const textX = pad + logo.getWidth() + gap;
          const textY = cardY + Math.round((cardH - textH) / 2);
          img.print(egpFont, textX, textY, egpText);
        }
      } else {
        // Branding completo (não-flyer) — logo simples no canto
        img.composite(logo, pad, logoY, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 1, opacityDest: 1 });
      }
    }

    // 4. CNPJ + nome (apenas no branding completo — em flyers fica poluído)
    if (!opts.lighterBranding) {
      try {
        const font  = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
        const pad   = Math.round(W * 0.025);
        const nameW = img.measureText(font, CORP_NAME);
        const cnpjW = img.measureText(font, CNPJ_TEXT);
        img.print(font, W - nameW - pad, H - 44, CORP_NAME);
        img.print(font, W - cnpjW - pad, H - 24, CNPJ_TEXT);
      } catch { /* fallback silencioso */ }
    }

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

  let body: {
    prompt?: string;
    image_size?: string;
    image_data?: string;
    product_filename?: string;
    model?: 'schnell' | 'dev';
    reference_image_url?: string;
    skip_product_overlay?: boolean;
    lighter_branding?: boolean;
  };
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
  const {
    prompt,
    image_size = 'landscape_4_3',
    product_filename,
    model = 'schnell',
    reference_image_url,
    skip_product_overlay = false,
    lighter_branding = false,
  } = body;
  if (!prompt?.trim()) return jsonError('prompt ou image_data é obrigatório');

  // Escolha do endpoint:
  //   - schnell: 4 steps, rápido, texto na imagem médio
  //   - dev:     28 steps, lento, texto bem renderizado (ideal pra flyer)
  //   - dev img2img: usa reference_image_url como base
  let endpoint: string;
  let payload: Record<string, unknown>;

  if (reference_image_url) {
    endpoint = 'https://fal.run/fal-ai/flux/dev/image-to-image';
    payload = {
      prompt: prompt.trim(),
      image_url: reference_image_url,
      strength: 0.75, // 0=igual à referência, 1=ignora
      num_inference_steps: 28,
      num_images: 1,
      enable_safety_checker: true,
    };
  } else if (model === 'dev') {
    endpoint = 'https://fal.run/fal-ai/flux/dev';
    payload = {
      prompt: prompt.trim(),
      image_size,
      num_inference_steps: 28,
      num_images: 1,
      enable_safety_checker: true,
    };
  } else {
    endpoint = 'https://fal.run/fal-ai/flux/schnell';
    payload = {
      prompt: prompt.trim(),
      image_size,
      num_inference_steps: 4,
      num_images: 1,
      enable_safety_checker: true,
    };
  }

  const falRes = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

  const rawBuffer = await imgRes.arrayBuffer();
  const brandedBuffer = await applyBrandingAndProduct(rawBuffer, {
    productFilename: product_filename,
    skipProductOverlay: skip_product_overlay,
    lighterBranding: lighter_branding,
  });

  const publicUrl = await uploadBuffer(brandedBuffer);
  return jsonOk(publicUrl
    ? { url: publicUrl, stored: true, branded: true, model_used: reference_image_url ? 'flux-dev-img2img' : `flux-${model}` }
    : { url: tempUrl, stored: false, branded: false, model_used: reference_image_url ? 'flux-dev-img2img' : `flux-${model}` }
  );
});
