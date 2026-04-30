import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { MarketingCampaign, MarketingSend, CampaignSegment, ClientContact } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useInternalAuth } from '@/lib/auth-context';
import ActionMenu from '@/components/ui/ActionMenu';

const SEGMENT_LABELS: Record<CampaignSegment, string> = {
  all:            'Todos clientes',
  active:         'Ativos (≤60d)',
  inactive:       'Inativos (>60d)',
  no_whatsapp:    'Sem WhatsApp',
  opt_in_promo:   'Aceitam promo',
  opt_in_catalog: 'Aceitam catálogo',
  tag:            'Por tag',
};

interface FormState {
  id: string | null;
  name: string;
  description: string;
  template_name: string;
  template_params: string;       // JSON inline editado pelo usuário
  segment_filter: CampaignSegment;
  segment_tag: string;
  schedule_cron: string;
  max_per_run: number;
  enabled: boolean;
}

const emptyForm: FormState = {
  id: null,
  name: '',
  description: '',
  template_name: '',
  template_params: '{\n  "1": "{{name}}",\n  "2": "https://grupoegp.com.br/catalogo"\n}',
  segment_filter: 'opt_in_promo',
  segment_tag: '',
  schedule_cron: '',
  max_per_run: 100,
  enabled: true,
};

export default function CampanhasPage() {
  const { userLabel } = useInternalAuth();
  const toast = useToast();
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [stats, setStats] = useState<Record<string, { sent: number; delivered: number; failed: number; responded: number }>>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<MarketingCampaign | null>(null);
  const [testCampaign, setTestCampaign] = useState<MarketingCampaign | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: camps }, { data: sends }] = await Promise.all([
      supabase.from('marketing_campaigns').select('*').order('created_at', { ascending: false }),
      supabase.from('marketing_sends').select('campaign_id, status, responded_at'),
    ]);
    setCampaigns((camps ?? []) as MarketingCampaign[]);

    const map: Record<string, { sent: number; delivered: number; failed: number; responded: number }> = {};
    for (const s of (sends ?? []) as MarketingSend[]) {
      if (!map[s.campaign_id]) map[s.campaign_id] = { sent: 0, delivered: 0, failed: 0, responded: 0 };
      const m = map[s.campaign_id];
      if (s.status === 'sent' || s.status === 'delivered' || s.status === 'read') m.sent++;
      if (s.status === 'delivered' || s.status === 'read') m.delivered++;
      if (s.status === 'failed') m.failed++;
      if (s.responded_at) m.responded++;
    }
    setStats(map);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openCreate() { setForm(emptyForm); }
  function openEdit(c: MarketingCampaign) {
    setForm({
      id: c.id,
      name: c.name,
      description: c.description ?? '',
      template_name: c.template_name,
      template_params: JSON.stringify(c.template_params ?? {}, null, 2),
      segment_filter: c.segment_filter,
      segment_tag: c.segment_tag ?? '',
      schedule_cron: c.schedule_cron ?? '',
      max_per_run: c.max_per_run,
      enabled: c.enabled,
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) return toast.error('Erro', 'Nome obrigatório');
    if (!form.template_name.trim()) return toast.error('Erro', 'Nome do template obrigatório');

    let parsedParams: Record<string, string>;
    try {
      parsedParams = JSON.parse(form.template_params);
    } catch {
      return toast.error('Erro', 'Variáveis do template não estão em JSON válido');
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        template_name: form.template_name.trim(),
        template_params: parsedParams,
        segment_filter: form.segment_filter,
        segment_tag: form.segment_filter === 'tag' ? form.segment_tag.trim() || null : null,
        schedule_cron: form.schedule_cron.trim() || null,
        max_per_run: Number(form.max_per_run) || 100,
        enabled: form.enabled,
        created_by: form.id ? undefined : userLabel,
      };
      const result = form.id
        ? await supabase.from('marketing_campaigns').update(payload).eq('id', form.id)
        : await supabase.from('marketing_campaigns').insert(payload);
      if (result.error) throw new Error(result.error.message);
      toast.success(form.id ? 'Atualizado' : 'Criado', form.name);
      setForm(null);
      await load();
    } catch (err) {
      toast.error('Erro', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(c: MarketingCampaign) {
    const { error } = await supabase
      .from('marketing_campaigns')
      .update({ enabled: !c.enabled })
      .eq('id', c.id);
    if (error) toast.error('Erro', error.message);
    else {
      toast.success(c.enabled ? 'Pausada' : 'Ativada', c.name);
      await load();
    }
  }

  async function doDelete() {
    if (!confirmDel) return;
    const { error } = await supabase.from('marketing_campaigns').delete().eq('id', confirmDel.id);
    if (error) toast.error('Erro', error.message);
    else {
      toast.success('Removida', confirmDel.name);
      await load();
    }
    setConfirmDel(null);
  }

  // Render variáveis do template substituindo {{name}}, {{trade_name}}, {{days_inactive}} pelos dados do cliente
  function renderTemplateVar(template: string, client?: Partial<ClientContact>): string {
    if (!client) return template;
    return template
      .replace(/\{\{name\}\}/gi,        client.name ?? '')
      .replace(/\{\{trade_name\}\}/gi,  client.trade_name ?? client.name ?? '')
      .replace(/\{\{first_name\}\}/gi,  (client.name ?? '').split(' ')[0] ?? '')
      .replace(/\{\{days_inactive\}\}/gi, client.last_purchase_at
        ? String(Math.floor((Date.now() - new Date(client.last_purchase_at).getTime()) / 86400000))
        : '');
  }

  async function sendTest() {
    if (!testCampaign || !testPhone.trim()) return;
    setTesting(true);
    try {
      const digits = testPhone.replace(/\D/g, '');
      const phone = digits.startsWith('55') ? digits : `55${digits}`;

      // Resolve as variáveis com placeholders genéricos (sem cliente real)
      const fakeClient: Partial<ClientContact> = {
        name: 'Cliente Teste',
        trade_name: 'Cliente Teste',
        last_purchase_at: new Date(Date.now() - 45 * 86400000).toISOString(),
      };
      const params = Object.entries(testCampaign.template_params)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, val]) => renderTemplateVar(val, fakeClient));

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({
          to: phone,
          template: { name: testCampaign.template_name, language: testCampaign.template_lang, params },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha no envio');

      // Loga o teste
      await supabase.from('marketing_sends').insert({
        campaign_id: testCampaign.id,
        whatsapp_phone: phone,
        status: 'sent',
        message_id: json.message_id,
        sent_at: new Date().toISOString(),
      });

      toast.success('Teste enviado', `Para ${phone} via template ${testCampaign.template_name}`);
      setTestCampaign(null);
      setTestPhone('');
    } catch (err) {
      toast.error('Erro no envio', err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  const totalSent = useMemo(() =>
    Object.values(stats).reduce((acc, s) => acc + s.sent, 0)
  , [stats]);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Campanhas de Marketing</h1>
          <p className="text-sm text-slate-500">
            WhatsApp templates + segmentação + agendamento. Total enviado: <strong>{totalSent}</strong>
          </p>
        </div>
        <Button onClick={openCreate}>+ Nova campanha</Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : campaigns.length === 0 ? (
        <Card><CardBody>
          <p className="text-sm text-slate-600">
            Nenhuma campanha ainda. Crie a primeira clicando em <strong>+ Nova campanha</strong>.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Pré-requisito: o template precisa estar aprovado pela Meta. Verifique em
            <a href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline ml-1">
              Gerenciador WhatsApp → Modelos de mensagem
            </a>.
          </p>
        </CardBody></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {campaigns.map((c) => {
            const s = stats[c.id] ?? { sent: 0, delivered: 0, failed: 0, responded: 0 };
            return (
              <Card key={c.id}>
                <CardBody>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold text-slate-900">{c.name}</h3>
                        {c.enabled ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Ativa</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">Pausada</span>
                        )}
                      </div>
                      {c.description && <p className="mt-1 text-sm text-slate-600 line-clamp-2">{c.description}</p>}
                    </div>
                    <ActionMenu items={[
                      { label: 'Editar', onClick: () => openEdit(c) },
                      { label: c.enabled ? 'Pausar' : 'Ativar', onClick: () => toggleEnabled(c) },
                      { label: 'Enviar teste', variant: 'info', onClick: () => setTestCampaign(c) },
                      { label: 'Excluir', variant: 'danger', separator: true, onClick: () => setConfirmDel(c) },
                    ]} />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-slate-400 uppercase tracking-wide text-[10px]">Template</div>
                      <div className="font-mono text-slate-700">{c.template_name}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 uppercase tracking-wide text-[10px]">Segmento</div>
                      <div className="text-slate-700">
                        {SEGMENT_LABELS[c.segment_filter]}{c.segment_tag ? `: ${c.segment_tag}` : ''}
                      </div>
                    </div>
                    {c.schedule_cron && (
                      <div className="col-span-2">
                        <div className="text-slate-400 uppercase tracking-wide text-[10px]">Agendamento</div>
                        <div className="font-mono text-slate-700">{c.schedule_cron}</div>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2 border-t border-slate-100 pt-3 text-center">
                    <Stat label="Enviadas" value={s.sent} />
                    <Stat label="Entregues" value={s.delivered} accent="text-emerald-700" />
                    <Stat label="Respondidas" value={s.responded} accent="text-blue-700" />
                    <Stat label="Falhas" value={s.failed} accent="text-red-700" />
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal teste */}
      {testCampaign && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setTestCampaign(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900">Enviar teste</h2>
            <p className="mt-1 text-sm text-slate-500">
              Template <strong>{testCampaign.template_name}</strong> com dados fictícios de cliente.
            </p>
            <div className="mt-4">
              <Label htmlFor="test-phone">Número WhatsApp do destinatário</Label>
              <Input
                id="test-phone"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="(11) 98765-4321"
                autoFocus
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setTestCampaign(null)}>Cancelar</Button>
              <Button type="button" onClick={sendTest} disabled={!testPhone.trim() || testing}>
                {testing ? 'Enviando…' : 'Enviar teste'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <ConfirmModal
          title="Excluir campanha?"
          description={`Remover "${confirmDel.name}"? Histórico de envios será mantido.`}
          confirmLabel="Excluir"
          variant="danger"
          onConfirm={doDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}

      {/* Modal criar/editar */}
      {form && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setForm(null)}>
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submit}>
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">{form.id ? 'Editar campanha' : 'Nova campanha'}</h2>
              </div>
              <div className="space-y-4 px-5 py-4">
                <div>
                  <Label htmlFor="cm-name">Nome interno *</Label>
                  <Input id="cm-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Reativação clientes inativos" autoFocus />
                </div>
                <div>
                  <Label htmlFor="cm-desc">Descrição</Label>
                  <Input id="cm-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descrição interna do objetivo" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="cm-template">Nome do template (Meta) *</Label>
                    <Input id="cm-template" value={form.template_name} onChange={(e) => setForm({ ...form, template_name: e.target.value })} placeholder="cliente_inativo" />
                  </div>
                  <div>
                    <Label htmlFor="cm-segment">Segmento</Label>
                    <select
                      id="cm-segment"
                      value={form.segment_filter}
                      onChange={(e) => setForm({ ...form, segment_filter: e.target.value as CampaignSegment })}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    >
                      {(Object.keys(SEGMENT_LABELS) as CampaignSegment[]).map((s) => (
                        <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {form.segment_filter === 'tag' && (
                  <div>
                    <Label htmlFor="cm-tag">Tag</Label>
                    <Input id="cm-tag" value={form.segment_tag} onChange={(e) => setForm({ ...form, segment_tag: e.target.value })} placeholder="vip, varejo, etc." />
                  </div>
                )}
                <div>
                  <Label htmlFor="cm-params">Variáveis do template (JSON)</Label>
                  <textarea
                    id="cm-params"
                    value={form.template_params}
                    onChange={(e) => setForm({ ...form, template_params: e.target.value })}
                    rows={6}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs"
                    spellCheck={false}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Suporta placeholders: <code>{'{{name}}'}</code>, <code>{'{{trade_name}}'}</code>, <code>{'{{first_name}}'}</code>, <code>{'{{days_inactive}}'}</code>. Use a chave numérica conforme as variáveis do template ({'{{1}}'}, {'{{2}}'}...).
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="cm-cron">Agendamento (cron UTC, opcional)</Label>
                    <Input id="cm-cron" value={form.schedule_cron} onChange={(e) => setForm({ ...form, schedule_cron: e.target.value })} placeholder="0 13 * * MON" />
                    <p className="mt-1 text-xs text-slate-400">Ex: <code>0 13 * * MON</code> = toda segunda 10h BRT. Vazio = manual.</p>
                  </div>
                  <div>
                    <Label htmlFor="cm-max">Limite por execução</Label>
                    <Input id="cm-max" type="number" value={form.max_per_run} onChange={(e) => setForm({ ...form, max_per_run: Number(e.target.value) })} min={1} max={1000} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 accent-brand-600" />
                  <span>Campanha ativa</span>
                </label>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
                <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Salvando…' : form.id ? 'Salvar' : 'Criar'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <div className={`text-lg font-semibold ${accent ?? 'text-slate-900'}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
