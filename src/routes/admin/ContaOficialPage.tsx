import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

type OBAStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | string;

interface OBAResult {
  phone_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  name_status: string | null;
  quality_rating: string | null;
  code_verification_status: string | null;
  oba_status: OBAStatus;
  checked_at: string;
}

const STATUS_INFO: Record<string, { label: string; color: string; description: string }> = {
  NOT_STARTED: {
    label: 'Não solicitado',
    color: 'bg-slate-100 text-slate-700 border-slate-300',
    description: 'Você ainda não solicitou a verificação de Conta Comercial Oficial. Quando estiver pronto, solicite no Gerenciador WhatsApp.',
  },
  IN_PROGRESS: {
    label: 'Em análise',
    color: 'bg-amber-100 text-amber-700 border-amber-300',
    description: 'A Meta está analisando sua solicitação. O processo pode levar de alguns dias a algumas semanas.',
  },
  APPROVED: {
    label: 'Aprovado ✓',
    color: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    description: 'Parabéns! Sua conta está verificada como oficial. O selo verde aparecerá nas conversas com clientes.',
  },
  REJECTED: {
    label: 'Rejeitado',
    color: 'bg-red-100 text-red-700 border-red-300',
    description: 'A solicitação foi rejeitada. Verifique os motivos no Gerenciador e refaça a solicitação quando os critérios forem atendidos.',
  },
};

const QUALITY_INFO: Record<string, { label: string; color: string }> = {
  GREEN:  { label: 'Alta',   color: 'text-emerald-700' },
  YELLOW: { label: 'Média',  color: 'text-amber-700' },
  RED:    { label: 'Baixa',  color: 'text-red-700' },
  UNKNOWN:{ label: '—',      color: 'text-slate-500' },
};

export default function ContaOficialPage() {
  const toast = useToast();
  const [data, setData] = useState<OBAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    setLoading(true);
    setError(null);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-oba-status`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao consultar status');
      setData(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error('Erro', msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchStatus(); }, []);

  const status = data?.oba_status ?? 'NOT_STARTED';
  const info = STATUS_INFO[status] ?? STATUS_INFO.NOT_STARTED;
  const quality = QUALITY_INFO[data?.quality_rating ?? 'UNKNOWN'] ?? QUALITY_INFO.UNKNOWN;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Conta Comercial Oficial</h1>
          <p className="text-sm text-slate-500">
            Status da verificação Meta para o selo verde ✓ no WhatsApp.
          </p>
        </div>
        <Button onClick={fetchStatus} disabled={loading} variant="secondary">
          {loading ? 'Consultando…' : '↻ Atualizar'}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!data ? (
        <p className="text-sm text-slate-500">Consultando…</p>
      ) : (
        <div className="space-y-4">
          {/* Status principal */}
          <Card>
            <CardBody>
              <div className="flex items-start gap-4">
                <div className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${info.color}`}>
                  {info.label}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-700">{info.description}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    Última verificação: {new Date(data.checked_at).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Detalhes do número */}
          <Card>
            <CardHeader>
              <CardTitle>Detalhes do número</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
              <Field label="Número" value={data.display_phone_number ?? '—'} />
              <Field label="Nome verificado" value={data.verified_name ?? '—'} />
              <Field label="Phone ID" value={data.phone_id} mono />
              <Field label="Status do nome" value={data.name_status ?? '—'} />
              <Field label="Verificação de código" value={data.code_verification_status ?? '—'} />
              <Field label="Qualidade da conta" value={quality.label} className={quality.color} />
            </CardBody>
          </Card>

          {/* Critérios para aprovação */}
          {status !== 'APPROVED' && (
            <Card>
              <CardHeader>
                <CardTitle>O que ajuda a aprovar</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 text-sm">
                <ul className="list-disc space-y-1.5 pl-5 text-slate-700">
                  <li><strong>Empresa verificada</strong> no Meta Business (você já tem ✓)</li>
                  <li><strong>Volume ativo</strong> de mensagens (idealmente após 30-60 dias rodando)</li>
                  <li><strong>Qualidade alta</strong> (GREEN) — mantida com baixo bloqueio/reclamação</li>
                  <li><strong>Presença pública</strong> notável: site oficial, redes sociais ativas, menção em mídia</li>
                  <li><strong>Política de privacidade</strong> publicada (você já tem)</li>
                  <li><strong>Foto, descrição e categoria</strong> preenchidos no perfil WhatsApp</li>
                </ul>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                  💡 Para solicitar: <a href="https://business.facebook.com/wa/manage/phone-numbers/" target="_blank" rel="noreferrer" className="font-medium underline">Gerenciador WhatsApp → Números → Perfil → Conta comercial oficial → Enviar solicitação</a>
                </div>
              </CardBody>
            </Card>
          )}

          {status === 'APPROVED' && (
            <Card>
              <CardBody className="bg-emerald-50">
                <p className="text-sm text-emerald-800">
                  🎉 Sua empresa está oficialmente verificada. Os clientes verão o selo ✓ verde ao lado do nome
                  nas conversas, aumentando confiança e taxa de resposta.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 ${mono ? 'font-mono text-xs' : 'text-sm'} ${className ?? 'text-slate-800'}`}>
        {value}
      </div>
    </div>
  );
}
