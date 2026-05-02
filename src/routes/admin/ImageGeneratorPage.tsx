import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useInternalAuth } from '@/lib/auth-context';
import logoSrc from '@/images/letreirosemfundo.png';

// ---------------------------------------------------------------------------
// Fotos dos produtos — importadas via Vite glob (URLs hasheadas, sem CORS)
// ---------------------------------------------------------------------------

const productMods = import.meta.glob<string>(
  '../../images/products/*.png',
  { eager: true, import: 'default' },
);

function toDisplayName(filename: string): string {
  const base = filename.replace('.png', '');
  return base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/^(.)/, (c) => c.toUpperCase())
    .trim();
}

interface ProductEntry { filename: string; name: string; url: string }

const PRODUCTS: ProductEntry[] = Object.entries(productMods)
  .map(([path, url]) => {
    const filename = path.split('/').pop()!;
    return { filename, name: toDisplayName(filename), url };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

// ---------------------------------------------------------------------------
// Canvas: composta a imagem gerada + foto do produto + identidade EGP
// ---------------------------------------------------------------------------

const CNPJ_TEXT    = 'CNPJ: 40.116.124/0001-51';
const COMPANY_NAME = 'EGP IND E COM LTDA';

function loadImg(src: string, crossOrigin = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function compositeWithBranding(
  rawUrl: string,
  productUrl?: string,
): Promise<string> {
  const [generated, logo, product] = await Promise.all([
    loadImg(rawUrl),
    loadImg(logoSrc, false),
    productUrl ? loadImg(productUrl, false) : Promise.resolve(null),
  ]);

  const W = generated.naturalWidth;
  const H = generated.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Fundo gerado pela IA
  ctx.drawImage(generated, 0, 0, W, H);

  // Foto do produto centralizada (com sombra)
  if (product) {
    const maxW = W * 0.58;
    const maxH = H * 0.74;
    const scale  = Math.min(maxW / product.naturalWidth, maxH / product.naturalHeight);
    const pW = product.naturalWidth  * scale;
    const pH = product.naturalHeight * scale;
    const pX = (W - pW) / 2;
    const pY = (H - pH) / 2 - H * 0.04;

    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur    = Math.round(W * 0.025);
    ctx.shadowOffsetY = Math.round(H * 0.015);
    ctx.drawImage(product, pX, pY, pW, pH);
    ctx.restore();
  }

  // Faixa escura no rodapé
  const stripH = Math.round(H * 0.14);
  const grad = ctx.createLinearGradient(0, H - stripH, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H - stripH, W, stripH);

  // Logo — canto inferior esquerdo
  const pad    = Math.round(W * 0.025);
  const logoW  = Math.round(W * 0.24);
  const logoH  = Math.round(logoW * (155 / 446));
  ctx.drawImage(logo, pad, H - logoH - pad, logoW, logoH);

  // CNPJ + nome — canto inferior direito
  const fontSize = Math.max(10, Math.round(W * 0.018));
  const lineH    = Math.round(fontSize * 1.5);
  ctx.font         = `500 ${fontSize}px Inter, Arial, sans-serif`;
  ctx.fillStyle    = 'rgba(255,255,255,0.88)';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(CNPJ_TEXT,    W - pad, H - pad);
  ctx.fillText(COMPANY_NAME, W - pad, H - pad - lineH);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('canvas.toBlob falhou')); return; }
      const reader = new FileReader();
      reader.onload  = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.93);
  });
}

// ---------------------------------------------------------------------------
// Templates pré-definidos
// ---------------------------------------------------------------------------

interface TemplateVar { key: string; label: string; placeholder: string }

interface ImageTemplate {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  description: string;
  prompt: string;
  backgroundPrompt?: string; // usado quando um produto é selecionado
  supportsProduct?: boolean;
  variables: TemplateVar[];
  defaultSize: ImageSize;
}

type ImageSize = 'square_hd' | 'landscape_4_3' | 'landscape_16_9' | 'portrait_4_3';

const SIZE_LABELS: Record<ImageSize, string> = {
  square_hd:      'Quadrado (1:1)',
  landscape_4_3:  'Paisagem 4:3',
  landscape_16_9: 'Paisagem 16:9',
  portrait_4_3:   'Retrato 4:3',
};

const CATEGORY_COLOR: Record<string, string> = {
  promocao:      'bg-orange-100 text-orange-700',
  comemorativa:  'bg-purple-100 text-purple-700',
  produto:       'bg-blue-100 text-blue-700',
  institucional: 'bg-slate-100 text-slate-700',
  custom:        'bg-emerald-100 text-emerald-700',
};

const TEMPLATES: ImageTemplate[] = [
  {
    id: 'promocao_produto',
    name: 'Promoção de Produto',
    category: 'promocao',
    categoryLabel: 'Promoção',
    description: 'Banner de produto em oferta — use a foto real do produto',
    defaultSize: 'landscape_4_3',
    supportsProduct: true,
    prompt: `Professional commercial product photography for Brazilian electronics brand. Product: {{produto}}. Studio lighting, clean {{cor}} background gradient, promotional visual style. High quality, 4K, no watermark, no text.`,
    backgroundPrompt: `Modern electronics promotional marketing banner background. Bold {{cor}} gradient with abstract glowing geometric shapes, dynamic light streaks, futuristic tech pattern. Professional commercial design, vivid colors, high contrast. No people, no products, no text, no watermarks.`,
    variables: [
      { key: 'produto', label: 'Produto (se não selecionar foto)', placeholder: 'Ex: Controle 2 botões EGP' },
      { key: 'cor',     label: 'Cor do tema', placeholder: 'Ex: blue, green, orange, purple' },
    ],
  },
  {
    id: 'lancamento',
    name: 'Lançamento de Produto',
    category: 'produto',
    categoryLabel: 'Produto',
    description: 'Arte dramática para anunciar um novo produto',
    defaultSize: 'landscape_4_3',
    supportsProduct: true,
    prompt: `New product launch teaser for electronics brand. Product: {{produto}}. Dramatic {{cor}} spotlight on dark background, futuristic tech aesthetic, glowing edges, cinematic quality. No text, no watermark.`,
    backgroundPrompt: `Epic product launch announcement visual. Dark cinematic background with dramatic {{cor}} light beams, glowing particles, depth of field bokeh, premium tech brand atmosphere. No products, no text, no watermarks.`,
    variables: [
      { key: 'produto', label: 'Produto (se não selecionar foto)', placeholder: 'Ex: Controle EGP Pro V2' },
      { key: 'cor',     label: 'Cor destaque', placeholder: 'Ex: electric blue, gold, neon green' },
    ],
  },
  {
    id: 'liquidacao',
    name: 'Liquidação / Black Friday',
    category: 'promocao',
    categoryLabel: 'Promoção',
    description: 'Visual impactante para grandes promoções',
    defaultSize: 'landscape_16_9',
    supportsProduct: true,
    prompt: `High-energy retail sale promotion banner. Red, black and gold color scheme. Explosive dynamic composition, lightning bolts, confetti elements. Dramatic contrast. No text, no watermark.`,
    backgroundPrompt: `Explosive Black Friday sale marketing banner. Bold red and black diagonal gradient with gold accents, energetic geometric shapes, dynamic high-contrast retail design. No products, no text, no watermarks.`,
    variables: [],
  },
  {
    id: 'data_comemorativa',
    name: 'Data Comemorativa',
    category: 'comemorativa',
    categoryLabel: 'Comemorativa',
    description: 'Arte para datas especiais: Natal, Dia das Mães, Páscoa…',
    defaultSize: 'square_hd',
    prompt: `Elegant festive greeting card design for {{data}}. {{estilo}} visual style, warm celebratory atmosphere. Decorative elements related to the occasion. Professional design. No text, no watermark.`,
    variables: [
      { key: 'data',   label: 'Data / Ocasião', placeholder: 'Ex: Natal, Dia das Mães, Páscoa' },
      { key: 'estilo', label: 'Estilo visual',  placeholder: 'Ex: minimalist, luxurious, colorful, warm' },
    ],
  },
  {
    id: 'institucional',
    name: 'Institucional / Marca',
    category: 'institucional',
    categoryLabel: 'Institucional',
    description: 'Comunicado corporativo ou apresentação da empresa',
    defaultSize: 'landscape_4_3',
    prompt: `Professional corporate communication banner for technology company. Theme: {{tema}}. Clean modern design, blue and white palette, geometric abstract shapes, subtle circuit board pattern. No text, no watermark.`,
    variables: [
      { key: 'tema', label: 'Tema / Conceito', placeholder: 'Ex: inovação, qualidade, parceria' },
    ],
  },
  {
    id: 'agradecimento',
    name: 'Agradecimento ao Cliente',
    category: 'institucional',
    categoryLabel: 'Institucional',
    description: 'Arte calorosa para agradecer um cliente',
    defaultSize: 'square_hd',
    prompt: `Warm and heartfelt thank you card design. {{estilo}} style, golden and warm tones, heart or star elements, premium feel. Brazilian electronics company thanking loyal customers. No text, no watermark.`,
    variables: [
      { key: 'estilo', label: 'Estilo', placeholder: 'Ex: elegant, warm, modern, minimalist' },
    ],
  },
  {
    id: 'personalizado',
    name: 'Prompt Livre',
    category: 'custom',
    categoryLabel: 'Personalizado',
    description: 'Descreva exatamente o que quer gerar',
    defaultSize: 'square_hd',
    prompt: '{{prompt_livre}}',
    variables: [
      {
        key: 'prompt_livre',
        label: 'Descreva a imagem (inglês dá melhores resultados)',
        placeholder: 'Ex: Promotional banner, blue gradient background, electronics...',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrompt(template: ImageTemplate, vars: Record<string, string>, withProduct: boolean): string {
  const base = withProduct && template.backgroundPrompt ? template.backgroundPrompt : template.prompt;
  let p = base;
  for (const [key, val] of Object.entries(vars)) {
    p = p.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val.trim() || `[${key}]`);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export default function ImageGeneratorPage() {
  const { userLabel } = useInternalAuth();

  const [selectedTemplate, setSelectedTemplate] = useState<ImageTemplate | null>(null);
  const [selectedProduct, setSelectedProduct]   = useState<ProductEntry | null>(null);
  const [vars, setVars]           = useState<Record<string, string>>({});
  const [imageSize, setImageSize] = useState<ImageSize>('landscape_4_3');
  const [generating, setGenerating]   = useState(false);
  const [genError, setGenError]       = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [caption, setCaption]     = useState('');
  const [sending, setSending]     = useState(false);
  const [sendError, setSendError]     = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [contacts, setContacts]       = useState<{ phone: string; name: string | null }[]>([]);
  const [selectedPhone, setSelectedPhone] = useState('');
  const [contactsLoaded, setContactsLoaded] = useState(false);

  async function loadContacts() {
    if (contactsLoaded) return;
    const [{ data: namedContacts }, { data: sessions }] = await Promise.all([
      supabase.from('whatsapp_contacts').select('phone, name').order('name'),
      supabase.from('whatsapp_sessions').select('phone').order('updated_at', { ascending: false }),
    ]);
    const map = new Map<string, string | null>();
    for (const c of (namedContacts ?? []) as { phone: string; name: string }[]) map.set(c.phone, c.name);
    for (const s of (sessions ?? []) as { phone: string }[]) { if (!map.has(s.phone)) map.set(s.phone, null); }
    setContacts([...map.entries()].map(([phone, name]) => ({ phone, name })));
    setContactsLoaded(true);
  }

  function selectTemplate(t: ImageTemplate) {
    setSelectedTemplate(t);
    setSelectedProduct(null);
    setVars({});
    setImageSize(t.defaultSize);
    setGeneratedUrl(null);
    setGenError(null);
    setSendError(null);
    setSendSuccess(null);
    setCaption('');
  }

  async function generateImage() {
    if (!selectedTemplate || generating) return;
    const prompt = buildPrompt(selectedTemplate, vars, !!selectedProduct);
    if (!prompt.trim()) return;

    setGenerating(true);
    setGenError(null);
    setGeneratedUrl(null);
    setSendError(null);
    setSendSuccess(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      // 1. Gera background via Fal.ai
      const res  = await fetch(`${supabaseUrl}/functions/v1/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ prompt, image_size: imageSize }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao gerar imagem');

      // 2. Composta no canvas: background + foto do produto + branding EGP
      const base64 = await compositeWithBranding(
        json.url,
        selectedProduct?.url ?? undefined,
      );

      // 3. Re-upload da imagem final
      const uploadRes  = await fetch(`${supabaseUrl}/functions/v1/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ image_data: base64 }),
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadJson.error ?? 'Falha no upload');

      setGeneratedUrl(uploadJson.url);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function sendViaWhatsApp() {
    if (!generatedUrl || !selectedPhone || sending) return;
    setSending(true);
    setSendError(null);
    setSendSuccess(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({
          to: selectedPhone,
          image_url: generatedUrl,
          text: caption.trim() || undefined,
          sender_label: userLabel,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao enviar');
      const contact = contacts.find((c) => c.phone === selectedPhone);
      setSendSuccess(`Imagem enviada para ${contact?.name ?? selectedPhone}!`);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const varsOk = selectedTemplate
    ? selectedTemplate.variables
        .filter((v) => !(selectedProduct && v.key === 'produto'))
        .every((v) => vars[v.key]?.trim())
    : false;
  const canGenerate = selectedTemplate !== null && varsOk;

  const fmtPhone = (p: string) => {
    const d = p.replace(/\D/g, '');
    if (d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
    if (d.length === 12) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
    return p;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden lg:flex-row">

      {/* ── Painel esquerdo: galeria de templates ── */}
      <div className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:w-72 lg:border-b-0 lg:border-r xl:w-80">
        <div className="shrink-0 border-b border-slate-200 px-4 py-4">
          <h1 className="text-base font-semibold text-slate-900">Gerador de Imagens IA</h1>
          <p className="mt-0.5 text-xs text-slate-500">Escolha um template e envie via WhatsApp</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTemplate(t)}
              className={cn(
                'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                selectedTemplate?.id === t.id
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-slate-900 leading-tight">{t.name}</span>
                <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', CATEGORY_COLOR[t.category] ?? 'bg-slate-100 text-slate-600')}>
                  {t.categoryLabel}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">{t.description}</p>
              {t.supportsProduct && (
                <p className="mt-1 text-[10px] text-brand-600 font-medium">✦ suporta foto do produto</p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Painel direito: configuração + preview ── */}
      <div className="flex flex-1 flex-col overflow-y-auto bg-slate-50 p-5 gap-5">

        {!selectedTemplate ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mb-3 text-5xl">🎨</div>
              <p className="text-sm font-medium text-slate-700">Selecione um template à esquerda</p>
              <p className="mt-1 text-xs text-slate-400">para configurar e gerar sua imagem</p>
            </div>
          </div>
        ) : (
          <>
            {/* Configuração */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-900">{selectedTemplate.name}</h2>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', CATEGORY_COLOR[selectedTemplate.category])}>
                  {selectedTemplate.categoryLabel}
                </span>
              </div>

              {/* Seletor de foto do produto */}
              {selectedTemplate.supportsProduct && (
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                      Foto do Produto
                    </label>
                    {selectedProduct && (
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(null)}
                        className="text-[11px] text-slate-400 hover:text-red-500"
                      >
                        remover
                      </button>
                    )}
                  </div>

                  {selectedProduct ? (
                    <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 p-2.5">
                      <img
                        src={selectedProduct.url}
                        alt={selectedProduct.name}
                        className="h-12 w-12 rounded object-contain"
                      />
                      <div>
                        <p className="text-xs font-medium text-slate-800">{selectedProduct.name}</p>
                        <p className="text-[10px] text-slate-500">Será sobreposta na imagem gerada</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2 bg-slate-50">
                      {PRODUCTS.map((p) => (
                        <button
                          key={p.filename}
                          type="button"
                          onClick={() => setSelectedProduct(p)}
                          title={p.name}
                          className="group flex flex-col items-center gap-1 rounded-md p-1.5 hover:bg-white hover:shadow-sm transition-all"
                        >
                          <img
                            src={p.url}
                            alt={p.name}
                            className="h-10 w-10 object-contain"
                          />
                          <span className="text-[9px] text-slate-500 text-center leading-tight line-clamp-2">
                            {p.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Variáveis do template */}
              {selectedTemplate.variables
                .filter((v) => !(selectedProduct && v.key === 'produto'))
                .length > 0 && (
                <div className="space-y-3 mb-4">
                  {selectedTemplate.variables
                    .filter((v) => !(selectedProduct && v.key === 'produto'))
                    .map((v) => (
                    <div key={v.key}>
                      <label className="block text-xs font-medium text-slate-700 mb-1">{v.label}</label>
                      {v.key === 'prompt_livre' ? (
                        <textarea
                          value={vars[v.key] ?? ''}
                          onChange={(e) => setVars((prev) => ({ ...prev, [v.key]: e.target.value }))}
                          placeholder={v.placeholder}
                          rows={3}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
                        />
                      ) : (
                        <input
                          type="text"
                          value={vars[v.key] ?? ''}
                          onChange={(e) => setVars((prev) => ({ ...prev, [v.key]: e.target.value }))}
                          placeholder={v.placeholder}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Tamanho */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Tamanho</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(SIZE_LABELS) as ImageSize[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setImageSize(s)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                        imageSize === s
                          ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300',
                      )}
                    >
                      {SIZE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Botão gerar */}
              <button
                type="button"
                onClick={generateImage}
                disabled={!canGenerate || generating}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/>
                    </svg>
                    Gerando…
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                    </svg>
                    Gerar com IA
                    {selectedProduct && <span className="text-brand-200 text-[11px]">· com foto do produto</span>}
                  </>
                )}
              </button>

              {genError && (
                <p className="mt-2 text-xs text-red-600 rounded-md bg-red-50 border border-red-200 px-3 py-1.5">{genError}</p>
              )}
            </div>

            {/* Preview + envio */}
            {generatedUrl && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Preview</h3>

                <img
                  src={generatedUrl}
                  alt="Imagem gerada"
                  className="w-full rounded-lg object-cover shadow-sm mb-4"
                />

                <div className="flex gap-2 mb-4">
                  <a
                    href={generatedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                    Abrir
                  </a>
                  <a
                    href={generatedUrl}
                    download
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Download
                  </a>
                  <button
                    type="button"
                    onClick={() => { setGeneratedUrl(null); setSendSuccess(null); setSendError(null); }}
                    className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Gerar outra
                  </button>
                </div>

                {/* Envio WhatsApp */}
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Enviar via WhatsApp</h4>

                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Para</label>
                    <select
                      value={selectedPhone}
                      onChange={(e) => setSelectedPhone(e.target.value)}
                      onFocus={loadContacts}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                    >
                      <option value="">Selecione o contato…</option>
                      {contacts.map((c) => (
                        <option key={c.phone} value={c.phone}>
                          {c.name ? `${c.name} — ${fmtPhone(c.phone)}` : fmtPhone(c.phone)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Legenda (opcional)</label>
                    <textarea
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="Ex: Aproveite 10% de desconto nos controles! Válido até domingo. 🎉"
                      rows={2}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 resize-none"
                    />
                  </div>

                  {sendError   && <p className="text-xs text-red-600 rounded-md bg-red-50 border border-red-200 px-3 py-1.5">{sendError}</p>}
                  {sendSuccess && <p className="text-xs text-green-700 rounded-md bg-green-50 border border-green-200 px-3 py-1.5">{sendSuccess}</p>}

                  <button
                    type="button"
                    onClick={sendViaWhatsApp}
                    disabled={!selectedPhone || sending}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sending ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/>
                        </svg>
                        Enviando…
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                        </svg>
                        Enviar via WhatsApp
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
