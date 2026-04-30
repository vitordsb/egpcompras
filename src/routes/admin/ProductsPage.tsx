import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { PricingMode, Product, ProductWithCost } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Label, Textarea } from '@/components/ui/Input';
import { formatBRL } from '@/lib/utils';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

function priceFor(cost: number, mode: PricingMode, customPct: number | null): number | null {
  if (cost <= 0) return null;
  switch (mode) {
    case 'markup_30': return cost * 1.30;
    case 'markup_50': return cost * 1.50;
    case 'ponto_7':   return cost / 0.7;
    case 'custom':
      if (customPct == null) return null;
      return cost * (1 + customPct / 100);
  }
}

interface CommercialForm {
  id: string;
  name: string;            // read-only
  unitCostBRL: number;     // read-only
  description: string;
  image_url: string | null;
  pricing_mode: PricingMode;
  custom_markup_pct: number | null;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductWithCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [form, setForm] = useState<CommercialForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useBodyScrollLock(!!form);

  async function loadProducts() {
    setLoading(true);
    const { data, error } = await supabase
      .from('products_with_cost')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) setListError(error.message);
    else setProducts((data ?? []) as ProductWithCost[]);
    setLoading(false);
  }

  useEffect(() => {
    loadProducts();
  }, []);

  function openProduct(p: ProductWithCost) {
    setFormError(null);
    setForm({
      id: p.id,
      name: p.name,
      unitCostBRL: Number(p.unit_cost_brl),
      description: p.description ?? '',
      image_url: p.image_url,
      pricing_mode: p.pricing_mode,
      custom_markup_pct: p.custom_markup_pct != null ? Number(p.custom_markup_pct) : null,
    });
  }

  function closeForm() {
    setForm(null);
    setFormError(null);
  }

  function patchForm(patch: Partial<CommercialForm>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function uploadPhoto(e: ChangeEvent<HTMLInputElement>) {
    if (!form) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setFormError(null);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('product-images')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setFormError(`Falha no upload: ${upErr.message}`);
      setUploadingPhoto(false);
      return;
    }
    const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path);
    patchForm({ image_url: urlData.publicUrl });
    setUploadingPhoto(false);
    e.target.value = '';
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormError(null);
    if (form.pricing_mode === 'custom' && (form.custom_markup_pct == null || form.custom_markup_pct < 0)) {
      setFormError('Informe um percentual válido pro modo customizado.');
      return;
    }
    setSaving(true);

    const computedRaw = priceFor(form.unitCostBRL, form.pricing_mode, form.custom_markup_pct);
    const computedSalePrice = computedRaw != null ? Number(computedRaw.toFixed(2)) : null;

    const productPayload: Partial<Product> = {
      description: form.description.trim() || null,
      image_url: form.image_url,
      pricing_mode: form.pricing_mode,
      custom_markup_pct: form.pricing_mode === 'custom' ? form.custom_markup_pct : null,
      sale_price_brl: computedSalePrice,
    };

    const { error } = await supabase.from('products').update(productPayload).eq('id', form.id);
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeForm();
    await loadProducts();
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Produtos</h1>
        <p className="text-sm text-slate-500">
          Catálogo comercial. Edite foto, descrição de venda e markup. Pra alterar BOM e custo,
          vá pra aba <strong>Custos</strong>.
        </p>
      </div>

      {listError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {listError}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : products.length === 0 ? (
        <Card>
          <div className="p-6 text-sm text-slate-600">
            Nenhum produto cadastrado ainda. Crie o primeiro na aba <strong>Custos</strong>.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openProduct(p)}
              className="group flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition-all hover:border-brand-300 hover:shadow-md"
            >
              <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-300">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-12 w-12">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex-1 p-4">
                <h3 className="font-medium text-slate-900 line-clamp-2">{p.name}</h3>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex items-baseline justify-between">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Venda</dt>
                    <dd className="font-semibold text-brand-600">
                      {p.sale_price_brl != null ? formatBRL(Number(p.sale_price_brl)) : '—'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Custo</dt>
                    <dd className="text-slate-700">
                      {Number(p.unit_cost_brl) > 0 ? formatBRL(Number(p.unit_cost_brl)) : '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Modal comercial — sem BOM, sem nome editável, sem excluir */}
      {form && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeForm}
        >
          <div
            className="flex h-[min(720px,92vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={save} className="flex flex-1 flex-col overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">{form.name}</h2>
                <p className="text-xs text-slate-500">
                  Edição comercial — foto, descrição de venda e markup. Custo unitário e BOM são
                  ajustados na aba <strong>Custos</strong>.
                </p>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                {formError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </div>
                )}

                <div className="grid gap-5 md:grid-cols-[200px_1fr]">
                  <div>
                    <Label>Foto</Label>
                    <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                      {form.image_url ? (
                        <img src={form.image_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-300 text-xs">
                          sem foto
                        </div>
                      )}
                    </div>
                    <label className="mt-2 inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 h-8 text-xs font-medium text-slate-700 hover:bg-slate-50">
                      {uploadingPhoto ? 'Enviando…' : form.image_url ? 'Trocar foto' : 'Enviar foto'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={uploadPhoto}
                        disabled={uploadingPhoto}
                      />
                    </label>
                    {form.image_url && (
                      <button
                        type="button"
                        onClick={() => patchForm({ image_url: null })}
                        className="mt-1 block text-xs text-red-600 hover:underline"
                      >
                        remover foto
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <Label>Custo unitário</Label>
                      <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                        {form.unitCostBRL > 0 ? formatBRL(form.unitCostBRL) : '—'}
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Definido na aba Custos a partir da BOM.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="prd-desc">Descrição de venda</Label>
                      <Textarea
                        id="prd-desc"
                        value={form.description}
                        onChange={(e) => patchForm({ description: e.target.value })}
                        placeholder="Texto comercial pra catálogo / proposta"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <Label>Preço de venda (escolha o modo)</Label>
                  <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
                    {([
                      { mode: 'markup_30', label: '30% markup', hint: 'custo × 1,30' },
                      { mode: 'markup_50', label: '50% markup', hint: 'custo × 1,50' },
                      { mode: 'ponto_7',   label: 'Ponto 7',    hint: 'margem 30% s/ venda' },
                    ] as const).map(({ mode, label, hint }) => {
                      const isActive = form.pricing_mode === mode;
                      const value = priceFor(form.unitCostBRL, mode, null);
                      return (
                        <label
                          key={mode}
                          className={`flex cursor-pointer items-center justify-between rounded px-2 py-1.5 transition-colors ${
                            isActive ? 'bg-brand-50' : 'hover:bg-white'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="pricing_mode"
                              className="accent-brand-600"
                              checked={isActive}
                              onChange={() => patchForm({ pricing_mode: mode })}
                            />
                            <span className={isActive ? 'font-medium text-slate-900' : 'text-slate-700'}>
                              {label}
                            </span>
                            <span className="text-xs text-slate-400">{hint}</span>
                          </span>
                          <span className={isActive ? 'font-semibold text-brand-700' : 'text-slate-900'}>
                            {value != null ? formatBRL(value) : '—'}
                          </span>
                        </label>
                      );
                    })}
                    <label
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 transition-colors ${
                        form.pricing_mode === 'custom' ? 'bg-brand-50' : 'hover:bg-white'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="pricing_mode"
                          className="accent-brand-600"
                          checked={form.pricing_mode === 'custom'}
                          onChange={() => patchForm({ pricing_mode: 'custom' })}
                        />
                        <span
                          className={
                            form.pricing_mode === 'custom'
                              ? 'font-medium text-slate-900'
                              : 'text-slate-700'
                          }
                        >
                          Customizado
                        </span>
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          value={form.custom_markup_pct ?? ''}
                          onChange={(e) =>
                            patchForm({
                              pricing_mode: 'custom',
                              custom_markup_pct:
                                e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          placeholder="0"
                          className="h-7 w-20 rounded border border-slate-300 px-2 text-sm"
                        />
                        <span className="text-xs text-slate-400">% markup</span>
                      </span>
                      <span
                        className={
                          form.pricing_mode === 'custom'
                            ? 'font-semibold text-brand-700'
                            : 'text-slate-900'
                        }
                      >
                        {(() => {
                          const v = priceFor(form.unitCostBRL, 'custom', form.custom_markup_pct);
                          return v != null ? formatBRL(v) : '—';
                        })()}
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
                <Button type="button" variant="secondary" onClick={closeForm}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Salvando…' : 'Salvar alterações'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
