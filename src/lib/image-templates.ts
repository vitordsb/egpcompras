// Renderização canvas de templates de marketing EGP.
// Cada template é uma função pura que desenha num HTMLCanvasElement.
// Não depende de IA — layout fixo, dados variáveis.

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
// Helpers
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number,
  maxWidth: number, lineHeight: number,
): number {
  const words = text.split(' ');
  let line = '';
  let cy = y;
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line.trim(), x, cy);
      line = word + ' ';
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line.trim()) ctx.fillText(line.trim(), x, cy);
  return cy + lineHeight;
}

function hexAdjust(hex: string, delta: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const cl = (v: number) => Math.max(0, Math.min(255, v + delta));
  const r = cl((n >> 16) & 255);
  const g = cl((n >> 8)  & 255);
  const b = cl(n & 255);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}

async function drawBrandBar(ctx: CanvasRenderingContext2D, W: number, H: number, accentColor: string) {
  const barH = 72;
  const y0   = H - barH;

  ctx.fillStyle = '#111111';
  ctx.fillRect(0, y0, W, barH);

  // Accent line no topo da barra
  ctx.fillStyle = accentColor;
  ctx.fillRect(0, y0, W, 4);

  // Logo
  try {
    const logo  = await loadImg(logoSrc);
    const lH    = 34;
    const lW    = lH * (446 / 155);
    ctx.drawImage(logo, 22, y0 + (barH - lH) / 2, lW, lH);
  } catch { /* sem logo, sem problema */ }

  // CNPJ + nome
  ctx.fillStyle   = 'rgba(255,255,255,0.65)';
  ctx.font        = '12px Inter, Arial, sans-serif';
  ctx.textAlign   = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('EGP IND E COM LTDA',       W - 18, y0 + barH * 0.33);
  ctx.fillText('CNPJ: 40.116.124/0001-51', W - 18, y0 + barH * 0.67);
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 1 — Promoção de Produto
// ─────────────────────────────────────────────────────────────────────────────

async function renderPromocao(
  canvas: HTMLCanvasElement,
  data: Record<string, string>,
  productImg: HTMLImageElement | null,
) {
  const W   = canvas.width;
  const H   = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const cor = data.cor || '#25a244';

  // Fundo branco
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Divisória diagonal colorida (direita)
  const split = W * 0.47;
  ctx.fillStyle = cor;
  ctx.beginPath();
  ctx.moveTo(split + 80, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H - 72);      // para antes da barra EGP
  ctx.lineTo(split - 20, H - 72);
  ctx.closePath();
  ctx.fill();

  // Detalhe triangular claro no canto superior esquerdo
  ctx.fillStyle = hexToRgba(cor, 0.08);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(split - 40, 0);
  ctx.lineTo(0, 200);
  ctx.closePath();
  ctx.fill();

  // Foto do produto (metade esquerda)
  if (productImg) {
    const maxW  = split - 30;
    const maxH  = H * 0.62;
    const scale = Math.min(maxW / productImg.naturalWidth, maxH / productImg.naturalHeight);
    const pW    = productImg.naturalWidth  * scale;
    const pH    = productImg.naturalHeight * scale;
    const px    = (split - pW) / 2;
    const py    = 100 + ((H * 0.68 - 100) - pH) / 2;

    ctx.shadowColor   = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur    = 24;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(productImg, px, py, pW, pH);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  // Nome do produto (abaixo da foto, lado esquerdo)
  const prodName = (data.produto || 'PRODUTO').toUpperCase();
  ctx.fillStyle    = '#1a1a1a';
  ctx.font         = `bold ${prodName.length > 20 ? 18 : 22}px Inter, Arial, sans-serif`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  wrapText(ctx, prodName, 18, H * 0.69, split - 30, 28);

  if (data.descricao) {
    ctx.fillStyle = '#666';
    ctx.font = '14px Inter, Arial, sans-serif';
    wrapText(ctx, data.descricao, 18, H * 0.69 + 32, split - 30, 20);
  }

  // ── Área de preços (lado direito, sobre o fundo colorido) ──
  const rx = split + 60;
  const ry = H * 0.12;

  // Badge de destaque (topo)
  const badge = (data.badge || 'PROMOÇÃO ESPECIAL').split('\n');
  ctx.fillStyle = '#f5c800';
  roundRect(ctx, rx - 10, ry - 14, 230, 78, 12);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  roundRect(ctx, rx - 4, ry - 8, 218, 66, 8);
  ctx.stroke();

  ctx.fillStyle    = '#1a1a1a';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  if (badge.length === 1) {
    ctx.font = 'bold 20px Inter, Arial, sans-serif';
    ctx.fillText(badge[0], rx + 99, ry + 25);
  } else {
    ctx.font = 'bold 14px Inter, Arial, sans-serif';
    ctx.fillText(badge[0], rx + 99, ry + 16);
    ctx.font = 'bold 20px Inter, Arial, sans-serif';
    ctx.fillText(badge[1], rx + 99, ry + 40);
  }

  // Preço original (riscado)
  if (data.preco_original) {
    const deText = `De R$ ${data.preco_original}`;
    ctx.font         = '17px Inter, Arial, sans-serif';
    ctx.fillStyle    = 'rgba(255,255,255,0.75)';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    const deY  = ry + 110;
    ctx.fillText(deText, rx, deY);
    const deW = ctx.measureText(deText).width;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rx, deY);
    ctx.lineTo(rx + deW, deY);
    ctx.stroke();
  }

  // "por" label
  const priceY = data.preco_original ? ry + 148 : ry + 120;
  ctx.fillStyle    = 'rgba(255,255,255,0.85)';
  ctx.font         = 'bold 15px Inter, Arial, sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('por', rx, priceY);

  // Preço promocional (grande)
  ctx.fillStyle = '#ffffff';
  ctx.font      = `bold ${(data.preco_promocional || '').length > 8 ? 42 : 52}px Inter, Arial, sans-serif`;
  ctx.fillText(`R$ ${data.preco_promocional || '—'}`, rx + 34, priceY);

  // Condição de pagamento
  if (data.condicao) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font      = '14px Inter, Arial, sans-serif';
    ctx.fillText(data.condicao, rx, priceY + 36);
  }

  // Badge de % desconto (se tiver os dois preços)
  if (data.preco_original && data.preco_promocional) {
    const orig = parseFloat(data.preco_original.replace(',', '.'));
    const sale = parseFloat(data.preco_promocional.replace(',', '.'));
    if (orig > 0 && sale > 0 && sale < orig) {
      const pct = Math.round((1 - sale / orig) * 100);
      const cx = W - 58, cy = priceY + 10;
      ctx.fillStyle = '#f5c800';
      ctx.beginPath();
      ctx.arc(cx, cy, 44, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle    = '#1a1a1a';
      ctx.font         = 'bold 22px Inter, Arial, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${pct}%`, cx, cy - 8);
      ctx.font = 'bold 13px Inter, Arial, sans-serif';
      ctx.fillText('OFF', cx, cy + 14);
    }
  }

  // Condições no rodapé (texto pequeno)
  if (data.condicoes) {
    ctx.fillStyle    = '#888';
    ctx.font         = '11px Inter, Arial, sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(data.condicoes, 16, H - 78);
  }

  await drawBrandBar(ctx, W, H, cor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 2 — Feriado / Aviso
// ─────────────────────────────────────────────────────────────────────────────

async function renderFeriado(
  canvas: HTMLCanvasElement,
  data: Record<string, string>,
  _productImg: HTMLImageElement | null,
) {
  const W   = canvas.width;
  const H   = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const cor = data.cor || '#1a56a0';

  // Gradiente de fundo
  const grad = ctx.createLinearGradient(0, 0, W * 0.6, H);
  grad.addColorStop(0, hexAdjust(cor, 20));
  grad.addColorStop(1, hexAdjust(cor, -40));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Círculos decorativos sutis
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.arc(W * 0.9, H * 0.1, 220, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.08, H * 0.85, 160, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.5, H * 0.5, 350, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 60;
  ctx.stroke();

  // Logo EGP centrado no topo
  try {
    const logo = await loadImg(logoSrc);
    const lH = 44;
    const lW = lH * (446 / 155);
    ctx.drawImage(logo, (W - lW) / 2, 50, lW, lH);
  } catch { /* ignore */ }

  // Linha separadora decorativa
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, 115); ctx.lineTo(W - 80, 115);
  ctx.stroke();

  // Título principal
  const titulo = data.titulo || 'TÍTULO';
  const tLines = titulo.split('\n');
  const tSize  = titulo.replace('\n', '').length > 14 ? 54 : 66;
  ctx.fillStyle    = '#ffffff';
  ctx.font         = `bold ${tSize}px Inter, Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  const tStartY = H * 0.28;
  tLines.forEach((line, i) => {
    // Sombra no texto
    ctx.shadowColor  = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur   = 8;
    ctx.fillText(line, W / 2, tStartY + i * (tSize + 10));
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
  });

  // Subtítulo
  if (data.subtitulo) {
    const subY = tStartY + tLines.length * (tSize + 10) + 20;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font      = 'bold 26px Inter, Arial, sans-serif';
    ctx.fillText(data.subtitulo, W / 2, subY);
  }

  // Card de mensagem
  if (data.mensagem) {
    const cardY = H * 0.52;
    const cardH = 200;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, 60, cardY, W - 120, cardH, 16);
    ctx.fill();

    ctx.fillStyle    = '#ffffff';
    ctx.font         = '20px Inter, Arial, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    const mLines = data.mensagem.split('\n');
    const mLineH = 30;
    const mStart = cardY + (cardH - mLines.length * mLineH) / 2;
    mLines.forEach((line, i) => {
      ctx.fillText(line, W / 2, mStart + i * mLineH);
    });
  }

  // Data / período
  if (data.data) {
    ctx.fillStyle    = 'rgba(255,255,255,0.6)';
    ctx.font         = '15px Inter, Arial, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.data, W / 2, H - 95);
  }

  await drawBrandBar(ctx, W, H, cor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 3 — Lançamento de Produto
// ─────────────────────────────────────────────────────────────────────────────

async function renderLancamento(
  canvas: HTMLCanvasElement,
  data: Record<string, string>,
  productImg: HTMLImageElement | null,
) {
  const W   = canvas.width;
  const H   = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const cor = data.cor || '#0d0d0d';

  // Fundo escuro com gradiente
  const grad = ctx.createRadialGradient(W * 0.5, H * 0.45, 50, W * 0.5, H * 0.45, W * 0.8);
  grad.addColorStop(0, hexAdjust(cor, 60));
  grad.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Anel luminoso de fundo
  ctx.strokeStyle = hexToRgba(cor.length === 7 ? hexAdjust(cor, 80) : '#4488ff', 0.18);
  ctx.lineWidth = 120;
  ctx.beginPath();
  ctx.arc(W / 2, H * 0.42, 280, 0, Math.PI * 2);
  ctx.stroke();

  // Badge "LANÇAMENTO" / "NOVO"
  const badgeText = data.badge || 'LANÇAMENTO';
  const badgeW = ctx.measureText(badgeText).width + 60;
  const bx = (W - Math.max(badgeW, 200)) / 2;
  ctx.fillStyle = cor.length === 7 ? hexAdjust(cor, 40) : '#2255cc';
  roundRect(ctx, bx, 52, Math.max(badgeW + 40, 220), 46, 23);
  ctx.fill();

  ctx.fillStyle    = '#ffffff';
  ctx.font         = 'bold 18px Inter, Arial, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '3px';
  ctx.fillText(badgeText, W / 2, 52 + 23);
  ctx.letterSpacing = '0px';

  // Foto do produto centrada
  if (productImg) {
    const maxW  = W * 0.7;
    const maxH  = H * 0.5;
    const scale = Math.min(maxW / productImg.naturalWidth, maxH / productImg.naturalHeight);
    const pW    = productImg.naturalWidth  * scale;
    const pH    = productImg.naturalHeight * scale;
    const px    = (W - pW) / 2;
    const py    = 115 + (H * 0.5 - pH) / 2;

    // Glow sob o produto
    ctx.shadowColor   = hexToRgba(cor.length === 7 ? hexAdjust(cor, 60) : '#4488ff', 0.5);
    ctx.shadowBlur    = 50;
    ctx.drawImage(productImg, px, py, pW, pH);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
  }

  // Nome do produto
  const prodName = (data.produto || 'NOME DO PRODUTO').toUpperCase();
  ctx.fillStyle    = '#ffffff';
  ctx.font         = `bold ${prodName.length > 20 ? 24 : 30}px Inter, Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  wrapText(ctx, prodName, W / 2 - 200, H * 0.67, 400, 36);

  // Descrição
  if (data.descricao) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font      = '16px Inter, Arial, sans-serif';
    ctx.fillText(data.descricao, W / 2, H * 0.67 + 44);
  }

  // Preço
  if (data.preco_promocional) {
    ctx.fillStyle    = cor.length === 7 ? hexAdjust(cor, 80) : '#88aaff';
    ctx.font         = `bold 48px Inter, Arial, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`R$ ${data.preco_promocional}`, W / 2, H * 0.81);

    if (data.condicao) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '14px Inter, Arial, sans-serif';
      ctx.fillText(data.condicao, W / 2, H * 0.81 + 34);
    }
  }

  await drawBrandBar(ctx, W, H, cor.length === 7 ? hexAdjust(cor, 60) : '#4488ff');
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de templates
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'promocao',
    name: 'Promoção de Produto',
    categoryLabel: 'Promoção',
    description: 'Layout com foto do produto, preço antigo/novo e badge de desconto',
    supportsProduct: true,
    canvasW: 800,
    canvasH: 1000,
    render: renderPromocao,
    fields: [
      { key: 'produto', label: 'Nome do Produto', type: 'text', placeholder: 'CONTROLE 2 BOTÕES', required: true },
      { key: 'descricao', label: 'Descrição curta', type: 'text', placeholder: 'Sem fio, alcance 30m' },
      { key: 'preco_original', label: 'Preço "De:" (riscado)', type: 'price', placeholder: '199,90' },
      { key: 'preco_promocional', label: 'Preço "Por:"', type: 'price', placeholder: '149,90', required: true },
      { key: 'condicao', label: 'Condição', type: 'text', placeholder: 'à vista', defaultValue: 'à vista' },
      { key: 'badge', label: 'Badge de destaque', type: 'text', placeholder: 'OFERTAÇO\nNA ÁREA', defaultValue: 'PROMOÇÃO\nESPECIAL', hint: 'Use \\n para quebrar linha' },
      { key: 'condicoes', label: 'Condições (rodapé, texto pequeno)', type: 'text', placeholder: 'Oferta válida até 31/05/2026 ou enquanto durar o estoque.' },
      { key: 'cor', label: 'Cor do tema', type: 'color', defaultValue: '#25a244' },
    ],
  },
  {
    id: 'feriado',
    name: 'Feriado / Aviso',
    categoryLabel: 'Aviso',
    description: 'Flyer de comunicado, feriado ou data comemorativa',
    supportsProduct: false,
    canvasW: 800,
    canvasH: 1000,
    render: renderFeriado,
    fields: [
      { key: 'titulo', label: 'Título principal', type: 'text', placeholder: 'FELIZ\nNATAL', required: true, hint: 'Use \\n para quebrar linha' },
      { key: 'subtitulo', label: 'Subtítulo', type: 'text', placeholder: 'da equipe EGP' },
      { key: 'mensagem', label: 'Mensagem', type: 'textarea', placeholder: 'Desejamos a você e sua família\num 2026 cheio de conquistas!' },
      { key: 'data', label: 'Data / Período', type: 'text', placeholder: 'Dezembro 2025' },
      { key: 'cor', label: 'Cor do tema', type: 'color', defaultValue: '#1a56a0' },
    ],
  },
  {
    id: 'lancamento',
    name: 'Lançamento de Produto',
    categoryLabel: 'Lançamento',
    description: 'Visual dramático para anunciar um produto novo',
    supportsProduct: true,
    canvasW: 800,
    canvasH: 1000,
    render: renderLancamento,
    fields: [
      { key: 'produto', label: 'Nome do Produto', type: 'text', placeholder: 'CONTROLE EGP PRO', required: true },
      { key: 'descricao', label: 'Descrição / Slogan', type: 'text', placeholder: 'Nova geração. Máximo desempenho.' },
      { key: 'preco_promocional', label: 'Preço de lançamento', type: 'price', placeholder: '249,90' },
      { key: 'condicao', label: 'Condição', type: 'text', placeholder: 'à vista' },
      { key: 'badge', label: 'Badge', type: 'text', placeholder: 'LANÇAMENTO', defaultValue: 'LANÇAMENTO' },
      { key: 'cor', label: 'Cor de destaque', type: 'color', defaultValue: '#1a56db' },
    ],
  },
];
