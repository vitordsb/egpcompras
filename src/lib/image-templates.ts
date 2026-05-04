// Renderização canvas de templates de marketing EGP.
// Cada template é uma função pura que desenha num HTMLCanvasElement.

import logoSrc from '@/images/letreirosemfundo.png';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'price' | 'color' | 'textarea';

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  categoryLabel: string;
  description: string;
  supportsProduct: boolean;
  canvasW: number;
  canvasH: number;
  fields: TemplateField[];
  render: (
    canvas: HTMLCanvasElement,
    data: Record<string, string>,
    productImg: HTMLImageElement | null,
  ) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────────

export function loadImg(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const R = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + R, y);
  ctx.lineTo(x + w - R, y);
  ctx.arcTo(x + w, y, x + w, y + R, R);
  ctx.lineTo(x + w, y + h - R);
  ctx.arcTo(x + w, y + h, x + w - R, y + h, R);
  ctx.lineTo(x + R, y + h);
  ctx.arcTo(x, y + h, x, y + h - R, R);
  ctx.lineTo(x, y + R);
  ctx.arcTo(x, y, x + R, y, R);
  ctx.closePath();
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function adj(hex: string, d: number): string {
  const [r, g, b] = hexRgb(hex);
  const c = (v: number) => Math.max(0, Math.min(255, v + d)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Texto com wrap, retorna Y final
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): number {
  let line = '', cy = y;
  for (const word of text.split(' ')) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, cy);
      line = word + ' ';
      cy += lh;
    } else { line = test; }
  }
  if (line.trim()) ctx.fillText(line.trim(), x, cy);
  return cy + lh;
}

// Barra inferior com logo EGP + CNPJ
async function brandBar(ctx: CanvasRenderingContext2D, W: number, H: number, cor: string) {
  const h = 76, y = H - h;

  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(0, y, W, h);

  // Faixa de acento colorida
  ctx.fillStyle = cor;
  ctx.fillRect(0, y, W, 3);

  // Linha sutil de separação
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, y + 3); ctx.lineTo(W, y + 3); ctx.stroke();

  // Logo
  try {
    const logo = await loadImg(logoSrc);
    const lH = 32, lW = lH * (446 / 155);
    ctx.globalAlpha = 0.92;
    ctx.drawImage(logo, 24, y + (h - lH) / 2, lW, lH);
    ctx.globalAlpha = 1;
  } catch { /* sem logo */ }

  // Textos
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '11px system-ui, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('EGP IND E COM LTDA', W - 20, y + h * 0.35);
  ctx.fillText('CNPJ: 40.116.124/0001-51', W - 20, y + h * 0.65);
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 1 — PROMOÇÃO
// Layout: fundo gradiente colorido → produto grande → card branco embaixo
// ─────────────────────────────────────────────────────────────────────────────

async function renderPromocao(
  canvas: HTMLCanvasElement,
  data: Record<string, string>,
  productImg: HTMLImageElement | null,
) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const cor = data.cor || '#1d8348';
  const corEsc = adj(cor, -40);
  const CARD_Y = Math.round(H * 0.565);

  // ── Fundo gradiente ──
  const bg = ctx.createLinearGradient(0, 0, W * 0.7, H * 0.6);
  bg.addColorStop(0, adj(cor, 15));
  bg.addColorStop(1, corEsc);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Padrão de pontos sutis (grid)
  ctx.fillStyle = rgba(cor, 0.12);
  for (let x = 0; x < W; x += 38)
    for (let y = 0; y < CARD_Y; y += 38) {
      ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
    }

  // Círculo de luz atrás do produto
  const glow = ctx.createRadialGradient(W / 2, CARD_Y * 0.46, 30, W / 2, CARD_Y * 0.46, 280);
  glow.addColorStop(0, rgba('#ffffff', 0.22));
  glow.addColorStop(1, rgba('#ffffff', 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, CARD_Y);

  // ── Produto ──
  if (productImg) {
    const maxW = W * 0.6, maxH = CARD_Y * 0.78;
    const scale = Math.min(maxW / productImg.naturalWidth, maxH / productImg.naturalHeight);
    const pW = productImg.naturalWidth * scale;
    const pH = productImg.naturalHeight * scale;
    const px = (W - pW) / 2;
    const py = (CARD_Y * 0.92 - pH) / 2 + 20;

    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 14;
    ctx.drawImage(productImg, px, py, pW, pH);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }

  // ── Card branco inferior (rounded top) ──
  ctx.fillStyle = '#ffffff';
  rr(ctx, 0, CARD_Y, W, H - CARD_Y, 28);
  ctx.fill();

  // Sombra sutil no topo do card
  const cardShadow = ctx.createLinearGradient(0, CARD_Y - 20, 0, CARD_Y + 30);
  cardShadow.addColorStop(0, 'rgba(0,0,0,0.10)');
  cardShadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cardShadow;
  ctx.fillRect(0, CARD_Y - 20, W, 50);

  // ── Badge flutuando na borda do card ──
  const badgeLines = (data.badge || 'PROMOÇÃO ESPECIAL').split('\n');
  const badgeW = 196, badgeH = 48, badgeBY = CARD_Y - 24;

  ctx.fillStyle = '#f5c518';
  rr(ctx, 24, badgeBY, badgeW, badgeH, 24);
  ctx.fill();

  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (badgeLines.length === 1) {
    ctx.font = 'bold 15px system-ui, Arial, sans-serif';
    ctx.fillText(badgeLines[0], 24 + badgeW / 2, badgeBY + badgeH / 2);
  } else {
    ctx.font = 'bold 11px system-ui, Arial, sans-serif';
    ctx.fillText(badgeLines[0], 24 + badgeW / 2, badgeBY + badgeH * 0.33);
    ctx.font = 'bold 16px system-ui, Arial, sans-serif';
    ctx.fillText(badgeLines[1], 24 + badgeW / 2, badgeBY + badgeH * 0.69);
  }

  // Badge % OFF (canto direito)
  if (data.preco_original && data.preco_promocional) {
    const orig = parseFloat(data.preco_original.replace(',', '.'));
    const sale = parseFloat(data.preco_promocional.replace(',', '.'));
    if (orig > 0 && sale > 0 && sale < orig) {
      const pct = Math.round((1 - sale / orig) * 100);
      const cx = W - 66, cy = CARD_Y - 10;
      ctx.fillStyle = cor;
      ctx.beginPath(); ctx.arc(cx, cy, 48, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px system-ui, Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${pct}%`, cx, cy - 9);
      ctx.font = 'bold 14px system-ui, Arial, sans-serif';
      ctx.fillText('OFF', cx, cy + 15);
    }
  }

  // ── Conteúdo do card ──
  const PX = 28, textY = CARD_Y + 44;

  // Nome do produto
  const nome = (data.produto || 'PRODUTO').toUpperCase();
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = `bold ${nome.length > 22 ? 22 : nome.length > 14 ? 26 : 30}px system-ui, Arial, sans-serif`;
  const nextY = wrapText(ctx, nome, PX, textY, W - PX * 2 - 70, 36);

  // Descrição
  if (data.descricao) {
    ctx.fillStyle = '#666666';
    ctx.font = '15px system-ui, Arial, sans-serif';
    wrapText(ctx, data.descricao, PX, nextY - 6, W - PX * 2, 22);
  }

  // Divisor
  const divY = nextY + (data.descricao ? 26 : 8);
  ctx.strokeStyle = '#eeeeee';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PX, divY); ctx.lineTo(W - PX, divY); ctx.stroke();

  // Preço original
  const priceAreaY = divY + 18;
  if (data.preco_original) {
    const txt = `De R$ ${data.preco_original}`;
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '15px system-ui, Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, PX, priceAreaY);
    const tw = ctx.measureText(txt).width;
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(PX, priceAreaY); ctx.lineTo(PX + tw, priceAreaY); ctx.stroke();
  }

  // Preço promocional
  const bigPriceY = priceAreaY + (data.preco_original ? 34 : 8);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = cor;
  ctx.font = '16px system-ui, Arial, sans-serif';
  ctx.fillText('por', PX, bigPriceY);
  ctx.font = `bold ${(data.preco_promocional || '').length > 8 ? 44 : 52}px system-ui, Arial, sans-serif`;
  ctx.fillText(`R$ ${data.preco_promocional || '—'}`, PX + 38, bigPriceY);

  // Condição
  if (data.condicao) {
    ctx.fillStyle = '#888888';
    ctx.font = '13px system-ui, Arial, sans-serif';
    ctx.fillText(data.condicao, PX, bigPriceY + 36);
  }

  // Condições no rodapé
  if (data.condicoes) {
    ctx.fillStyle = '#bbbbbb';
    ctx.font = '10px system-ui, Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(data.condicoes, PX, H - 80);
  }

  await brandBar(ctx, W, H, cor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 2 — FERIADO / AVISO
// Layout: fundo gradiente rico + ornamentos + tipografia centrada elegante
// ─────────────────────────────────────────────────────────────────────────────

async function renderFeriado(
  canvas: HTMLCanvasElement,
  data: Record<string, string>,
  _productImg: HTMLImageElement | null,
) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const cor = data.cor || '#1a56a0';

  // ── Fundo gradiente diagonal ──
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, adj(cor, 30));
  bg.addColorStop(0.5, cor);
  bg.addColorStop(1, adj(cor, -50));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Padrão losangos sutis
  ctx.strokeStyle = rgba('#ffffff', 0.04);
  ctx.lineWidth = 1;
  for (let i = -W; i < W * 2; i += 60) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H * 0.6, H); ctx.stroke();
  }

  // Círculo decorativo grande (topo direito)
  ctx.fillStyle = rgba('#ffffff', 0.05);
  ctx.beginPath(); ctx.arc(W * 0.88, -H * 0.05, H * 0.42, 0, Math.PI * 2); ctx.fill();

  // Círculo menor (baixo esquerdo)
  ctx.fillStyle = rgba('#ffffff', 0.04);
  ctx.beginPath(); ctx.arc(W * 0.08, H * 0.88, H * 0.28, 0, Math.PI * 2); ctx.fill();

  // ── Logo EGP centrado no topo ──
  try {
    const logo = await loadImg(logoSrc);
    const lH = 42, lW = lH * (446 / 155);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(logo, (W - lW) / 2, 52, lW, lH);
    ctx.globalAlpha = 1;
  } catch { /* ignore */ }

  // Ornamento linha com diamante central
  const lineY = 118;
  ctx.strokeStyle = rgba('#ffffff', 0.28);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(60, lineY); ctx.lineTo(W * 0.38, lineY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W * 0.62, lineY); ctx.lineTo(W - 60, lineY); ctx.stroke();
  // Diamante
  ctx.fillStyle = rgba('#ffffff', 0.4);
  ctx.save();
  ctx.translate(W / 2, lineY);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-5, -5, 10, 10);
  ctx.restore();

  // ── Título principal ──
  const titulo = (data.titulo || 'TÍTULO AQUI');
  const tLines = titulo.split('\n');
  const maxLen = Math.max(...tLines.map(l => l.length));
  const tSize = maxLen > 16 ? 52 : maxLen > 10 ? 62 : 72;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const tTotalH = tLines.length * (tSize + 8);
  const tStartY = H * 0.3 - tTotalH / 2 + 40;

  tLines.forEach((line, i) => {
    const y = tStartY + i * (tSize + 8);
    // Sombra suave
    ctx.fillStyle = rgba('#000000', 0.2);
    ctx.font = `bold ${tSize}px system-ui, Arial, sans-serif`;
    ctx.fillText(line, W / 2 + 2, y + 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, W / 2, y);
  });

  // Subtítulo
  if (data.subtitulo) {
    const subY = tStartY + tLines.length * (tSize + 8) + 18;
    ctx.fillStyle = rgba('#ffffff', 0.80);
    ctx.font = `300 24px system-ui, Arial, sans-serif`;
    ctx.fillText(data.subtitulo, W / 2, subY);
  }

  // ── Mensagem em card frosted glass ──
  if (data.mensagem) {
    const mLines = data.mensagem.split('\n');
    const cardPad = 32, lineH = 28;
    const cardH = mLines.length * lineH + cardPad * 2;
    const cardY = H * 0.55;

    // Card
    ctx.fillStyle = rgba('#ffffff', 0.10);
    rr(ctx, 60, cardY, W - 120, cardH, 20);
    ctx.fill();
    ctx.strokeStyle = rgba('#ffffff', 0.18);
    ctx.lineWidth = 1;
    rr(ctx, 60, cardY, W - 120, cardH, 20);
    ctx.stroke();

    // Texto
    ctx.fillStyle = '#ffffff';
    ctx.font = `18px system-ui, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const mStart = cardY + cardPad;
    mLines.forEach((line, i) => ctx.fillText(line, W / 2, mStart + i * lineH));
  }

  // ── Data ──
  if (data.data) {
    ctx.fillStyle = rgba('#ffffff', 0.55);
    ctx.font = '14px system-ui, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(data.data.toUpperCase(), W / 2, H - 98);
  }

  await brandBar(ctx, W, H, adj(cor, 40));
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 3 — LANÇAMENTO
// Layout: fundo escuro cinematográfico + produto com halo + preço grande
// ─────────────────────────────────────────────────────────────────────────────

async function renderLancamento(
  canvas: HTMLCanvasElement,
  data: Record<string, string>,
  productImg: HTMLImageElement | null,
) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const cor = data.cor || '#1a56db';

  // ── Fundo escuro com vinheta ──
  ctx.fillStyle = '#080c10';
  ctx.fillRect(0, 0, W, H);

  // Gradiente radial sutil no centro
  const centerGlow = ctx.createRadialGradient(W / 2, H * 0.38, 0, W / 2, H * 0.38, W * 0.55);
  centerGlow.addColorStop(0, rgba(cor, 0.18));
  centerGlow.addColorStop(1, rgba(cor, 0));
  ctx.fillStyle = centerGlow;
  ctx.fillRect(0, 0, W, H);

  // Linhas horizontais de luz (speed lines)
  ctx.strokeStyle = rgba(cor, 0.06);
  ctx.lineWidth = 1;
  for (let i = 0; i < H; i += 22) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
  }

  // ── Badge topo ──
  const badge = (data.badge || 'LANÇAMENTO').toUpperCase();
  const bMetrics = ctx.measureText(badge);
  ctx.font = 'bold 15px system-ui, Arial, sans-serif';
  const bW = bMetrics.width + 52, bH = 42;
  const bX = (W - bW) / 2, bY = 52;

  ctx.fillStyle = cor;
  rr(ctx, bX, bY, bW, bH, bH / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(badge, W / 2, bY + bH / 2);

  // ── Halo circular atrás do produto ──
  const haloGrad = ctx.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H * 0.42, 300);
  haloGrad.addColorStop(0, rgba(cor, 0.22));
  haloGrad.addColorStop(0.5, rgba(cor, 0.06));
  haloGrad.addColorStop(1, rgba(cor, 0));
  ctx.fillStyle = haloGrad;
  ctx.fillRect(0, 0, W, H * 0.78);

  // Anel externo
  ctx.strokeStyle = rgba(cor, 0.12);
  ctx.lineWidth = 80;
  ctx.beginPath(); ctx.arc(W / 2, H * 0.42, 290, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = rgba(cor, 0.06);
  ctx.lineWidth = 30;
  ctx.beginPath(); ctx.arc(W / 2, H * 0.42, 360, 0, Math.PI * 2); ctx.stroke();

  // ── Produto ──
  if (productImg) {
    const maxW = W * 0.65, maxH = H * 0.46;
    const scale = Math.min(maxW / productImg.naturalWidth, maxH / productImg.naturalHeight);
    const pW = productImg.naturalWidth * scale;
    const pH = productImg.naturalHeight * scale;
    const px = (W - pW) / 2, py = 110 + (H * 0.46 - pH) / 2;

    // Glow colorido sob o produto
    ctx.shadowColor = rgba(cor, 0.65);
    ctx.shadowBlur = 60;
    ctx.drawImage(productImg, px, py, pW, pH);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  }

  // ── Linha separadora ──
  const sepY = H * 0.66;
  const sepGrad = ctx.createLinearGradient(60, 0, W - 60, 0);
  sepGrad.addColorStop(0, rgba('#ffffff', 0));
  sepGrad.addColorStop(0.5, rgba('#ffffff', 0.2));
  sepGrad.addColorStop(1, rgba('#ffffff', 0));
  ctx.strokeStyle = sepGrad;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(60, sepY); ctx.lineTo(W - 60, sepY); ctx.stroke();

  // ── Nome do produto ──
  const prodName = (data.produto || 'NOME DO PRODUTO').toUpperCase();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const pnSize = prodName.length > 22 ? 24 : prodName.length > 14 ? 28 : 34;
  ctx.font = `bold ${pnSize}px system-ui, Arial, sans-serif`;
  ctx.fillText(prodName, W / 2, sepY + 44);

  // Slogan / descrição
  if (data.descricao) {
    ctx.fillStyle = rgba('#ffffff', 0.45);
    ctx.font = '16px system-ui, Arial, sans-serif';
    ctx.fillText(data.descricao, W / 2, sepY + 82);
  }

  // ── Preço ──
  if (data.preco_promocional) {
    const prY = sepY + (data.descricao ? 140 : 120);

    // Pill de fundo para o preço
    ctx.fillStyle = rgba(cor, 0.15);
    rr(ctx, W * 0.18, prY - 40, W * 0.64, 82, 16);
    ctx.fill();
    ctx.strokeStyle = rgba(cor, 0.35);
    ctx.lineWidth = 1;
    rr(ctx, W * 0.18, prY - 40, W * 0.64, 82, 16);
    ctx.stroke();

    ctx.fillStyle = adj(cor, 80);
    ctx.font = `bold 54px system-ui, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`R$ ${data.preco_promocional}`, W / 2, prY);

    if (data.condicao) {
      ctx.fillStyle = rgba('#ffffff', 0.4);
      ctx.font = '13px system-ui, Arial, sans-serif';
      ctx.fillText(data.condicao, W / 2, prY + 36);
    }
  }

  await brandBar(ctx, W, H, cor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de templates exportado
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'promocao',
    name: 'Promoção de Produto',
    categoryLabel: 'Promoção',
    description: 'Produto em destaque com card de preço e badge de desconto',
    supportsProduct: true,
    canvasW: 800,
    canvasH: 1000,
    render: renderPromocao,
    fields: [
      { key: 'produto',           label: 'Nome do Produto',            type: 'text',  placeholder: 'Controle 2 Botões EGP', required: true },
      { key: 'descricao',         label: 'Descrição curta',            type: 'text',  placeholder: 'Sem fio, alcance 30m' },
      { key: 'preco_original',    label: 'Preço "De:" (riscado)',      type: 'price', placeholder: '199,90' },
      { key: 'preco_promocional', label: 'Preço "Por:"',               type: 'price', placeholder: '149,90', required: true },
      { key: 'condicao',          label: 'Condição de pagamento',      type: 'text',  placeholder: 'à vista', defaultValue: 'à vista' },
      { key: 'badge',             label: 'Texto do badge',             type: 'text',  placeholder: 'OFERTAÇO\nNA ÁREA', defaultValue: 'PROMOÇÃO\nESPECIAL', hint: 'Use \\n para quebrar linha' },
      { key: 'condicoes',         label: 'Condições (rodapé pequeno)', type: 'text',  placeholder: 'Oferta válida até 31/05/2026.' },
      { key: 'cor',               label: 'Cor do tema',                type: 'color', defaultValue: '#1d8348' },
    ],
  },
  {
    id: 'feriado',
    name: 'Feriado / Aviso',
    categoryLabel: 'Aviso',
    description: 'Comunicado elegante para datas comemorativas e avisos',
    supportsProduct: false,
    canvasW: 800,
    canvasH: 1000,
    render: renderFeriado,
    fields: [
      { key: 'titulo',    label: 'Título principal', type: 'text',     placeholder: 'FELIZ\nNATAL', required: true, hint: 'Use \\n para quebrar linha' },
      { key: 'subtitulo', label: 'Subtítulo',        type: 'text',     placeholder: 'da equipe EGP' },
      { key: 'mensagem',  label: 'Mensagem',         type: 'textarea', placeholder: 'Desejamos a você e sua família\num 2026 cheio de conquistas!' },
      { key: 'data',      label: 'Data / Período',   type: 'text',     placeholder: 'Dezembro 2025' },
      { key: 'cor',       label: 'Cor do tema',      type: 'color',    defaultValue: '#1a56a0' },
    ],
  },
  {
    id: 'lancamento',
    name: 'Lançamento de Produto',
    categoryLabel: 'Lançamento',
    description: 'Visual cinematográfico para anunciar produtos novos',
    supportsProduct: true,
    canvasW: 800,
    canvasH: 1000,
    render: renderLancamento,
    fields: [
      { key: 'produto',           label: 'Nome do Produto',      type: 'text',  placeholder: 'Controle EGP Pro',                  required: true },
      { key: 'descricao',         label: 'Slogan / Descrição',   type: 'text',  placeholder: 'Nova geração. Máximo desempenho.' },
      { key: 'preco_promocional', label: 'Preço de lançamento',  type: 'price', placeholder: '249,90' },
      { key: 'condicao',          label: 'Condição',             type: 'text',  placeholder: 'à vista' },
      { key: 'badge',             label: 'Badge',                type: 'text',  placeholder: 'LANÇAMENTO',                         defaultValue: 'LANÇAMENTO' },
      { key: 'cor',               label: 'Cor de destaque',      type: 'color', defaultValue: '#1a56db' },
    ],
  },
];
