import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { PricingMode, Product, ProductWithCost } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Label, Textarea } from '@/components/ui/Input';
import { formatBRL } from '@/lib/utils';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

interface KitComponent {
  id: string;                    // product_kits.id (vazio se ainda não salvo)
  component_product_id: string;
  component_product_name: string;
  unit_cost: number;
  quantity: number;
}

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
  name: string;
  unitCostBRL: number;
  description: string;
  image_url: string | null;
  pricing_mode: PricingMode;
  custom_markup_pct: number | null;
  show_price: boolean;
  is_kit: boolean;
  product_type: 'fabricacao' | 'revenda';
  // revenda
  unit: string;
  direct_cost_brl: number | null;
}

export default function ProductsPage() {
  const [tab, setTab] = useState<'fabricacao' | 'revenda'>('fabricacao');
  const [products, setProducts] = useState<ProductWithCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [form, setForm] = useState<CommercialForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // ── Kit ──
  const [kitComponents, setKitComponents]   = useState<KitComponent[]>([]);
  const [kitSearch, setKitSearch]           = useState('');
  const [kitBomExpanded, setKitBomExpanded] = useState<{ component_name: string; component_sku: string | null; total_quantity: number; component_unit: string | null }[]>([]);
  const kitSearchRef = useRef<HTMLInputElement>(null);

  useBodyScrollLock(!!form);

  async function loadKitBomExpanded(kitProductId: string) {
    const { data } = await supabase
      .from('kit_bom_expanded')
      .select('component_name, component_sku, total_quantity, component_unit')
      .eq('kit_product_id', kitProductId)
      .order('component_name');
    setKitBomExpanded((data ?? []) as any[]);
  }

  async function loadKitComponents(kitProductId: string) {
    const { data } = await supabase
      .from('product_kits')
      .select('id, component_product_id, quantity, component:products!component_product_id(name, unit_cost_brl:products_with_cost(unit_cost_brl))')
      .eq('kit_product_id', kitProductId);
    // Fallback: busca simples se a relação aninhada não funcionar
    if (!data) { setKitComponents([]); return; }
    const rows = await Promise.all((data as any[]).map(async (r) => {
      const { data: prod } = await supabase
        .from('products_with_cost').select('name, unit_cost_brl').eq('id', r.component_product_id).single();
      return {
        id:                     r.id,
        component_product_id:   r.component_product_id,
        component_product_name: (prod as any)?.name ?? r.component_product_id,
        unit_cost:              Number((prod as any)?.unit_cost_brl ?? 0),
        quantity:               Number(r.quantity),
      };
    }));
    setKitComponents(rows);
  }

  async function addKitComponent(product: ProductWithCost) {
    if (kitComponents.find(c => c.component_product_id === product.id)) return;
    setKitComponents(prev => [...prev, {
      id: '',
      component_product_id:   product.id,
      component_product_name: product.name,
      unit_cost:              Number((product as any).unit_cost_brl ?? 0),
      quantity:               1,
    }]);
    setKitSearch('');
  }

  function removeKitComponent(productId: string) {
    setKitComponents(prev => prev.filter(c => c.component_product_id !== productId));
  }

  function updateKitQty(productId: string, qty: number) {
    setKitComponents(prev => prev.map(c =>
      c.component_product_id === productId ? { ...c, quantity: qty } : c
    ));
  }

  async function saveKitComponents(kitProductId: string) {
    // Delete all existing and re-insert
    await supabase.from('product_kits').delete().eq('kit_product_id', kitProductId);
    if (kitComponents.length > 0) {
      await supabase.from('product_kits').insert(
        kitComponents.map(c => ({
          kit_product_id:       kitProductId,
          component_product_id: c.component_product_id,
          quantity:             c.quantity,
        }))
      );
    }
  }

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
    setKitComponents([]);
    setKitSearch('');
    const isKit = (p as any).is_kit ?? false;
    setForm({
      id: p.id,
      name: p.name,
      unitCostBRL: Number(p.unit_cost_brl),
      description: p.description ?? '',
      image_url: p.image_url,
      pricing_mode: p.pricing_mode,
      custom_markup_pct: p.custom_markup_pct != null ? Number(p.custom_markup_pct) : null,
      show_price:      (p as any).show_price      ?? false,
      is_kit:          isKit,
      product_type:    ((p as any).product_type   ?? 'fabricacao') as 'fabricacao' | 'revenda',
      unit:            (p as any).unit            ?? '',
      direct_cost_brl: (p as any).direct_cost_brl != null ? Number((p as any).direct_cost_brl) : null,
    });
    if (isKit) { loadKitComponents(p.id); loadKitBomExpanded(p.id); }
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
      show_price:      form.show_price,
      is_kit:          form.is_kit,
      product_type:    form.product_type,
      unit:            form.unit.trim() || null,
      direct_cost_brl: form.product_type === 'revenda' ? (form.direct_cost_brl ?? null) : null,
    } as any;

    const { error } = await supabase.from('products').update(productPayload).eq('id', form.id);
    if (error) { setSaving(false); setFormError(error.message); return; }
    if (form.is_kit) { await saveKitComponents(form.id); await loadKitBomExpanded(form.id); }
    setSaving(false);
    closeForm();
    await loadProducts();
  }

  const tabProducts = products.filter(p => ((p as any).product_type ?? 'fabricacao') === tab);

  return (
    <div className="p-8">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-slate-900">Produtos</h1>
        <p className="text-sm text-slate-500">
          Catálogo comercial. Edite foto, descrição e markup.
        </p>
      </div>

      {/* ── Tabs ── */}
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {([
          { id: 'fabricacao', label: '🔧 Fabricação', hint: 'com BOM e componentes' },
          { id: 'revenda',    label: '📦 Revenda',    hint: 'custo direto, sem BOM' },
        ] as const).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            <span className="text-xs font-normal text-slate-400">({tabProducts.length > 0 && tab === t.id ? tabProducts.length : products.filter(p => ((p as any).product_type ?? 'fabricacao') === t.id).length})</span>
          </button>
        ))}
      </div>

      {listError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {listError}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : tabProducts.length === 0 ? (
        <Card>
          <div className="p-6 text-sm text-slate-600">
            {tab === 'fabricacao'
              ? <>Nenhum produto de fabricação cadastrado. Crie na aba <strong>Custos</strong>.</>
              : 'Nenhum produto de revenda cadastrado ainda.'}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tabProducts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openProduct(p)}
              className="group flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition-all hover:border-brand-300 hover:shadow-md"
            >
              <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
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
                {(p as any).unit && (
                  <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{(p as any).unit}</span>
                )}
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex items-baseline justify-between">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Custo</dt>
                    <dd className="text-slate-700">
                      {Number(p.unit_cost_brl) > 0 ? formatBRL(Number(p.unit_cost_brl)) : '—'}
                    </dd>
                  </div>
                  {p.sale_price_brl != null && (
                    <div className="flex items-baseline justify-between">
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Venda</dt>
                      <dd className="font-semibold text-brand-600">{formatBRL(Number(p.sale_price_brl))}</dd>
                    </div>
                  )}
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
                    {form.product_type === 'revenda' ? (
                      <>
                        {/* Custo direto */}
                        <div>
                          <Label htmlFor="prd-cost">Custo direto (R$)</Label>
                          <input
                            id="prd-cost"
                            type="number"
                            min={0}
                            step={0.01}
                            value={form.direct_cost_brl ?? ''}
                            onChange={e => patchForm({ direct_cost_brl: e.target.value === '' ? null : Number(e.target.value) })}
                            placeholder="0,00"
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                          />
                        </div>
                        {/* Unidade */}
                        <div>
                          <Label htmlFor="prd-unit">Unidade de medida</Label>
                          <input
                            id="prd-unit"
                            type="text"
                            value={form.unit}
                            onChange={e => patchForm({ unit: e.target.value })}
                            placeholder="ex: kg, rolo, metro, caixa, un"
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                          />
                        </div>
                      </>
                    ) : (
                      <div>
                        <Label>Custo unitário</Label>
                        <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                          {form.unitCostBRL > 0 ? formatBRL(form.unitCostBRL) : '—'}
                        </div>
                        <p className="mt-1 text-xs text-slate-400">Calculado a partir da BOM na aba Custos.</p>
                      </div>
                    )}
                    <div>
                      <Label htmlFor="prd-desc">
                        {form.product_type === 'revenda' ? 'Informações complementares' : 'Descrição de venda'}
                      </Label>
                      <Textarea
                        id="prd-desc"
                        value={form.description}
                        onChange={(e) => patchForm({ description: e.target.value })}
                        placeholder={form.product_type === 'revenda' ? 'Especificações, referência do fornecedor, observações…' : 'Texto comercial pra catálogo / proposta'}
                      />
                    </div>
                  </div>
                </div>

                {/* Kit só para fabricação */}
                {form.product_type === 'fabricacao' && (<>
                <div>
                  <Label>Composição do produto</Label>
                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {form.is_kit ? '🧩 Kit (composto por outros produtos)' : 'Produto simples'}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {form.is_kit
                          ? 'BOM e custo calculados a partir dos produtos abaixo.'
                          : 'Ative para montar esse produto a partir de outros produtos.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !form.is_kit;
                        patchForm({ is_kit: next });
                        if (next && form.id) loadKitComponents(form.id);
                        else setKitComponents([]);
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                        form.is_kit ? 'bg-brand-600' : 'bg-slate-300'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        form.is_kit ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </button>
                  </label>
                </div>

                {/* ── Componentes do kit ── */}
                {form.is_kit && (
                  <div className="space-y-3">
                    <Label>Produtos do kit</Label>

                    {kitComponents.length > 0 && (
                      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                        {kitComponents.map(c => (
                          <div key={c.component_product_id} className="flex items-center gap-3 px-3 py-2">
                            <span className="flex-1 text-sm text-slate-800">{c.component_product_name}</span>
                            <span className="text-xs text-slate-400">
                              custo: {c.unit_cost > 0 ? formatBRL(c.unit_cost * c.quantity) : '—'}
                            </span>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-slate-400">qtd</span>
                              <input
                                type="number"
                                min={1}
                                value={c.quantity}
                                onChange={e => updateKitQty(c.component_product_id, Number(e.target.value) || 1)}
                                className="w-14 rounded border border-slate-200 px-2 py-0.5 text-sm text-center"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeKitComponent(c.component_product_id)}
                              className="text-red-400 hover:text-red-600 text-sm font-bold px-1"
                            >×</button>
                          </div>
                        ))}
                        <div className="flex justify-end px-3 py-2 bg-slate-50">
                          <span className="text-xs text-slate-500">
                            Custo total do kit:{' '}
                            <strong>{formatBRL(kitComponents.reduce((s, c) => s + c.unit_cost * c.quantity, 0))}</strong>
                          </span>
                        </div>
                      </div>
                    )}

                    {/* BOM expandida (só leitura — atualiza automaticamente quando muda BOM dos componentes) */}
                    {kitBomExpanded.length > 0 && (
                      <details className="rounded-lg border border-slate-100 bg-slate-50">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-500 select-none">
                          BOM expandida — {kitBomExpanded.length} componentes raw (atualiza automaticamente)
                        </summary>
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {kitBomExpanded.map(b => (
                            <div key={b.component_name} className="flex justify-between px-3 py-1.5 text-xs">
                              <span className="text-slate-700">
                                {b.component_name}
                                {b.component_sku && <span className="ml-1 text-slate-400">({b.component_sku})</span>}
                              </span>
                              <span className="text-slate-500 font-medium">
                                {Number(b.total_quantity)} {b.component_unit ?? 'un'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Busca de produto para adicionar */}
                    <div className="relative">
                      <input
                        ref={kitSearchRef}
                        type="text"
                        value={kitSearch}
                        onChange={e => setKitSearch(e.target.value)}
                        placeholder="Buscar produto para adicionar ao kit…"
                        className="w-full rounded-lg border border-dashed border-brand-400 bg-brand-50 px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
                      />
                      {kitSearch.trim().length >= 1 && (
                        <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                          {products
                            .filter(p =>
                              p.id !== form.id &&
                              !kitComponents.find(c => c.component_product_id === p.id) &&
                              p.name.toLowerCase().includes(kitSearch.toLowerCase())
                            )
                            .slice(0, 8)
                            .map(p => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => addKitComponent(p)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between"
                              >
                                <span>{p.name}</span>
                                <span className="text-xs text-slate-400">
                                  {(p as any).unit_cost_brl > 0 ? formatBRL(Number((p as any).unit_cost_brl)) : '—'}
                                </span>
                              </button>
                            ))}
                          {products.filter(p =>
                            p.id !== form.id &&
                            !kitComponents.find(c => c.component_product_id === p.id) &&
                            p.name.toLowerCase().includes(kitSearch.toLowerCase())
                          ).length === 0 && (
                            <p className="px-3 py-2 text-xs text-slate-400">Nenhum produto encontrado</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                </>)}

                <div>
                  <Label>Visibilidade do preço no WhatsApp</Label>
                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {form.show_price ? '✅ Preço visível para o cliente' : '🔒 Preço oculto — consultora informa'}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {form.show_price
                          ? 'A IA mostra o preço ao responder no WhatsApp.'
                          : 'A IA direciona para a consultora quando perguntarem o preço.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => patchForm({ show_price: !form.show_price })}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                        form.show_price ? 'bg-brand-600' : 'bg-slate-300'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        form.show_price ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </button>
                  </label>
                </div>

                {form.product_type === 'fabricacao' && <div>
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
                </div>}
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
