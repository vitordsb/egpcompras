import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

// ─── Tipos ────────────────────────────────────────────────────────────────

interface MetaComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?: string;
  buttons?: { type: string; text: string; url?: string }[];
}

interface MetaTemplate {
  id?: string;
  name: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  category: string;
  language: string;
  components: MetaComponent[];
  rejected_reason?: string;
}

const STATUS_COLOR: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  PENDING:  'bg-amber-100 text-amber-700',
  REJECTED: 'bg-red-100  text-red-700',
  PAUSED:   'bg-slate-100 text-slate-600',
  DISABLED: 'bg-slate-100 text-slate-400',
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING:  'Aguardando',
  REJECTED: 'Rejeitado',
  PAUSED:   'Pausado',
  DISABLED: 'Desabilitado',
};

// ─── Preset de template para promoção com imagem ──────────────────────────

const PRESET_PROMO_IMAGEM: MetaComponent[] = [
  { type: 'HEADER', format: 'IMAGE' },
  {
    type: 'BODY',
    text: '🎉 *{{1}}* por apenas *R$ {{2}}*\n\n{{3}}\n\n*Oferta especial EGP Tecnologia!*',
  },
  {
    type: 'FOOTER',
    text: 'EGP · CNPJ: 40.116.124/0001-51 · Responda para mais info',
  },
];

const PRESET_FERIADO: MetaComponent[] = [
  { type: 'HEADER', format: 'IMAGE' },
  {
    type: 'BODY',
    text: '{{1}} 🎉\n\n{{2}}\n\n*Equipe EGP Tecnologia*',
  },
  {
    type: 'FOOTER',
    text: 'EGP · CNPJ: 40.116.124/0001-51',
  },
];

const PRESETS = [
  {
    id: 'promo_imagem',
    name: 'Promoção com Imagem',
    description: 'Imagem no cabeçalho + nome do produto + preço + descrição',
    suggestedName: 'promo_imagem_egp',
    components: PRESET_PROMO_IMAGEM,
    variables: ['Nome do produto (ex: Controle 2 Botões)', 'Preço (ex: 149,90)', 'Condição (ex: à vista)'],
  },
  {
    id: 'feriado_imagem',
    name: 'Feriado / Data comemorativa',
    description: 'Imagem + título + mensagem de felicitações',
    suggestedName: 'feriado_egp',
    components: PRESET_FERIADO,
    variables: ['Título (ex: Feliz Natal!)', 'Mensagem (ex: Desejamos...)'],
  },
];

// ─── Componente ───────────────────────────────────────────────────────────

export default function WhatsAppTemplatesPage() {
  const [templates, setTemplates]     = useState<MetaTemplate[]>([]);
  const [loading, setLoading]         = useState(true);
  const [wabaId, setWabaId]           = useState<string | null>(null);
  const [needsSetup, setNeedsSetup]   = useState(false);
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [deleting, setDeleting]       = useState<string | null>(null);

  // Form de criação
  const [selectedPreset, setSelectedPreset] = useState(PRESETS[0]);
  const [templateName, setTemplateName]     = useState(PRESETS[0].suggestedName);
  const [bodyText, setBodyText]             = useState(PRESETS[0].components.find(c => c.type === 'BODY')?.text ?? '');
  const [footerText, setFooterText]         = useState(PRESETS[0].components.find(c => c.type === 'FOOTER')?.text ?? '');

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
  const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const headers      = { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

  async function loadTemplates() {
    setLoading(true);
    setCreateSuccess(null);
    const res  = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-template`, { headers });
    const json = await res.json();
    if (json.error?.includes('WABA_ID')) {
      setNeedsSetup(true);
    } else if (res.ok) {
      setTemplates(json.templates ?? []);
      setWabaId(json.waba_id ?? null);
    }
    setLoading(false);
  }

  useEffect(() => { loadTemplates(); }, []);

  function applyPreset(preset: typeof PRESETS[0]) {
    setSelectedPreset(preset);
    setTemplateName(preset.suggestedName);
    setBodyText(preset.components.find(c => c.type === 'BODY')?.text ?? '');
    setFooterText(preset.components.find(c => c.type === 'FOOTER')?.text ?? '');
  }

  async function handleCreate() {
    if (!templateName.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    const components: MetaComponent[] = [
      ...selectedPreset.components.filter(c => c.type === 'HEADER'),
      { type: 'BODY', text: bodyText },
      ...(footerText.trim() ? [{ type: 'FOOTER' as const, text: footerText }] : []),
    ];

    const template = {
      name:       templateName.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      category:   'MARKETING',
      language:   'pt_BR',
      components,
    };

    const res  = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-template`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'create', template }),
    });
    const json = await res.json();

    if (!res.ok) {
      setCreateError(json.error ?? 'Falha ao criar template');
    } else {
      setCreateSuccess(`Template "${templateName}" enviado para revisão da Meta! Aprovação em 24-72h.`);
      loadTemplates();
    }
    setCreating(false);
  }

  async function handleDelete(name: string) {
    if (!confirm(`Deletar template "${name}"?`)) return;
    setDeleting(name);
    await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-template`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'delete', name }),
    });
    setDeleting(null);
    loadTemplates();
  }

  if (needsSetup) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md w-full rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-base font-semibold text-amber-900 mb-2">Configuração necessária</h2>
          <p className="text-sm text-amber-800 mb-4">
            Precisa do <strong>WABA_ID</strong> (WhatsApp Business Account ID) para gerenciar templates.
          </p>
          <div className="space-y-2 text-sm text-amber-800">
            <p className="font-medium">Como encontrar:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Acesse <strong>business.facebook.com</strong></li>
              <li>Configurações → Business Portfolio → WhatsApp Accounts</li>
              <li>Copie o ID numérico da sua conta WhatsApp Business</li>
            </ol>
            <p className="mt-3 font-medium">Ou:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Acesse <strong>developers.facebook.com</strong></li>
              <li>Seu App → WhatsApp → API Setup</li>
              <li>Copie o <em>WhatsApp Business Account ID</em></li>
            </ol>
          </div>
          <p className="mt-4 text-xs text-amber-700 bg-amber-100 rounded p-2">
            Com o ID em mãos, peça para o Vex configurar: <code>WABA_ID = 1234567890</code> nos secrets do Supabase.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Coluna esquerda: templates existentes ── */}
      <div className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white xl:w-96">
        <div className="shrink-0 border-b border-slate-200 px-4 py-4">
          <h1 className="text-sm font-semibold text-slate-900">Templates Meta Aprovados</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {wabaId ? `WABA: ${wabaId}` : 'Gerenciamento de templates WhatsApp Business'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-sm text-slate-400">Carregando…</p>
          ) : templates.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-sm text-slate-500 font-medium">Nenhum template cadastrado</p>
              <p className="mt-1 text-xs text-slate-400">Crie um template no painel direito e aguarde aprovação da Meta (24-72h)</p>
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {templates.map((t) => (
                <div key={t.name} className="rounded-lg border border-slate-100 bg-white p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{t.name}</p>
                      <p className="text-[10px] text-slate-400">{t.category} · {t.language}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_COLOR[t.status] ?? 'bg-slate-100 text-slate-500')}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </div>

                  {/* Componentes do template */}
                  {t.components.map((c, i) => (
                    <div key={i} className="mt-1">
                      {c.type === 'HEADER' && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3 w-3">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                          </svg>
                          Header: {c.format ?? 'TEXT'}
                        </div>
                      )}
                      {c.type === 'BODY' && c.text && (
                        <p className="text-[11px] text-slate-600 mt-1 line-clamp-3 whitespace-pre-wrap">{c.text}</p>
                      )}
                      {c.type === 'FOOTER' && c.text && (
                        <p className="text-[10px] text-slate-400 mt-1">{c.text}</p>
                      )}
                    </div>
                  ))}

                  {t.rejected_reason && (
                    <p className="mt-1.5 text-[11px] text-red-600 bg-red-50 rounded px-2 py-1">
                      Motivo: {t.rejected_reason}
                    </p>
                  )}

                  {t.status === 'APPROVED' && (
                    <div className="mt-2 rounded-md bg-green-50 border border-green-100 px-2 py-1.5 text-[11px] text-green-700">
                      ✓ Pronto para usar. Na IA: <em>"envia template {t.name} para [contato]"</em>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDelete(t.name)}
                    disabled={deleting === t.name}
                    className="mt-2 text-[11px] text-red-400 hover:text-red-600"
                  >
                    {deleting === t.name ? 'Deletando…' : 'Deletar'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Coluna direita: criar template ── */}
      <div className="flex flex-1 flex-col overflow-y-auto bg-slate-50 p-5 gap-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Criar Novo Template</h2>
          <p className="text-xs text-slate-500 mb-4">
            Templates precisam de aprovação da Meta (24-72h). Após aprovados, a IA pode usá-los para qualquer número, mesmo fora da janela de 24h.
          </p>

          {/* Presets */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Tipo de template</label>
            <div className="flex gap-2 flex-wrap">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                    selectedPreset.id === p.id
                      ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300',
                  )}
                >
                  <p className="font-medium">{p.name}</p>
                  <p className="text-slate-400">{p.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Nome do template */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Nome do template <span className="text-slate-400">(só letras minúsculas, números e _)</span>
            </label>
            <input
              type="text"
              value={templateName}
              onChange={e => setTemplateName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:outline-none"
            />
          </div>

          {/* Header */}
          <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-600 mb-1">
              Cabeçalho (Header)
            </p>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
              </svg>
              <span>Imagem (a imagem real é enviada no momento do disparo)</span>
            </div>
          </div>

          {/* Body */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Corpo da mensagem <span className="text-slate-400">(use {'{{1}}'}, {'{{2}}'} etc. para variáveis)</span>
            </label>
            <textarea
              value={bodyText}
              onChange={e => setBodyText(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none resize-none font-mono"
            />
            <div className="mt-1.5 space-y-0.5">
              <p className="text-[11px] text-slate-500 font-medium">Variáveis deste template:</p>
              {selectedPreset.variables.map((v, i) => (
                <p key={i} className="text-[11px] text-slate-400">{`{{${i + 1}}}`} → {v}</p>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-700 mb-1">Rodapé (opcional)</label>
            <input
              type="text"
              value={footerText}
              onChange={e => setFooterText(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>

          {createError   && <p className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{createError}</p>}
          {createSuccess && <p className="mb-3 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{createSuccess}</p>}

          <button
            type="button"
            onClick={handleCreate}
            disabled={!templateName.trim() || creating}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {creating ? (
              <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/></svg>Enviando para Meta…</>
            ) : 'Enviar para Aprovação da Meta'}
          </button>

          <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 space-y-1">
            <p className="font-medium">Como usar após aprovação:</p>
            <p>• Na IA: <em>"envia template promo_imagem_egp para Joane com imagem [url], produto Controle 2 Botões, preço 149,90, condição à vista"</em></p>
            <p>• Na tela de campanhas: selecione o template aprovado e dispare em massa</p>
            <p>• Funciona 24/7 mesmo sem resposta prévia do cliente</p>
          </div>
        </div>
      </div>
    </div>
  );
}
