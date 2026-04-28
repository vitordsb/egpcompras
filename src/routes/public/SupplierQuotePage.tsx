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
  inviteId: string | null;          // null quando vem do public_token
  prefill: {
    supplierName: string;
    supplierEmail: string;
    supplierCurrency: Currency;
  } | null;                          // preenchido só quando invite nominal
}

export default function SupplierQuotePage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedQuotation | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);

  // Form
  const [supplierName, setSupplierName] = useState('');
  const [supplierCnpj, setSupplierCnpj] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [currency, setCurrency] = useState<Currency>('BRL');
  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [paymentResponse, setPaymentResponse] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // ---- Load -------------------------------------------------------------

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);

      // 1) Tenta encontrar invite nominal
      const inviteRes = await supabase
        .from('quotation_invites')
        .select(
          `id, status, supplier_id,
           quotation:quotations(
             id, title, payment_terms, public_token,
             deadline,
             product:products(name)
           ),
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
        const inv = inviteRes.data as unknown as {
          id: string;
          status: string;
          supplier_id: string | null;
          quotation: {
            id: string;
            title: string;
            payment_terms: string | null;
            deadline: string | null;
            product: { name: string } | null;
          } | null;
          supplier: { name: string; email: string; default_currency: Currency } | null;
        };
        if (!inv.quotation) {
          if (!cancelled) setLoadError('Cotação não encontrada.');
          if (!cancelled) setLoading(false);
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
          if (!cancelled) {
            setLoadError('Este link de cotação expirou. Peça um novo link ao comprador.');
            setLoading(false);
          }
          return;
        }
        if (inv.supplier) {
          prefill = {
            supplierName: inv.supplier.name,
            supplierEmail: inv.supplier.email,
            supplierCurrency: inv.supplier.default_currency,
          };
        }
      } else {
        // 2) Tenta como public_token
        const qRes = await supabase
          .from('quotations')
          .select(
            'id, title, payment_terms, deadline, public_token, product:products(name)'
          )
          .eq('public_token', token)
          .maybeSingle();
        if (qRes.data) {
          const q = qRes.data as unknown as {
            id: string;
            title: string;
            payment_terms: string | null;
            deadline: string | null;
            product: { name: string } | null;
          };
          quotationId = q.id;
          title = q.title;
          productName = q.product?.name ?? '';
          paymentTerms = q.payment_terms;
          deadline = q.deadline;
          if (deadline && new Date(deadline).getTime() < Date.now()) {
            if (!cancelled) {
              setLoadError('Este link de cotação expirou. Peça um novo link ao comprador.');
              setLoading(false);
            }
            return;
          }
        }
      }

      if (!quotationId) {
        if (!cancelled) {
          setLoadError('Link inválido ou cotação não encontrada.');
          setLoading(false);
        }
        return;
      }

      if (alreadyResponded) {
        if (!cancelled) {
          setSubmitted(true);
          setLoading(false);
        }
        return;
      }

      // 3) Carrega itens
      const itemsRes = await supabase
        .from('quotation_items')
        .select('id, quantity, target_price_brl, position, component:components(name)')
        .eq('quotation_id', quotationId)
        .order('position');

      if (itemsRes.error) {
        if (!cancelled) {
          setLoadError(itemsRes.error.message);
          setLoading(false);
        }
        return;
      }

      const loadedItems: ItemRow[] = (itemsRes.data ?? []).map((it: any) => ({
        quotation_item_id: it.id,
        component_name: it.component?.name ?? '—',
        quantity: Number(it.quantity),
        target_price_brl: it.target_price_brl != null ? Number(it.target_price_brl) : null,
        unit_price: null,
        ipi_pct: null,
        st_pct: null,
      }));

      // 4) Pré-preenche identificação se for invite nominal
      if (prefill) {
        setSupplierName(prefill.supplierName);
        setSupplierEmail(prefill.supplierEmail);
        setCurrency(prefill.supplierCurrency);
      }

      // 5) Busca cotação USD/BRL atual (não bloqueia se falhar)
      try {
        const fx = await fetchUsdBrl();
        if (!cancelled) setUsdRate(fx.rate);
      } catch {
        // segue sem cotação
      }

      if (!cancelled) {
        setResolved({
          quotationId,
          title,
          productName,
          paymentTerms,
          deadline,
          inviteId,
          prefill,
        });
        setItems(loadedItems);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // ---- Calcs ------------------------------------------------------------

  function updateItem(idx: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
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

  // ---- Submit -----------------------------------------------------------

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!resolved) return;
    setSubmitError(null);

    if (resolved.deadline && new Date(resolved.deadline).getTime() < Date.now()) {
      return setSubmitError('Este link expirou. Peça um novo link ao comprador.');
    }
    if (!supplierName.trim()) return setSubmitError('Informe o nome da empresa.');
    if (!sellerName.trim()) return setSubmitError('Informe o nome do vendedor.');
    if (!supplierEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplierEmail.trim())) {
      return setSubmitError('Informe um email válido.');
    }
    if (totals.filledCount === 0) {
      return setSubmitError('Preencha o preço de pelo menos 1 item antes de enviar.');
    }
    if (currency === 'USD' && (!usdRate || usdRate <= 0)) {
      return setSubmitError('Cotação USD/BRL inválida.');
    }

    setSubmitting(true);

    // 1) Garante que existe um invite_id
    let inviteId = resolved.inviteId;
    if (!inviteId) {
      // veio do public_token → cria invite anônimo
      const { data, error } = await supabase
        .from('quotation_invites')
        .insert({
          quotation_id: resolved.quotationId,
          supplier_id: null,
          status: 'responded',
          sent_at: new Date().toISOString(),
          responded_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (error || !data) {
        setSubmitError(error?.message ?? 'Falha ao registrar resposta.');
        setSubmitting(false);
        return;
      }
      inviteId = data.id as string;
    } else {
      // marca invite nominal como respondido
      await supabase
        .from('quotation_invites')
        .update({ status: 'responded', responded_at: new Date().toISOString() })
        .eq('id', inviteId);
    }

    // 2) Cria response
    const { data: respData, error: respErr } = await supabase
      .from('quotation_responses')
      .insert({
        invite_id: inviteId,
        currency,
        usd_brl_rate_used: currency === 'USD' ? usdRate : null,
        notes: notes.trim() || null,
        supplier_name: supplierName.trim(),
        supplier_cnpj: supplierCnpj.trim() || null,
        supplier_email: supplierEmail.trim().toLowerCase(),
        seller_name: sellerName.trim(),
        payment_response: paymentResponse.trim() || null,
      })
      .select('id')
      .single();
    if (respErr || !respData) {
      setSubmitError(respErr?.message ?? 'Falha ao salvar resposta.');
      setSubmitting(false);
      return;
    }
    const responseId = respData.id as string;

    // 3) Cria response_items (TODOS — itens em branco viram unit_price null).
    // PIS/COFINS são tributos do regime do fornecedor — não cobrados ao
    // comprador, então gravamos sempre 0 (default da coluna).
    const responseItemsPayload = items.map((it) => ({
      response_id: responseId,
      quotation_item_id: it.quotation_item_id,
      unit_price: it.unit_price,
      ipi_pct: (it.ipi_pct ?? 0) / 100,
      st_pct: (it.st_pct ?? 0) / 100,
    }));
    const { error: itemsErr } = await supabase
      .from('quotation_response_items')
      .insert(responseItemsPayload);
    if (itemsErr) {
      setSubmitError(`Itens: ${itemsErr.message}`);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setSubmitted(true);
  }

  // ---- Render -----------------------------------------------------------

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-sm text-slate-500">Carregando…</div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Card>
          <CardBody>
            <p className="text-sm text-red-700">{loadError}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-wider text-brand-600">EGP Tecnologia</div>
          <h1 className="text-2xl font-semibold text-slate-900">Cotação enviada</h1>
        </div>
        <Card>
          <CardBody className="space-y-2 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-base font-medium text-slate-900">Recebido com sucesso!</p>
            <p className="text-sm text-slate-600">
              Sua cotação chegou ao comprador. Em caso de dúvidas, ele entra em contato pelo email
              informado.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!resolved) return null;

  return (
    <div className="mx-auto max-w-4xl p-6 sm:p-8">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wider text-brand-600">EGP Tecnologia</div>
        <h1 className="text-2xl font-semibold text-slate-900">{resolved.title}</h1>
        <p className="text-sm text-slate-500">
          Produto: <strong>{resolved.productName}</strong>
        </p>
        {resolved.deadline && (
          <p className="mt-1 text-xs text-slate-500">
            Link válido até {new Date(resolved.deadline).toLocaleString('pt-BR')}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-6">
        {/* Identificação */}
        <Card>
          <CardHeader>
            <CardTitle>Sua identificação</CardTitle>
          </CardHeader>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sup-name">Empresa *</Label>
              <Input
                id="sup-name"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Razão social"
              />
            </div>
            <div>
              <Label htmlFor="sup-cnpj">CNPJ</Label>
              <Input
                id="sup-cnpj"
                value={supplierCnpj}
                onChange={(e) => setSupplierCnpj(e.target.value)}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div>
              <Label htmlFor="sup-email">Email *</Label>
              <Input
                id="sup-email"
                type="email"
                value={supplierEmail}
                onChange={(e) => setSupplierEmail(e.target.value)}
                placeholder="contato@empresa.com.br"
              />
            </div>
            <div>
              <Label htmlFor="sup-seller">Nome do vendedor *</Label>
              <Input
                id="sup-seller"
                value={sellerName}
                onChange={(e) => setSellerName(e.target.value)}
                placeholder="Quem está preenchendo"
              />
            </div>
          </CardBody>
        </Card>

        {/* Moeda + câmbio */}
        <Card>
          <CardHeader>
            <CardTitle>Moeda da cotação</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  className="accent-brand-600"
                  checked={currency === 'BRL'}
                  onChange={() => setCurrency('BRL')}
                />
                <span className="text-sm">Real (BRL)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  className="accent-brand-600"
                  checked={currency === 'USD'}
                  onChange={() => setCurrency('USD')}
                />
                <span className="text-sm">Dólar (USD)</span>
              </label>
            </div>
            {currency === 'USD' && (
              <div className="max-w-xs">
                <Label htmlFor="fx">Câmbio USD → BRL aplicado</Label>
                <Input
                  id="fx"
                  type="number"
                  step="0.0001"
                  min={0}
                  value={usdRate ?? ''}
                  onChange={(e) =>
                    setUsdRate(e.target.value === '' ? null : Number(e.target.value))
                  }
                  placeholder="Ex: 5.1234"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Pré-preenchido com a cotação do dia. Edite se quiser usar outro câmbio.
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Itens */}
        <Card>
          <CardHeader>
            <CardTitle>Itens para cotar ({items.length})</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 overflow-x-auto">
            <p className="text-xs text-slate-500">
              Deixe em branco os itens que você não fornece. Os impostos são opcionais. A coluna{' '}
              <strong>Target</strong> é a referência de preço unitário desejada pelo comprador —
              use como guia.
            </p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-3">Componente</th>
                  <th className="py-2 px-2 w-20 text-right">Qtd</th>
                  <th className="py-2 px-2 w-28 text-right">Target unit.</th>
                  <th className="py-2 px-2 w-32">Seu preço unit.</th>
                  <th className="py-2 px-2 w-20">IPI %</th>
                  <th className="py-2 px-2 w-20">ST %</th>
                  <th className="py-2 pl-2 w-32 text-right">Total efetivo (BRL)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const eff = effectivePriceBRL({
                    unitPrice: it.unit_price,
                    currency,
                    usdBrlRate: currency === 'USD' ? usdRate : null,
                    ipiPct: (it.ipi_pct ?? 0) / 100,
                    stPct: (it.st_pct ?? 0) / 100,
                  });
                  const total = eff != null ? eff * it.quantity : null;
                  // Compara o efetivo unitário com o target pra dar feedback visual
                  let targetClass = 'text-slate-700';
                  if (eff != null && it.target_price_brl != null) {
                    targetClass = eff <= it.target_price_brl
                      ? 'text-emerald-700'
                      : 'text-amber-700';
                  }
                  return (
                    <tr key={it.quotation_item_id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 font-medium text-slate-900">{it.component_name}</td>
                      <td className="py-2 px-2 text-right text-slate-700">{it.quantity}</td>
                      <td className="py-2 px-2 text-right text-slate-600">
                        {it.target_price_brl != null ? formatBRL(it.target_price_brl) : '—'}
                      </td>
                      <td className="py-2 px-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.0001"
                          value={it.unit_price ?? ''}
                          onChange={(e) =>
                            updateItem(idx, {
                              unit_price: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          placeholder="0,00"
                          className="h-9"
                        />
                      </td>
                      {(['ipi_pct', 'st_pct'] as const).map((field) => (
                        <td key={field} className="py-2 px-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={it[field] ?? ''}
                            onChange={(e) =>
                              updateItem(idx, {
                                [field]: e.target.value === '' ? null : Number(e.target.value),
                              } as Partial<ItemRow>)
                            }
                            placeholder="0"
                            className="h-9"
                          />
                        </td>
                      ))}
                      <td className={`py-2 pl-2 text-right ${targetClass}`}>
                        {total != null ? formatBRL(total) : '—'}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-slate-200 bg-slate-50 text-sm font-medium">
                  <td className="py-2 pr-3" colSpan={6}>
                    Total efetivo da proposta (BRL)
                  </td>
                  <td className="py-2 pl-2 text-right">
                    {totals.filledCount > 0 ? formatBRL(totals.totalEffectiveBRL) : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </CardBody>
        </Card>

        {/* Pagamento + observações */}
        <Card>
          <CardHeader>
            <CardTitle>Pagamento e observações</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              {resolved.paymentTerms && (
                <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                  <div className="text-xs font-medium uppercase tracking-wide text-amber-700">
                    O comprador pediu
                  </div>
                  <div className="mt-0.5 text-slate-800">{resolved.paymentTerms}</div>
                </div>
              )}
              <Label htmlFor="pay-resp">Sua condição de pagamento</Label>
              <Textarea
                id="pay-resp"
                value={paymentResponse}
                onChange={(e) => setPaymentResponse(e.target.value)}
                placeholder={
                  resolved.paymentTerms
                    ? 'Ex: aceito · contraproposta 30/60/90 · à vista com 3% desc'
                    : 'Ex: à vista com 3% desc · 30/60/90 · 50% entrada + 50% em 30 dias'
                }
              />
            </div>
            <div>
              <Label htmlFor="notes">Observações</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Prazo de entrega"
              />
            </div>
          </CardBody>
        </Card>

        {submitError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {submitError}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Enviando…' : 'Enviar cotação'}
          </Button>
        </div>
      </form>
    </div>
  );
}
