import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface Session {
  phone: string;
  updated_at: string;
  lastMsg?: string;
  lastDir?: 'in' | 'out';
  unread?: number;
}

interface Message {
  id: string;
  phone: string;
  direction: 'in' | 'out';
  text: string;
  created_at: string;
}

interface Order {
  id: string;
  client_name: string;
  status: string;
  valor_total: number | null;
  created_at: string;
}

function fmtPhone(p: string) {
  // 5511999998888 → (11) 99999-8888
  const digits = p.replace(/\D/g, '');
  if (digits.length === 13) return `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12) return `(${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return p;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function WhatsAppPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  async function loadSessions() {
    const { data: sess } = await supabase
      .from('whatsapp_sessions')
      .select('phone, updated_at')
      .order('updated_at', { ascending: false });

    if (!sess?.length) { setLoading(false); return; }

    const enriched: Session[] = await Promise.all(
      (sess as Session[]).map(async (s) => {
        const { data: msgs } = await supabase
          .from('whatsapp_messages')
          .select('direction, text')
          .eq('phone', s.phone)
          .order('created_at', { ascending: false })
          .limit(1);
        const last = msgs?.[0] as any;
        return { ...s, lastMsg: last?.text?.slice(0, 60), lastDir: last?.direction };
      })
    );
    setSessions(enriched);
    setLoading(false);
  }

  async function loadConversation(phone: string) {
    setLoadingMsgs(true);
    const [msgsRes, ordersRes] = await Promise.all([
      supabase
        .from('whatsapp_messages')
        .select('id, phone, direction, text, created_at')
        .eq('phone', phone)
        .order('created_at', { ascending: true })
        .limit(200),
      supabase
        .from('shipments')
        .select('id, client_name, status, valor_total, created_at')
        .eq('client_phone', phone)
        .eq('origem', 'whatsapp')
        .order('created_at', { ascending: false }),
    ]);
    setMessages((msgsRes.data ?? []) as Message[]);
    setOrders((ordersRes.data ?? []) as Order[]);
    setLoadingMsgs(false);
  }

  useEffect(() => { loadSessions(); }, []);

  // Auto-scroll para a última mensagem quando lista mudar
  useEffect(() => {
    if (messages.length === 0) return;
    const container = messagesContainerRef.current;
    if (container) {
      // Sem animação ao carregar conversa, smooth ao receber nova
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!selected) return;
    loadConversation(selected);
    // Polling a cada 10s para novas mensagens
    const id = setInterval(() => loadConversation(selected), 10000);
    return () => clearInterval(id);
  }, [selected]);

  const selectedSession = sessions.find((s) => s.phone === selected);

  const STATUS_LABEL: Record<string, string> = {
    pending: 'Pendente', shipped: 'Saiu', returned: 'Voltou', cancelled: 'Cancelado',
  };
  const STATUS_COLOR: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    shipped: 'bg-emerald-100 text-emerald-700',
    returned: 'bg-sky-100 text-sky-700',
    cancelled: 'bg-slate-100 text-slate-500',
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">

      {/* ── Lista de conversas ────────────────────────────────────── */}
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white xl:w-80">
        <div className="shrink-0 border-b border-slate-200 px-4 py-4">
          <h1 className="text-base font-semibold text-slate-900">WhatsApp</h1>
          <p className="text-xs text-slate-500">{sessions.length} conversa{sessions.length !== 1 ? 's' : ''}</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-sm text-slate-400">Carregando…</p>
          ) : sessions.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">Nenhuma conversa ainda.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.phone}
                type="button"
                onClick={() => setSelected(s.phone)}
                className={cn(
                  'flex w-full flex-col gap-0.5 border-b border-slate-100 px-4 py-3 text-left transition-colors',
                  selected === s.phone ? 'bg-green-50 border-l-2 border-l-green-500' : 'hover:bg-slate-50'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">{fmtPhone(s.phone)}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">{fmtTime(s.updated_at)}</span>
                </div>
                {s.lastMsg && (
                  <p className={cn('truncate text-xs', s.lastDir === 'in' ? 'text-slate-600' : 'text-slate-400')}>
                    {s.lastDir === 'out' && <span className="mr-1">✓</span>}
                    {s.lastMsg}
                  </p>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Conversa selecionada ──────────────────────────────────── */}
      {!selected ? (
        <div className="flex flex-1 items-center justify-center bg-slate-50">
          <div className="text-center">
            <div className="mb-2 text-4xl">💬</div>
            <p className="text-sm text-slate-500">Selecione uma conversa para ver o histórico</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">

          {/* Header */}
          <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{fmtPhone(selected)}</h2>
                <p className="text-xs text-slate-400">
                  Última atividade: {selectedSession ? fmtDateTime(selectedSession.updated_at) : '—'}
                </p>
              </div>
              {orders.length > 0 && (
                <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                  {orders.length} pedido{orders.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden">

            {/* Mensagens */}
            <div
              ref={messagesContainerRef}
              className="flex flex-1 flex-col overflow-y-auto px-4 py-4 gap-2"
            >
              {loadingMsgs ? (
                <p className="text-center text-sm text-slate-400">Carregando…</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-sm text-slate-400">Nenhuma mensagem.</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
                      m.direction === 'out'
                        ? 'rounded-br-sm bg-green-500 text-white'
                        : 'rounded-bl-sm bg-white text-slate-800 border border-slate-200'
                    )}>
                      <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                      <p className={cn('mt-1 text-[10px]', m.direction === 'out' ? 'text-green-100' : 'text-slate-400')}>
                        {fmtDateTime(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Painel de pedidos */}
            {orders.length > 0 && (
              <div className="flex w-64 shrink-0 flex-col border-l border-slate-200 bg-white overflow-y-auto">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pedidos via WhatsApp</h3>
                </div>
                <div className="flex-1 divide-y divide-slate-100">
                  {orders.map((o) => (
                    <div key={o.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-sm font-medium text-slate-900 leading-tight">{o.client_name}</span>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_COLOR[o.status] ?? 'bg-slate-100 text-slate-500')}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </div>
                      {o.valor_total != null && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          R$ {Number(o.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      )}
                      <p className="mt-0.5 text-[10px] text-slate-400">{fmtDateTime(o.created_at)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
