import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useInternalAuth } from '@/lib/auth-context';
import { TEMPLATES, loadImg, type TemplateDefinition } from '@/lib/image-templates';

// ─── Fotos dos produtos via Vite glob ─────────────────────────────────────

const productMods = import.meta.glob<string>(
  '../../images/products/*.png',
  { eager: true, import: 'default' },
);

interface ProductEntry { filename: string; name: string; url: string }

function toDisplayName(f: string) {
  return f.replace('.png', '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/^(.)/, c => c.toUpperCase()).trim();
}

const PRODUCTS: ProductEntry[] = Object.entries(productMods)
  .map(([path, url]) => {
    const filename = path.split('/').pop()!;
    return { filename, name: toDisplayName(filename), url };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

// ─── Tipos ────────────────────────────────────────────────────────────────

interface SavedTemplate {
  id: string;
  name: string;
  template_id: string;
  form_data: Record<string, string>;
  product_filename: string | null;
  image_url: string;
  caption: string | null;
  created_at: string;
  created_by: string | null;
}

const CATEGORY_COLOR: Record<string, string> = {
  Promoção:   'bg-orange-100 text-orange-700',
  Aviso:      'bg-purple-100 text-purple-700',
  Lançamento: 'bg-blue-100 text-blue-700',
};

// ─── Componente ───────────────────────────────────────────────────────────

export default function ImageGeneratorPage() {
  const { userLabel } = useInternalAuth();

  // Abas da sidebar
  const [sidebarTab, setSidebarTab] = useState<'criar' | 'flyer-ia' | 'salvos'>('criar');

  // Estado da aba "Flyer IA" (Nano Banana — gera flyer comemorativo via IA)
  const [iaHoliday,    setIaHoliday]    = useState<string>('maes');
  const [iaMainText,   setIaMainText]   = useState<string>('');
  const [iaSecondary,  setIaSecondary]  = useState<string>('');
  const [iaStyle,      setIaStyle]      = useState<'suave' | 'vibrante' | 'elegante' | 'festivo'>('elegante');
  const [iaPalette,    setIaPalette]    = useState<string>('');
  const [iaGenerating, setIaGenerating] = useState(false);
  const [iaError,      setIaError]      = useState<string | null>(null);

  const HOLIDAYS: Array<{ value: string; label: string; defaultText: string }> = [
    { value: 'maes',                 label: 'Dia das Mães',           defaultText: 'Feliz Dia das Mães' },
    { value: 'pais',                 label: 'Dia dos Pais',           defaultText: 'Feliz Dia dos Pais' },
    { value: 'namorados',            label: 'Dia dos Namorados',      defaultText: 'Feliz Dia dos Namorados' },
    { value: 'criancas',             label: 'Dia das Crianças',       defaultText: 'Feliz Dia das Crianças' },
    { value: 'professor',            label: 'Dia do Professor',       defaultText: 'Feliz Dia do Professor' },
    { value: 'natal',                label: 'Natal',                  defaultText: 'Feliz Natal' },
    { value: 'ano_novo',             label: 'Ano Novo',               defaultText: 'Feliz Ano Novo' },
    { value: 'pascoa',               label: 'Páscoa',                 defaultText: 'Feliz Páscoa' },
    { value: 'independencia',        label: 'Independência',          defaultText: '7 de Setembro' },
    { value: 'consumidor',           label: 'Dia do Consumidor',      defaultText: 'Obrigado, cliente!' },
    { value: 'consciencia_negra',    label: 'Consciência Negra',      defaultText: 'Consciência Negra' },
    { value: 'black_friday',         label: 'Black Friday',           defaultText: 'Black Friday EGP' },
    { value: 'aniversario_empresa',  label: 'Aniversário EGP',        defaultText: 'EGP comemora!' },
    { value: 'outro',                label: 'Outro (custom)',         defaultText: '' },
  ];

  // Templates salvos no banco
  const [savedTemplates, setSavedTemplates]   = useState<SavedTemplate[]>([]);
  const [loadingSaved, setLoadingSaved]       = useState(false);

  // Criação
  const [template, setTemplate]       = useState<TemplateDefinition | null>(null);
  const [formData, setFormData]       = useState<Record<string, string>>({});
  const [product, setProduct]         = useState<ProductEntry | null>(null);
  const [rendering, setRendering]     = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [finalUrl, setFinalUrl]       = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Salvar como template
  const [tplName, setTplName]                 = useState('');
  const [tplCaption, setTplCaption]           = useState('');
  const [savingTpl, setSavingTpl]             = useState(false);
  const [saveTplSuccess, setSaveTplSuccess]   = useState(false);
  const [saveTplError, setSaveTplError]       = useState<string | null>(null);

  // Envio WhatsApp
  const [sending, setSending]         = useState(false);
  const [sendError, setSendError]     = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [contacts, setContacts]       = useState<{ phone: string; name: string | null }[]>([]);
  const [phone, setPhone]             = useState('');
  const [caption, setCaption]         = useState('');
  const [contactsLoaded, setContactsLoaded] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Carrega templates salvos ──
  async function loadSavedTemplates() {
    setLoadingSaved(true);
    const { data } = await supabase
      .from('marketing_templates')
      .select('*')
      .order('created_at', { ascending: false });
    setSavedTemplates((data ?? []) as SavedTemplate[]);
    setLoadingSaved(false);
  }

  useEffect(() => {
    loadSavedTemplates();
  }, []);

  // ── Carrega template salvo no formulário ──
  function loadSaved(saved: SavedTemplate) {
    const def = TEMPLATES.find(t => t.id === saved.template_id);
    if (!def) return;
    setTemplate(def);
    setFormData(saved.form_data ?? {});
    // Reconstrói o produto se tiver filename salvo
    if (saved.product_filename) {
      const found = PRODUCTS.find(p => p.filename === `${saved.product_filename}.png`
        || p.filename === saved.product_filename);
      setProduct(found ?? null);
    } else {
      setProduct(null);
    }
    setFinalUrl(saved.image_url);
    setCaption(saved.caption ?? '');
    setSendError(null);
    setSendSuccess(null);
    setSaveTplSuccess(false);
    setSaveTplError(null);
    setTplName(saved.name);
    setTplCaption(saved.caption ?? '');
    setSidebarTab('criar'); // muda pra aba de edição
  }

  // ── Inicializa template novo ──
  function selectTemplate(t: TemplateDefinition) {
    const defaults: Record<string, string> = {};
    for (const f of t.fields) if (f.defaultValue) defaults[f.key] = f.defaultValue;
    setTemplate(t);
    setFormData(defaults);
    setProduct(null);
    setFinalUrl(null);
    setUploadError(null);
    setSendError(null);
    setSendSuccess(null);
    setSaveTplSuccess(false);
    setSaveTplError(null);
    setCaption('');
    setTplName('');
    setTplCaption('');
  }

  // ── Renderização canvas ──
  const renderCanvas = useCallback(async () => {
    if (!template || !canvasRef.current) return;
    setRendering(true);
    try {
      const canvas = canvasRef.current;
      canvas.width  = template.canvasW;
      canvas.height = template.canvasH;
      const resolved: Record<string, string> = {};
      for (const [k, v] of Object.entries(formData)) resolved[k] = v.replace(/\\n/g, '\n');
      let productImg: HTMLImageElement | null = null;
      if (product) productImg = await loadImg(product.url).catch(() => null);
      await template.render(canvas, resolved, productImg);
    } catch (err) {
      console.error('Canvas render error:', err);
    } finally {
      setRendering(false);
    }
  }, [template, formData, product]);

  useEffect(() => {
    const t = setTimeout(renderCanvas, 120);
    return () => clearTimeout(t);
  }, [renderCanvas]);

  // ── Carrega contatos ──
  async function loadContacts() {
    if (contactsLoaded) return;
    const [{ data: named }, { data: sess }] = await Promise.all([
      supabase.from('whatsapp_contacts').select('phone, name').order('name'),
      supabase.from('whatsapp_sessions').select('phone').order('updated_at', { ascending: false }),
    ]);
    const map = new Map<string, string | null>();
    for (const c of (named ?? []) as any[]) map.set(c.phone, c.name);
    for (const s of (sess  ?? []) as any[]) if (!map.has(s.phone)) map.set(s.phone, null);
    setContacts([...map.entries()].map(([ph, nm]) => ({ phone: ph, name: nm })));
    setContactsLoaded(true);
  }

  // ── Upload canvas → Supabase Storage ──
  async function handleUpload() {
    if (!canvasRef.current || uploading) return;
    setUploading(true);
    setUploadError(null);
    setFinalUrl(null);
    setSaveTplSuccess(false);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        canvasRef.current!.toBlob((blob) => {
          if (!blob) { reject(new Error('toBlob falhou')); return; }
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.93);
      });
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res  = await fetch(`${supabaseUrl}/functions/v1/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ image_data: base64 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha no upload');
      setFinalUrl(json.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  // ── Gerar Flyer Comemorativo via IA (Nano Banana) ──
  async function generateHolidayFlyer() {
    if (iaGenerating) return;
    if (!iaMainText.trim()) {
      setIaError('Digite o texto principal (ex: "Feliz Dia das Mães")');
      return;
    }
    setIaGenerating(true);
    setIaError(null);
    setFinalUrl(null);
    setUploadError(null);

    // Monta o prompt usando os mesmos presets da tool generate_holiday_flyer
    const HOLIDAY_CFG: Record<string, { scene: string; palette: string; vibe: string }> = {
      maes:                 { scene: 'tender Mother\'s Day scene with mother joyfully holding a smiling baby in soft window light, floating pink rose petals',                                          palette: 'bright white background, EGP signature pink #CB1464, soft blush, rose gold',  vibe: 'tender, warm, loving' },
      pais:                 { scene: 'heartwarming Father\'s Day scene with father and child sharing a moment, bright window light',                                                                  palette: 'clean white background, EGP brand pink #CB1464 accents, warm grey',          vibe: 'strong, warm, family' },
      namorados:            { scene: 'romantic minimalist scene with floating pink roses and elegant hearts, bright airy background',                                                                 palette: 'pure white background, EGP brand pink #CB1464, blush rose',                  vibe: 'romantic, elegant, fresh' },
      criancas:             { scene: 'joyful Children\'s Day scene with floating colorful pastel balloons, candies, playful stars on bright white background',                                        palette: 'white dominant background, EGP brand pink #CB1464, pastel rainbow accents',   vibe: 'playful, joyful, bright' },
      professor:            { scene: 'elegant tribute to teachers: open book, eyeglasses, apple and chalk elements with pink ribbon details, bright clean background',                                palette: 'white background, EGP pink #CB1464 accents, soft gold',                      vibe: 'respectful, scholarly, modern' },
      natal:                { scene: 'elegant minimalist Christmas scene with decorated tree, soft falling snowflakes, golden lights, pink and gold ornaments',                                       palette: 'white background, EGP brand pink #CB1464 ornaments, classic red and gold',   vibe: 'festive, magical, warm' },
      ano_novo:             { scene: 'elegant New Year scene with golden fireworks, champagne glasses and confetti on bright minimalist white background',                                            palette: 'bright white background, gold and EGP pink #CB1464 confetti, silver',         vibe: 'celebratory, hopeful, glamorous' },
      pascoa:               { scene: 'Easter scene with pastel decorated eggs, spring flowers, soft bunny silhouettes on bright white background',                                                    palette: 'clean white background, EGP brand pink #CB1464, pastel mint, lavender',      vibe: 'fresh, joyful, spring' },
      independencia:        { scene: 'tasteful Brazilian Independence Day scene with subtle Brazilian flag color accents (green, yellow, blue) and EGP pink details, clean white background',         palette: 'white background, Brazilian flag colors with EGP brand pink #CB1464 ribbon',  vibe: 'patriotic, modern, clean' },
      consumidor:           { scene: 'customer appreciation scene with elegant shopping bags, gift boxes and stars on bright minimalist white background',                                            palette: 'bright white background, EGP brand pink #CB1464, soft gold',                  vibe: 'grateful, premium, fresh' },
      consciencia_negra:    { scene: 'powerful tribute scene celebrating Black consciousness with diverse smiling people portraits and traditional pattern accents',                                  palette: 'warm cream and white background, rich earth tones, gold, deep red, EGP pink #CB1464',  vibe: 'powerful, dignified, respectful' },
      black_friday:         { scene: 'bold modern sales promotion scene with price tags, shopping bags and dynamic geometric elements',                                                               palette: 'bright white and EGP pink #CB1464 dominant, bold black price tags',          vibe: 'energetic, modern, fresh' },
      aniversario_empresa:  { scene: 'corporate anniversary celebration with elegant balloons, golden confetti and EGP pink accents on bright background',                                            palette: 'bright white background, EGP brand pink #CB1464 dominant, gold and silver',  vibe: 'celebratory, premium, professional' },
      outro:                { scene: 'beautiful corporate celebration scene on bright clean white background with pink decorative accents',                                                           palette: 'white background dominant, EGP brand pink #CB1464 accents',                  vibe: 'professional, fresh' },
    };
    const STYLE_QUALIFIER: Record<string, string> = {
      suave:    'soft airy lighting, dreamy bokeh, romantic atmosphere',
      vibrante: 'vibrant saturated colors with bright background, dynamic energetic',
      elegante: 'refined elegant composition, premium magazine-quality, sophisticated bright lighting',
      festivo:  'cheerful festive atmosphere on bright background, decorative elements',
    };
    const cfg = HOLIDAY_CFG[iaHoliday] ?? HOLIDAY_CFG.outro;
    const palette = iaPalette.trim() ? `${iaPalette.trim()}, with EGP brand pink #CB1464 as accent` : cfg.palette;

    const textInstr = iaSecondary.trim()
      ? `Large elegant calligraphic script text "${iaMainText.trim()}" in EGP pink #CB1464 as the main visual, with smaller text "${iaSecondary.trim()}" nearby.`
      : `Large elegant calligraphic script text "${iaMainText.trim()}" in EGP pink #CB1464 as the main visual.`;

    const prompt = [
      'Professional EGP-branded marketing flyer for social media (Instagram post).',
      cfg.scene + '.',
      textInstr,
      `Color palette: ${palette}.`,
      STYLE_QUALIFIER[iaStyle] + '.',
      `Mood: ${cfg.vibe}.`,
      `IMPORTANT BRANDING: bright white or very light background dominant (60-80%), EGP signature pink #CB1464 as main accent color, clean modern corporate aesthetic, NOT dark or moody.`,
      'Place the EGP logo (provided as separate input image) prominently in bottom-left corner — composite the actual logo, do NOT redraw.',
      'High quality commercial design. No watermarks. No "RESERVADO PARA LOGO" placeholder.',
    ].join(' ');

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-image-gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({
          prompt,
          skip_product_overlay: true,
          lighter_branding: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao gerar flyer');
      setFinalUrl(json.url);
      // Limpa o canvas atual pra não confundir o user
      setTemplate(null);
    } catch (err) {
      setIaError(err instanceof Error ? err.message : String(err));
    } finally {
      setIaGenerating(false);
    }
  }

  // ── Salvar como template ──
  async function handleSaveTemplate() {
    if (!finalUrl || !tplName.trim() || !template || savingTpl) return;
    setSavingTpl(true);
    setSaveTplError(null);
    setSaveTplSuccess(false);
    try {
      const payload = {
        name:             tplName.trim(),
        template_id:      template.id,
        form_data:        formData,
        product_filename: product ? product.filename.replace('.png', '') : null,
        image_url:        finalUrl,
        caption:          tplCaption.trim() || null,
        created_by:       userLabel,
      };
      const { error } = await supabase
        .from('marketing_templates')
        .upsert(payload, { onConflict: 'name' });
      if (error) throw new Error(error.message);
      setSaveTplSuccess(true);
      loadSavedTemplates(); // atualiza lista
    } catch (err) {
      setSaveTplError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTpl(false);
    }
  }

  // ── Deletar template salvo ──
  async function handleDeleteTemplate(id: string, name: string) {
    if (!confirm(`Excluir template "${name}"?`)) return;
    await supabase.from('marketing_templates').delete().eq('id', id);
    loadSavedTemplates();
  }

  // ── Envio WhatsApp ──
  async function handleSend() {
    if (!finalUrl || !phone || sending) return;
    setSending(true);
    setSendError(null);
    setSendSuccess(null);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res  = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ to: phone, image_url: finalUrl, text: caption || undefined, sender_label: userLabel }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao enviar');
      const ct = contacts.find(c => c.phone === phone);
      setSendSuccess(`Enviado para ${ct?.name ?? phone}!`);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const fmtPhone = (p: string) => {
    const d = p.replace(/\D/g, '');
    if (d.length === 13) return `(${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
    if (d.length === 12) return `(${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
    return p;
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

  return (
    <div className="flex h-full overflow-hidden">

      {/* ══ Sidebar esquerda ══════════════════════════════════════════════ */}
      <div className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white xl:w-72">

        {/* Abas */}
        <div className="flex shrink-0 border-b border-slate-200">
          {([
            { key: 'criar' as const,     label: 'Criar Novo' },
            { key: 'flyer-ia' as const,  label: '✨ Flyer IA' },
            { key: 'salvos' as const,    label: `Salvos${savedTemplates.length ? ` (${savedTemplates.length})` : ''}` },
          ]).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSidebarTab(key)}
              className={cn(
                'flex-1 py-2.5 text-xs font-medium transition-colors',
                sidebarTab === key
                  ? 'border-b-2 border-brand-500 text-brand-600'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Aba: Criar Novo */}
        {sidebarTab === 'criar' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <p className="px-2 pt-1 text-[10px] text-slate-400 uppercase tracking-wide font-medium">Tipos de template</p>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTemplate(t)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                  template?.id === t.id && !finalUrl
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="text-sm font-medium text-slate-900">{t.name}</span>
                  <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', CATEGORY_COLOR[t.categoryLabel] ?? 'bg-slate-100 text-slate-600')}>
                    {t.categoryLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-snug">{t.description}</p>
              </button>
            ))}
          </div>
        )}

        {/* Aba: Flyer IA (Nano Banana — flyer comemorativo via IA) */}
        {sidebarTab === 'flyer-ia' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
              <p className="text-xs font-medium text-purple-900">Flyer comemorativo via IA</p>
              <p className="mt-0.5 text-[10px] text-purple-700 leading-snug">
                A IA gera o flyer do zero com cena temática + texto desenhado + identidade EGP. Demora 15-30s.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Ocasião</label>
              <select
                value={iaHoliday}
                onChange={(e) => {
                  const v = e.target.value;
                  setIaHoliday(v);
                  // Auto-preenche o texto principal com sugestão da ocasião
                  const def = HOLIDAYS.find((h) => h.value === v)?.defaultText;
                  if (def && !iaMainText) setIaMainText(def);
                }}
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {HOLIDAYS.map((h) => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Texto principal (CURTO — 3 a 5 palavras)
              </label>
              <input
                type="text"
                value={iaMainText}
                onChange={(e) => setIaMainText(e.target.value)}
                maxLength={60}
                placeholder="Ex: Feliz Dia das Mães"
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-0.5 text-[10px] text-slate-400">É o que vai aparecer DESENHADO no flyer. Mantenha curto.</p>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Texto secundário (opcional)
              </label>
              <input
                type="text"
                value={iaSecondary}
                onChange={(e) => setIaSecondary(e.target.value)}
                maxLength={60}
                placeholder="Ex: 12 de Maio"
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Estilo</label>
              <select
                value={iaStyle}
                onChange={(e) => setIaStyle(e.target.value as any)}
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="suave">Suave (pastel, romântico)</option>
                <option value="vibrante">Vibrante (cores fortes)</option>
                <option value="elegante">Elegante (premium)</option>
                <option value="festivo">Festivo (alegre, colorido)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Cores (opcional, sobrescreve o default)
              </label>
              <input
                type="text"
                value={iaPalette}
                onChange={(e) => setIaPalette(e.target.value)}
                placeholder="Ex: rosa pastel e dourado"
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {iaError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
                {iaError}
              </div>
            )}

            <button
              type="button"
              onClick={generateHolidayFlyer}
              disabled={iaGenerating || !iaMainText.trim()}
              className={cn(
                'w-full rounded-md py-2 text-xs font-medium transition-colors',
                iaGenerating || !iaMainText.trim()
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-brand-600 text-white hover:bg-brand-700',
              )}
            >
              {iaGenerating ? 'Gerando flyer… (15-30s)' : '✨ Gerar Flyer'}
            </button>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              Após gerar, use os botões da direita pra enviar via WhatsApp.
            </p>
          </div>
        )}

        {/* Aba: Templates Salvos */}
        {sidebarTab === 'salvos' && (
          <div className="flex-1 overflow-y-auto">
            {loadingSaved ? (
              <p className="p-4 text-xs text-slate-400">Carregando…</p>
            ) : savedTemplates.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-sm text-slate-500 font-medium">Nenhum template salvo</p>
                <p className="mt-1 text-xs text-slate-400">Crie um template e salve com um nome para aparecer aqui</p>
                <button
                  type="button"
                  onClick={() => setSidebarTab('criar')}
                  className="mt-3 rounded-lg bg-brand-50 border border-brand-200 px-3 py-1.5 text-xs text-brand-600 font-medium hover:bg-brand-100"
                >
                  Criar primeiro template
                </button>
              </div>
            ) : (
              <div className="p-2 space-y-1.5">
                {savedTemplates.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-slate-100 bg-white overflow-hidden hover:border-slate-200 transition-colors"
                  >
                    {/* Preview da imagem */}
                    <img
                      src={s.image_url}
                      alt={s.name}
                      className="w-full h-28 object-cover object-top"
                    />
                    <div className="p-2">
                      <p className="text-xs font-semibold text-slate-900 truncate">{s.name}</p>
                      <p className="text-[10px] text-slate-400 mb-2">{fmtDate(s.created_at)}</p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => loadSaved(s)}
                          className="flex-1 rounded-md bg-brand-50 border border-brand-200 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors"
                        >
                          Usar / Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplate(s.id, s.name)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-red-400 hover:bg-red-50 hover:border-red-200 transition-colors"
                          title="Excluir"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ Painel central: formulário ════════════════════════════════════ */}
      {!template ? (
        <div className="flex flex-1 items-center justify-center bg-slate-50">
          <div className="text-center">
            <div className="mb-3 text-5xl">🎨</div>
            <p className="text-sm font-medium text-slate-700">Selecione um template à esquerda</p>
            <p className="mt-1 text-xs text-slate-400">o preview atualiza em tempo real conforme você preenche</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white xl:w-96">
            <div className="shrink-0 border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">{template.name}</h2>
              <button
                type="button"
                onClick={() => { setTemplate(null); setFinalUrl(null); }}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                trocar
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Seletor de produto */}
              {template.supportsProduct && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Foto do Produto</label>
                    {product && (
                      <button type="button" onClick={() => setProduct(null)} className="text-[11px] text-slate-400 hover:text-red-500">remover</button>
                    )}
                  </div>
                  {product ? (
                    <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 p-2">
                      <img src={product.url} alt={product.name} className="h-10 w-10 rounded object-contain" />
                      <p className="text-xs font-medium text-slate-800">{product.name}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2 bg-slate-50">
                      {PRODUCTS.map((p) => (
                        <button
                          key={p.filename}
                          type="button"
                          onClick={() => setProduct(p)}
                          title={p.name}
                          className="flex flex-col items-center gap-1 rounded p-1.5 hover:bg-white hover:shadow-sm transition-all"
                        >
                          <img src={p.url} alt={p.name} className="h-9 w-9 object-contain" />
                          <span className="text-[9px] text-slate-500 text-center leading-tight line-clamp-2">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Campos */}
              {template.fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {field.label}
                    {field.required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>
                  {field.type === 'color' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={formData[field.key] ?? field.defaultValue ?? '#25a244'}
                        onChange={(e) => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className="h-8 w-12 cursor-pointer rounded border border-slate-200"
                      />
                      <span className="text-xs text-slate-500">{formData[field.key] ?? field.defaultValue}</span>
                    </div>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      value={formData[field.key] ?? ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      rows={3}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
                    />
                  ) : (
                    <input
                      type="text"
                      value={formData[field.key] ?? ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  )}
                  {field.hint && <p className="mt-0.5 text-[10px] text-slate-400">{field.hint}</p>}
                </div>
              ))}
            </div>

            {/* Ações */}
            <div className="shrink-0 border-t border-slate-100 p-4 space-y-3">

              {!finalUrl ? (
                <>
                  <button
                    type="button"
                    onClick={handleUpload}
                    disabled={uploading || rendering}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                  >
                    {uploading
                      ? <><Spinner /> Salvando…</>
                      : 'Gerar imagem'
                    }
                  </button>
                  {uploadError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{uploadError}</p>}
                </>
              ) : (
                <>
                  {/* Download + Refazer */}
                  <div className="flex gap-2">
                    <a
                      href={finalUrl}
                      download
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() => { setFinalUrl(null); setSaveTplSuccess(false); setSendSuccess(null); }}
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Refazer
                    </button>
                  </div>

                  {/* ── Salvar como template ── */}
                  <div className="space-y-2 pt-1 border-t border-slate-100">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                      Salvar como Template
                    </p>
                    <input
                      type="text"
                      value={tplName}
                      onChange={e => setTplName(e.target.value)}
                      placeholder="Nome do template (ex: Promoção Controle Maio)"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={tplCaption}
                      onChange={e => setTplCaption(e.target.value)}
                      placeholder="Legenda padrão do WhatsApp (opcional)"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleSaveTemplate}
                      disabled={!tplName.trim() || savingTpl}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
                    >
                      {savingTpl ? <><Spinner />Salvando…</> : '💾 Salvar template'}
                    </button>
                    {saveTplSuccess && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">Template salvo! A IA já pode usá-lo pelo nome.</p>}
                    {saveTplError  && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{saveTplError}</p>}
                  </div>

                  {/* ── Envio WhatsApp ── */}
                  <div className="space-y-2 pt-1 border-t border-slate-100">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Enviar via WhatsApp</p>
                    <select
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      onFocus={loadContacts}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                    >
                      <option value="">Selecione o contato…</option>
                      {contacts.map(c => (
                        <option key={c.phone} value={c.phone}>
                          {c.name ? `${c.name} — ${fmtPhone(c.phone)}` : fmtPhone(c.phone)}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={caption}
                      onChange={e => setCaption(e.target.value)}
                      placeholder="Legenda (opcional)"
                      rows={2}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-green-500 focus:outline-none resize-none"
                    />
                    {sendError   && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{sendError}</p>}
                    {sendSuccess && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">{sendSuccess}</p>}
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!phone || sending}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {sending ? <><Spinner />Enviando…</> : <>
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                        Enviar via WhatsApp
                      </>}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ══ Preview canvas ════════════════════════════════════════════ */}
          <div className="flex flex-1 flex-col items-center justify-start overflow-y-auto bg-slate-100 p-6 gap-3">
            <div className="flex shrink-0 items-center gap-2">
              <p className="text-xs text-slate-500 font-medium">Preview ao vivo</p>
              {rendering && <Spinner className="text-slate-400" />}
            </div>
            <canvas
              ref={canvasRef}
              className="rounded-xl shadow-xl"
              style={{
                aspectRatio: `${template.canvasW} / ${template.canvasH}`,
                maxHeight: 'calc(100vh - 9rem)',
                maxWidth: '100%',
                width: 'auto',
                height: 'auto',
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/>
    </svg>
  );
}
