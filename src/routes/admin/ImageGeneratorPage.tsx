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

// ─── Constantes ───────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  Promoção:   'bg-orange-100 text-orange-700',
  Aviso:      'bg-purple-100 text-purple-700',
  Lançamento: 'bg-blue-100 text-blue-700',
};

// ─── Componente ───────────────────────────────────────────────────────────

export default function ImageGeneratorPage() {
  const { userLabel } = useInternalAuth();

  const [template, setTemplate]         = useState<TemplateDefinition | null>(null);
  const [formData, setFormData]         = useState<Record<string, string>>({});
  const [product, setProduct]           = useState<ProductEntry | null>(null);
  const [rendering, setRendering]       = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [finalUrl, setFinalUrl]         = useState<string | null>(null);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const [sending, setSending]           = useState(false);
  const [sendError, setSendError]       = useState<string | null>(null);
  const [sendSuccess, setSendSuccess]   = useState<string | null>(null);
  const [contacts, setContacts]         = useState<{ phone: string; name: string | null }[]>([]);
  const [phone, setPhone]               = useState('');
  const [caption, setCaption]           = useState('');
  const [contactsLoaded, setContactsLoaded] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Inicializa formData com defaultValues do template
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
    setCaption('');
  }

  // Renderiza o canvas sempre que os dados mudarem
  const renderCanvas = useCallback(async () => {
    if (!template || !canvasRef.current) return;
    setRendering(true);
    try {
      const canvas = canvasRef.current;
      canvas.width  = template.canvasW;
      canvas.height = template.canvasH;

      // Interpreta \n literal como quebra de linha real nos campos de texto
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
    const t = setTimeout(renderCanvas, 120); // debounce 120ms
    return () => clearTimeout(t);
  }, [renderCanvas]);

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

  // Exporta canvas → base64 → upload via Edge Function → URL permanente
  async function handleUpload() {
    if (!canvasRef.current || uploading) return;
    setUploading(true);
    setUploadError(null);
    setFinalUrl(null);

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

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Sidebar esquerda ── */}
      <div className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white xl:w-72">
        <div className="shrink-0 border-b border-slate-200 px-4 py-4">
          <h1 className="text-sm font-semibold text-slate-900">Templates de Marketing</h1>
          <p className="mt-0.5 text-xs text-slate-500">Layout fixo — troque apenas os dados</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTemplate(t)}
              className={cn(
                'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                template?.id === t.id
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
      </div>

      {/* ── Centro: formulário ── */}
      {!template ? (
        <div className="flex flex-1 items-center justify-center bg-slate-50">
          <div className="text-center">
            <div className="mb-3 text-5xl">🎨</div>
            <p className="text-sm font-medium text-slate-700">Selecione um template à esquerda</p>
            <p className="mt-1 text-xs text-slate-400">o preview atualiza em tempo real</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white xl:w-96">
            <div className="shrink-0 border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">{template.name}</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Produto (se suportado) */}
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

              {/* Campos do template */}
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

            {/* Botão salvar/enviar */}
            <div className="shrink-0 border-t border-slate-100 p-4 space-y-3">
              {!finalUrl ? (
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploading || rendering}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {uploading ? (
                    <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/></svg>Salvando…</>
                  ) : 'Salvar imagem'}
                </button>
              ) : (
                <>
                  <div className="flex gap-2">
                    <a href={finalUrl} target="_blank" rel="noreferrer" className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
                      Download
                    </a>
                    <button type="button" onClick={() => { setFinalUrl(null); setSendSuccess(null); }} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
                      Refazer
                    </button>
                  </div>

                  {/* Envio WhatsApp */}
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
                      placeholder="Legenda (opcional): ex: 10% OFF nos controles! Válido até 31/05."
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
                      {sending ? (
                        <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/></svg>Enviando…</>
                      ) : (
                        <><svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>Enviar via WhatsApp</>
                      )}
                    </button>
                  </div>
                </>
              )}
              {uploadError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{uploadError}</p>}
            </div>
          </div>

          {/* ── Preview canvas ── */}
          <div className="flex flex-1 flex-col items-center justify-start overflow-auto bg-slate-100 p-6 gap-3">
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-500 font-medium">Preview ao vivo</p>
              {rendering && (
                <svg className="h-3.5 w-3.5 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/>
                </svg>
              )}
            </div>
            <canvas
              ref={canvasRef}
              className="rounded-xl shadow-xl max-w-full max-h-[calc(100vh-10rem)] object-contain"
              style={{ width: Math.min(400, template.canvasW), height: 'auto' }}
            />
          </div>
        </>
      )}
    </div>
  );
}
