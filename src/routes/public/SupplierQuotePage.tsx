import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { fetchUsdBrl, effectivePriceBRL } from '@/lib/currency';
import { formatBRL } from '@/lib/utils';
import type { Currency } from '@/types/db';

interface ItemRow {
  quotation_item_id: string;
  component_name: string;
  quantity: number;
  target_price_brl: number | null;
  unit_price: number | null;
  ipi_pct: number | null;
  st_pct: number | null;
}

interface ResolvedQuotation {
  quotationId: string;
  title: string;
  productName: string;
  paymentTerms: string | null;
  deadline: string | null;
  inviteId: string | null;
  prefill: { supplierName: string; supplierEmail: string; supplierCurrency: Currency } | null;
}

export default function SupplierQuotePage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedQuotation | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);

  const [supplierName, setSupplierName] = useState('');
  const [supplierCnpj, setSupplierCnpj] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [currency, setCurrency] = useState<Currency>('BRL');
  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [paymentResponse, setPaymentResponse] = useState('');
  const [notes, setNotes] = useState('');
  const [expandedTax, setExpandedTax] = useState<Set<number>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);

      const inviteRes = await supabase
        .from('quotation_invites')
        .select(
          `id, status, supplier_id,
           quotation:quotations(id, title, payment_terms, public_token, deadline, product:products(name)),
           supplier:suppliers(name, email, default_currency)`
        )
        .eq('token', token)
        .maybeSingle();

      let quotationId: string | null = null;
      let inviteId: string | null = null;
      let title = '';
      let productName = '';
      let paymentTerms: string | null = null;
      let deadline: string | null = null;
      let prefill: ResolvedQuotation['prefill'] = null;
      let alreadyResponded = false;

      if (inviteRes.data) {
        const inv = inviteRes.data as any;
        if (!inv.quotation) {
          if (!cancelled) { setLoadError('Cotação não encontrada.'); setLoading(false); }
          return;
        }
        quotationId = inv.quotation.id;
        inviteId = inv.id;
        title = inv.quotation.title;
        productName = inv.quotation.product?.name ?? '';
        paymentTerms = inv.quotation.payment_terms;
        deadline = inv.quotation.deadline;
        if (inv.status === 'responded') alreadyResponded = true;
        if (!alreadyResponded && deadline && new Date(deadline).getTime() < Date.now()) {
          if (!cancelled) { setLoadError('Este link de cotação expirou. Peça um novo link ao comprador.'); setLoading(false); }
          return;
        }
        if (inv.supplier) {
          prefill = { supplierName: inv.supplier.name, supplierEmail: inv.supplier.email, supplierCurrency: inv.supplier.default_currency };
        }
      } else {
        const qRes = await supabase
          .from('quotations')
          .select('id, title, payment_terms, deadline, public_token, product:products(name)')
          .eq('public_token', token)
          .maybeSingle();
        if (qRes.data) {
          const q = qRes.data as any;
          quotationId = q.id; title = q.title; productName = q.product?.name ?? '';
          paymentTerms = q.payment_terms; deadline = q.deadline;
          if (deadline && new Date(deadline).getTime() < Date.now()) {
            if (!cancelled) { setLoadError('Este link de cotação expirou. Peça um novo link ao comprador.'); setLoading(false); }
            return;
          }
        }
      }

      if (!quotationId) {
        if (!cancelled) { setLoadError('Link inválido ou cotação não encontrada.'); setLoading(false); }
        return;
      }
      if (alreadyResponded) {
        if (!cancelled) { setSubmitted(true); setLoading(false); }
        return;
      }

      const itemsRes = await supabase
        .from('quotation_items')
        .select('id, quantity, target_price_brl, position, component:components(name), component_name_free')
        .eq('quotation_id', quotationId)
        .order('position');

      if (itemsRes.error) {
        if (!cancelled) { setLoadError(itemsRes.error.message); setLoading(false); }
        return;
      }

      const loadedItems: ItemRow[] = (itemsRes.data ?? []).map((it: any) => ({
        quotation_item_id: it.id,
        component_name: it.component?.name ?? it.component_name_free ?? '—',
        quantity: Number(it.quantity),
        target_price_brl: it.target_price_brl != null ? Number(it.target_price_brl) : null,
        unit_price: null,
        ipi_pct: null,
        st_pct: null,
      }));

      if (prefill) {
        setSupplierName(prefill.supplierName);
        setSupplierEmail(prefill.supplierEmail);
        setCurrency(prefill.supplierCurrency);
      }

      try { const fx = await fetchUsdBrl(); if (!cancelled) setUsdRate(fx.rate); } catch {}

      if (!cancelled) {
        setResolved({ quotationId, title, productName, paymentTerms, deadline, inviteId, prefill });
        setItems(loadedItems);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  function updateItem(idx: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function toggleTax(idx: number) {
    setExpandedTax((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  const totals = useMemo(() => {
    let totalEffectiveBRL = 0;
    let filledCount = 0;
    for (const it of items) {
      const eff = effectivePriceBRL({
        unitPrice: it.unit_price,
        currency,
        usdBrlRate: currency === 'USD' ? usdRate : null,
        ipiPct: (it.ipi_pct ?? 0) / 100,
        stPct: (it.st_pct ?? 0) / 100,
      });
      if (eff != null && it.unit_price != null) {
        filledCount += 1;
        totalEffectiveBRL += eff * it.quantity;
      }
    }
    return { totalEffectiveBRL, filledCount };
  }, [items, currency, usdRate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!resolved) return;
    setSubmitError(null);

    if (resolved.deadline && new Date(resolved.deadline).getTime() < Date.now())
      return setSubmitError('Este link expirou. Peça um novo link ao comprador.');
    if (!supplierName.trim()) return setSubmitError('Informe o nome da empresa.');
    if (!sellerName.trim()) return setSubmitError('Informe o nome do vendedor.');
    if (!supplierEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplierEmail.trim()))
      return setSubmitError('Informe um email válido.');
    if (totals.filledCount === 0)
      return setSubmitError('Preencha o preço de pelo menos 1 item antes de enviar.');
    if (currency === 'USD' && (!usdRate || usdRate <= 0))
      return setSubmitError('Cotação USD/BRL inválida.');

    setSubmitting(true);

    let inviteId = resolved.inviteId;
    if (!inviteId) {
      const { data, error } = await supabase.from('quotation_invites')
        .insert({ quotation_id: resolved.quotationId, supplier_id: null, status: 'responded', sent_at: new Date().toISOString(), responded_at: new Date().toISOString() })
        .select('id').single();
      if (error || !data) { setSubmitError(error?.message ?? 'Falha ao registrar resposta.'); setSubmitting(false); return; }
      inviteId = data.id as string;
    } else {
      await supabase.from('quotation_invites').update({ status: 'responded', responded_at: new Date().toISOString() }).eq('id', inviteId);
    }

    const { data: respData, error: respErr } = await supabase.from('quotation_responses')
      .insert({ invite_id: inviteId, currency, usd_brl_rate_used: currency === 'USD' ? usdRate : null, notes: notes.trim() || null, supplier_name: supplierName.trim(), supplier_cnpj: supplierCnpj.trim() || null, supplier_email: supplierEmail.trim().toLowerCase(), seller_name: sellerName.trim(), payment_response: paymentResponse.trim() || null })
      .select('id').single();
    if (respErr || !respData) { setSubmitError(respErr?.message ?? 'Falha ao salvar resposta.'); setSubmitting(false); return; }
    const responseId = respData.id as string;

    const { error: itemsErr } = await supabase.from('quotation_response_items')
      .insert(items.map((it) => ({ response_id: responseId, quotation_item_id: it.quotation_item_id, unit_price: it.unit_price, ipi_pct: (it.ipi_pct ?? 0) / 100, st_pct: (it.st_pct ?? 0) / 100 })));
    if (itemsErr) { setSubmitError(`Itens: ${itemsErr.message}`); setSubmitting(false); return; }

    setSubmitting(false);
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---- Estados especiais ----

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <svg className="mx-auto h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/>
          </svg>
          <p className="mt-3 text-sm text-slate-500">Carregando cotação…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-red-100 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <p className="font-medium text-slate-900">Link inválido</p>
          <p className="mt-1 text-sm text-slate-500">{loadError}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-emerald-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-8 w-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-slate-900">Cotação enviada!</p>
          <p className="mt-2 text-sm text-slate-500">
            Sua proposta foi recebida com sucesso. O comprador entrará em contato em breve.
          </p>
        </div>
      </div>
    );
  }

  if (!resolved) return null;

  // ---- Render principal ----

  return (
    <div className="min-h-screen bg-slate-50 pb-28 sm:pb-8">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">EGP Tecnologia</p>
        <h1 className="mt-0.5 text-lg font-semibold text-slate-900 sm:text-xl">{resolved.title}</h1>
        {resolved.productName && (
          <p className="text-sm text-slate-500">Produto: {resolved.productName}</p>
        )}
        {resolved.deadline && (
          <p className="mt-1 text-xs text-slate-400">
            Prazo: {new Date(resolved.deadline).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="mx-auto max-w-3xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">

        {/* Identificação */}
        <Card>
          <CardHeader><CardTitle>Sua identificação</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="sup-name">Empresa *</Label>
                <Input id="sup-name" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Razão social" className="h-11" />
              </div>
              <div>
                <Label htmlFor="sup-cnpj">CNPJ</Label>
                <Input id="sup-cnpj" value={supplierCnpj} onChange={(e) => setSupplierCnpj(e.target.value)} placeholder="00.000.000/0000-00" className="h-11" />
              </div>
              <div>
                <Label htmlFor="sup-email">Email *</Label>
                <Input id="sup-email" type="email" value={supplierEmail} onChange={(e) => setSupplierEmail(e.target.value)} placeholder="contato@empresa.com.br" className="h-11" />
              </div>
              <div>
                <Label htmlFor="sup-seller">Seu nome (vendedor) *</Label>
                <Input id="sup-seller" value={sellerName} onChange={(e) => setSellerName(e.target.value)} placeholder="Nome de quem está preenchendo" className="h-11" />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Moeda */}
        <Card>
          <CardHeader><CardTitle>Moeda da cotação</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <div className="flex gap-6">
              {(['BRL', 'USD'] as Currency[]).map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-2.5">
                  <input type="radio" className="h-4 w-4 accent-brand-600" checked={currency === c} onChange={() => setCurrency(c)} />
                  <span className="text-sm font-medium">{c === 'BRL' ? 'Real (BRL)' : 'Dólar (USD)'}</span>
                </label>
              ))}
            </div>
            {currency === 'USD' && (
              <div className="max-w-xs">
                <Label htmlFor="fx">Câmbio USD → BRL</Label>
                <Input id="fx" type="number" step="0.0001" min={0} value={usdRate ?? ''} onChange={(e) => setUsdRate(e.target.value === '' ? null : Number(e.target.value))} placeholder="Ex: 5.1234" className="h-11" />
                <p className="mt-1 text-xs text-slate-400">Pré-preenchido com a cotação do dia.</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Itens — Mobile: cards empilhados | Desktop: tabela */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Itens ({items.length})</CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">
                Deixe em branco os itens que você não fornece.
                {totals.filledCount > 0 && (
                  <span className="ml-1 font-medium text-emerald-700">{totals.filledCount} preenchido{totals.filledCount > 1 ? 's' : ''}</span>
                )}
              </p>
            </div>
          </CardHeader>

          {/* MOBILE: cards por item */}
          <div className="divide-y divide-slate-100 md:hidden">
            {items.map((it, idx) => {
              const eff = effectivePriceBRL({ unitPrice: it.unit_price, currency, usdBrlRate: currency === 'USD' ? usdRate : null, ipiPct: (it.ipi_pct ?? 0) / 100, stPct: (it.st_pct ?? 0) / 100 });
              const total = eff != null ? eff * it.quantity : null;
              const aboveTarget = eff != null && it.target_price_brl != null && eff > it.target_price_brl;
              const taxOpen = expandedTax.has(idx);
              return (
                <div key={it.quotation_item_id} className="px-4 py-3 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 leading-snug">{it.component_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Qtd: {it.quantity}{it.target_price_brl != null && <span className="ml-2">Target: {formatBRL(it.target_price_brl)}</span>}</p>
                    </div>
                    {total != null && (
                      <span className={`shrink-0 text-sm font-semibold ${aboveTarget ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {formatBRL(total)}
                      </span>
                    )}
                  </div>
                  <div>
                    <Label htmlFor={`price-${idx}`} className="text-xs">Seu preço unitário ({currency})</Label>
                    <Input
                      id={`price-${idx}`}
                      type="number" inputMode="decimal" min={0} step="0.0001"
                      value={it.unit_price ?? ''}
                      onChange={(e) => updateItem(idx, { unit_price: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="0,00"
                      className="h-12 text-base"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleTax(idx)}
                    className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-3 w-3 transition-transform ${taxOpen ? 'rotate-180' : ''}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                    </svg>
                    {taxOpen ? 'Ocultar' : 'Adicionar'} IPI / ST
                  </button>
                  {taxOpen && (
                    <div className="flex gap-3">
                      {(['ipi_pct', 'st_pct'] as const).map((field) => (
                        <div key={field} className="flex-1">
                          <Label className="text-xs">{field === 'ipi_pct' ? 'IPI %' : 'ST %'}</Label>
                          <Input
                            type="number" inputMode="decimal" min={0} step="0.01"
                            value={it[field] ?? ''}
                            onChange={(e) => updateItem(idx, { [field]: e.target.value === '' ? null : Number(e.target.value) } as Partial<ItemRow>)}
                            placeholder="0"
                            className="h-11"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {totals.filledCount > 0 && (
              <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
                <span className="text-sm font-medium text-slate-700">Total da proposta</span>
                <span className="text-base font-bold text-slate-900">{formatBRL(totals.totalEffectiveBRL)}</span>
              </div>
            )}
          </div>

          {/* DESKTOP: tabela */}
          <div className="hidden md:block overflow-x-auto">
            <CardBody className="space-y-2 pt-0">
              <p className="text-xs text-slate-500">
                Deixe em branco os itens que você não fornece. A coluna <strong>Target</strong> é a referência desejada.
              </p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="py-2 pr-3">Componente</th>
                    <th className="py-2 px-2 w-16 text-right">Qtd</th>
                    <th className="py-2 px-2 w-28 text-right">Target</th>
                    <th className="py-2 px-2 w-36">Seu preço</th>
                    <th className="py-2 px-2 w-20">IPI %</th>
                    <th className="py-2 px-2 w-20">ST %</th>
                    <th className="py-2 pl-2 w-32 text-right">Total (BRL)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const eff = effectivePriceBRL({ unitPrice: it.unit_price, currency, usdBrlRate: currency === 'USD' ? usdRate : null, ipiPct: (it.ipi_pct ?? 0) / 100, stPct: (it.st_pct ?? 0) / 100 });
                    const total = eff != null ? eff * it.quantity : null;
                    const targetCls = eff != null && it.target_price_brl != null ? (eff <= it.target_price_brl ? 'text-emerald-700' : 'text-amber-700') : 'text-slate-700';
                    return (
                      <tr key={it.quotation_item_id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-3 font-medium text-slate-900">{it.component_name}</td>
                        <td className="py-2 px-2 text-right text-slate-700">{it.quantity}</td>
                        <td className="py-2 px-2 text-right text-slate-500">{it.target_price_brl != null ? formatBRL(it.target_price_brl) : '—'}</td>
                        <td className="py-2 px-2">
                          <Input type="number" min={0} step="0.0001" value={it.unit_price ?? ''} onChange={(e) => updateItem(idx, { unit_price: e.target.value === '' ? null : Number(e.target.value) })} placeholder="0,00" className="h-9" />
                        </td>
                        {(['ipi_pct', 'st_pct'] as const).map((field) => (
                          <td key={field} className="py-2 px-2">
                            <Input type="number" min={0} step="0.01" value={it[field] ?? ''} onChange={(e) => updateItem(idx, { [field]: e.target.value === '' ? null : Number(e.target.value) } as Partial<ItemRow>)} placeholder="0" className="h-9" />
                          </td>
                        ))}
                        <td className={`py-2 pl-2 text-right ${targetCls}`}>{total != null ? formatBRL(total) : '—'}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-slate-200 bg-slate-50 text-sm font-medium">
                    <td className="py-2 pr-3" colSpan={6}>Total efetivo da proposta (BRL)</td>
                    <td className="py-2 pl-2 text-right">{totals.filledCount > 0 ? formatBRL(totals.totalEffectiveBRL) : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </CardBody>
          </div>
        </Card>

        {/* Pagamento e observações */}
        <Card>
          <CardHeader><CardTitle>Pagamento e observações</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            {resolved.paymentTerms && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Condição solicitada</p>
                <p className="mt-0.5 text-slate-800">{resolved.paymentTerms}</p>
              </div>
            )}
            <div>
              <Label htmlFor="pay-resp">Sua condição de pagamento</Label>
              <Textarea id="pay-resp" value={paymentResponse} onChange={(e) => setPaymentResponse(e.target.value)} placeholder="Ex: à vista com 3% desc · 30/60/90 · 50% entrada + 50% em 30 dias" className="min-h-[80px]" />
            </div>
            <div>
              <Label htmlFor="notes">Observações (prazo de entrega, etc.)</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: Prazo de entrega 7 dias úteis após confirmação" className="min-h-[80px]" />
            </div>
          </CardBody>
        </Card>

        {submitError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        )}

        {/* Botão desktop (inline) */}
        <div className="hidden sm:flex justify-end">
          <Button type="submit" disabled={submitting} className="px-8">
            {submitting ? 'Enviando…' : `Enviar cotação${totals.filledCount > 0 ? ` (${totals.filledCount} iten${totals.filledCount > 1 ? 's' : ''})` : ''}`}
          </Button>
        </div>
      </form>

      {/* Botão mobile — sticky no bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white px-4 py-3 sm:hidden">
        {submitError && (
          <p className="mb-2 text-xs text-red-600">{submitError}</p>
        )}
        <button
          type="submit"
          form="quote-form-trigger"
          disabled={submitting}
          onClick={(e) => { e.preventDefault(); document.querySelector('form')?.requestSubmit(); }}
          className="w-full rounded-xl bg-brand-600 py-3.5 text-sm font-semibold text-white shadow-lg disabled:opacity-60 active:bg-brand-700"
        >
          {submitting ? 'Enviando…' : `Enviar cotação${totals.filledCount > 0 ? ` · ${totals.filledCount} iten${totals.filledCount > 1 ? 's' : ''}` : ''}`}
        </button>
      </div>
    </div>
  );
}
