import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useInternalAuth } from '@/lib/auth-context';

interface Session {
  phone: string;
  updated_at: string;
  lastMsg?: string;
  lastDir?: 'in' | 'out';
  unread?: number;
  /** Quando true, vendedora assumiu a conversa e a IA não responde. */
  human_takeover?: boolean;
}

type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed' | null;

interface Message {
  id: string;
  phone: string;
  direction: 'in' | 'out';
  text: string;
  sent_by: string | null;
  created_at: string;
  delivery_status: DeliveryStatus;
  message_id: string | null;
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

function senderDisplay(label: string): string {
  const local = label.includes('@') ? label.split('@')[0] : label;
  if (!local) return label;
  return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
}

// Ícone de status de entrega WhatsApp-style
function DeliveryIcon({ status }: { status: DeliveryStatus }) {
  if (status === 'read') {
    return (
      <svg viewBox="0 0 16 11" fill="none" className="inline-block h-3.5 w-3.5 ml-1 text-sky-500" aria-label="Lida">
        <path d="M1 5.5l3.5 3.5L10 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5 5.5l3.5 3.5L14.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  if (status === 'delivered') {
    return (
      <svg viewBox="0 0 16 11" fill="none" className="inline-block h-3.5 w-3.5 ml-1 text-slate-400" aria-label="Entregue">
        <path d="M1 5.5l3.5 3.5L10 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5 5.5l3.5 3.5L14.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  if (status === 'failed') {
    return (
      <svg viewBox="0 0 14 14" fill="none" className="inline-block h-3.5 w-3.5 ml-1 text-red-500" aria-label="Falhou">
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    );
  }
  // sent (padrão — tick simples)
  return (
    <svg viewBox="0 0 10 10" fill="none" className="inline-block h-3 w-3 ml-1 text-slate-400" aria-label="Enviada">
      <path d="M1.5 5l2.5 2.5L8.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// Calcula horas desde a última mensagem RECEBIDA (in) do contato
function hoursOld(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export default function WhatsAppPage() {
  const { userLabel, userRole } = useInternalAuth();
  const isAdmin = userRole === 'admin';
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Horas desde a última mensagem RECEBIDA nesta conversa (para aviso 24h)
  const [lastInboundHours, setLastInboundHours] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  // Contatos: phone (5511...) → name
  const [contactByPhone, setContactByPhone] = useState<Record<string, string>>({});
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  async function loadContacts() {
    const { data } = await supabase
      .from('whatsapp_contacts')
      .select('name, phone');
    const map: Record<string, string> = {};
    for (const c of (data ?? []) as { name: string; phone: string }[]) {
      map[c.phone] = c.name;
    }
    setContactByPhone(map);
  }

  async function saveContactName() {
    if (!selected) return;
    const name = contactDraft.trim();
    if (!name) return;
    setSavingContact(true);
    try {
      const existingName = contactByPhone[selected];
      // Verifica se já existe contato pelo número
      const { data: existing } = await supabase
        .from('whatsapp_contacts')
        .select('id')
        .eq('phone', selected)
        .maybeSingle();
      if (existing) {
        await supabase
          .from('whatsapp_contacts')
          .update({ name, updated_at: new Date().toISOString() })
          .eq('id', (existing as any).id);
      } else {
        await supabase.from('whatsapp_contacts').insert({ name, phone: selected });
      }
      setContactByPhone((prev) => ({ ...prev, [selected]: name }));
      setEditingContact(false);
      // Pequeno feedback no console (toast ja existe em outras pages)
      console.log('Contato salvo:', existingName ? `${existingName} → ${name}` : `Novo: ${name}`);
    } catch (err) {
      console.error('Erro ao salvar contato:', err);
    } finally {
      setSavingContact(false);
    }
  }

  async function loadSessions() {
    let phones: string[] | null = null;
    if (!isAdmin) {
      // Não-admin só vê conversas onde participou (mandou pelo menos 1 msg)
      const { data: myMsgs } = await supabase
        .from('whatsapp_messages')
        .select('phone')
        .eq('sent_by', userLabel)
        .eq('direction', 'out');
      phones = [...new Set(((myMsgs ?? []) as { phone: string }[]).map((m) => m.phone))];
      if (phones.length === 0) { setSessions([]); setLoading(false); return; }
    }

    let q = supabase.from('whatsapp_sessions').select('phone, updated_at, human_takeover')
      .order('updated_at', { ascending: false });
    if (phones) q = q.in('phone', phones);
    const { data: sess } = await q;

    if (!sess?.length) { setSessions([]); setLoading(false); return; }

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

  /** Toggle "Atender manualmente" — pausa/retoma a IA pra essa conversa.
   *  Atualização otimista: UI muda imediatamente, rollback se DB falhar. */
  async function toggleHumanTakeover() {
    if (!selected) return;
    const current = selectedSession?.human_takeover ?? false;
    const next = !current;
    // Otimista: atualiza UI antes de confirmar no banco
    setSessions((prev) =>
      prev.map((s) => (s.phone === selected ? { ...s, human_takeover: next } : s))
    );
    const { error } = await supabase
      .from('whatsapp_sessions')
      .update({ human_takeover: next })
      .eq('phone', selected);
    if (error) {
      // Reverte se falhou
      setSessions((prev) =>
        prev.map((s) => (s.phone === selected ? { ...s, human_takeover: current } : s))
      );
      console.error('[wa] toggle human_takeover falhou:', error);
    }
  }

  async function sendManualMessage() {
    const text = draft.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ to: selected, text, sender_label: userLabel }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha no envio');
      setDraft('');
      // Recarrega histórico (a Edge Function loga no banco automaticamente)
      await loadConversation(selected);
      // Mantém foco no input (UX igual ao WhatsApp)
      inputRef.current?.focus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Mensagem amigável para o erro de janela 24h
      if (/re-?engagement|24.*hour|outside.*window/i.test(msg)) {
        setSendError('Janela de 24h expirada — só dá pra mandar mensagem livre dentro de 24h da última do cliente. Use template aprovado para iniciar conversa.');
      } else {
        setSendError(msg);
      }
    } finally {
      setSending(false);
    }
  }

  async function loadConversation(phone: string) {
    setLoadingMsgs(true);
    const [msgsRes, ordersRes] = await Promise.all([
      supabase
        .from('whatsapp_messages')
        .select('id, phone, direction, text, sent_by, created_at, delivery_status, message_id')
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
    const msgs = (msgsRes.data ?? []) as Message[];
    setMessages(msgs);
    setOrders((ordersRes.data ?? []) as Order[]);

    // Calcula horas desde a última mensagem recebida (janela 24h)
    const lastIn = [...msgs].reverse().find(m => m.direction === 'in');
    setLastInboundHours(lastIn ? hoursOld(lastIn.created_at) : null);

    setLoadingMsgs(false);
  }

  useEffect(() => {
    loadContacts();
    loadSessions();
  }, []);

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
    setDraft('');
    setSendError(null);
    setEditingContact(false);
    loadConversation(selected);
    // Focus no input ao abrir conversa
    setTimeout(() => inputRef.current?.focus(), 50);

    // Realtime: subscribe a INSERT/UPDATE em whatsapp_messages pra esse phone.
    // Substitui o polling de 10s — latência cai pra <1s sem requests extras.
    const channel = supabase
      .channel(`wa-msgs:${selected}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: `phone=eq.${selected}`,
        },
        () => loadConversation(selected),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: `phone=eq.${selected}`,
        },
        () => loadConversation(selected),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selected]);

  // Realtime global: subscribe em whatsapp_sessions pra atualizar a lista
  // de conversas quando uma nova chega ou o human_takeover muda em outra aba.
  useEffect(() => {
    const channel = supabase
      .channel('wa-sessions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_sessions' },
        () => loadSessions(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {/* ── Lista de conversas ──────────────────────────────────────
           Mobile (<md): tela cheia quando NENHUMA conversa selecionada;
                          escondida quando há conversa aberta (back via header)
           Desktop (md+): sempre visível como sidebar de 72-80px de largura */}
      <div
        className={cn(
          'flex shrink-0 flex-col border-r border-slate-200 bg-white',
          'md:w-72 xl:w-80',
          // Mobile: tela cheia se nada selecionado, escondido se selecionado
          selected ? 'hidden md:flex' : 'flex w-full'
        )}
      >
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
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {contactByPhone[s.phone] ?? fmtPhone(s.phone)}
                    </span>
                    {contactByPhone[s.phone] && (
                      <span className="block text-[10px] text-slate-400">{fmtPhone(s.phone)}</span>
                    )}
                  </div>
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
        // Empty state: só aparece em desktop. No mobile, a lista de conversas
        // ocupa a tela toda quando nada está selecionado.
        <div className="hidden flex-1 items-center justify-center bg-slate-50 md:flex">
          <div className="text-center">
            <div className="mb-2 text-4xl">💬</div>
            <p className="text-sm text-slate-500">Selecione uma conversa para ver o histórico</p>
          </div>
        </div>
      ) : (
        <div className={cn(
          'flex flex-1 flex-col overflow-hidden bg-slate-50',
          // Borda lateral âmbar quando vendedora assumiu — sinal visual
          selectedSession?.human_takeover === true && 'border-l-4 border-l-amber-400'
        )}>

          {/* Header */}
          <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 md:px-5">
            <div className="flex items-center justify-between gap-3">
              {/* Back button — só aparece no mobile */}
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="md:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
                aria-label="Voltar para a lista de conversas"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-slate-900">
                    {contactByPhone[selected] ?? fmtPhone(selected)}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setContactDraft(contactByPhone[selected] ?? '');
                      setEditingContact(true);
                    }}
                    className="text-[11px] text-brand-600 hover:underline"
                    title="Editar nome do contato"
                  >
                    {contactByPhone[selected] ? 'editar' : '+ adicionar nome'}
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  {contactByPhone[selected] && <span>{fmtPhone(selected)} · </span>}
                  Última atividade: {selectedSession ? fmtDateTime(selectedSession.updated_at) : '—'}
                </p>
              </div>
              {orders.length > 0 && (
                <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                  {orders.length} pedido{orders.length !== 1 ? 's' : ''}
                </span>
              )}
              {/* Toggle "Atender manualmente" — pausa IA pra esta conversa */}
              {(() => {
                const isManual = selectedSession?.human_takeover === true;
                return (
                  <button
                    type="button"
                    onClick={toggleHumanTakeover}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                      isManual
                        ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    )}
                    title={
                      isManual
                        ? 'Você está atendendo manualmente. Clique para retomar a IA.'
                        : 'IA está respondendo automaticamente. Clique para assumir.'
                    }
                  >
                    <span
                      className={cn(
                        'inline-block h-1.5 w-1.5 rounded-full',
                        isManual ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'
                      )}
                    />
                    {isManual ? 'Atendendo manual' : 'IA ativa'}
                  </button>
                );
              })()}
            </div>

            {/* Banner explicativo quando em modo manual */}
            {selectedSession?.human_takeover === true && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <strong>Você assumiu essa conversa.</strong> A IA não vai responder enquanto esse modo estiver ativo.
                Quando terminar, clique no botão acima pra liberar a IA de novo.
              </div>
            )}

            {/* Form inline para editar nome */}
            {editingContact && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={contactDraft}
                  onChange={(e) => setContactDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveContactName();
                    if (e.key === 'Escape') setEditingContact(false);
                  }}
                  placeholder="Nome do contato (ex: Felipe Enbracon)"
                  className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={saveContactName}
                  disabled={!contactDraft.trim() || savingContact}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {savingContact ? '…' : 'Salvar'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingContact(false)}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-1 overflow-hidden">

            {/* Coluna mensagens + input */}
            <div className="flex flex-1 flex-col overflow-hidden">
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
                      'max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm',
                      m.direction === 'out'
                        ? 'rounded-br-sm text-slate-800'
                        : 'rounded-bl-sm bg-white text-slate-800 border border-slate-100'
                    )}
                    style={m.direction === 'out' ? { backgroundColor: '#d9fdd3' } : undefined}
                    >
                      {m.direction === 'out' && m.sent_by && (
                        <p className="mb-0.5 text-[11px] font-semibold text-green-800">
                          {senderDisplay(m.sent_by)}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                      <div className="mt-1 flex items-center justify-end gap-0.5">
                        <span className="text-[10px] text-slate-500">{fmtDateTime(m.created_at)}</span>
                        {m.direction === 'out' && (
                          <DeliveryIcon status={m.delivery_status} />
                        )}
                      </div>
                      {m.delivery_status === 'failed' && m.direction === 'out' && (
                        <p className="mt-0.5 text-[10px] text-red-500 font-medium">
                          Não entregue — contato fora da janela 24h ou número inválido
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input de envio */}
            <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
              {/* Aviso de janela 24h */}
              {lastInboundHours !== null && lastInboundHours > 24 && (
                <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 shrink-0 mt-0.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  <span>
                    <strong>Janela de 24h fechada</strong> — última mensagem recebida há {Math.round(lastInboundHours)}h.
                    Mensagens livres podem não ser entregues. Aguarde o cliente responder ou use um template aprovado.
                  </span>
                </div>
              )}
              {lastInboundHours === null && (
                <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
                  Nenhuma mensagem recebida — janela 24h não aberta. O cliente precisa iniciar a conversa.
                </div>
              )}
              {sendError && (
                <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                  {sendError}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Ctrl+Enter (ou Cmd+Enter): quebra linha
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      const target = e.currentTarget;
                      const start = target.selectionStart;
                      const end   = target.selectionEnd;
                      const next = draft.slice(0, start) + '\n' + draft.slice(end);
                      setDraft(next);
                      // Reposiciona cursor após a quebra
                      requestAnimationFrame(() => {
                        target.selectionStart = target.selectionEnd = start + 1;
                      });
                      return;
                    }
                    // Enter puro: envia
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendManualMessage();
                    }
                  }}
                  placeholder="Digite a mensagem… (Enter envia · Ctrl+Enter quebra linha)"
                  rows={1}
                  disabled={sending}
                  autoFocus
                  className="flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:opacity-60 max-h-32"
                  style={{ minHeight: 40 }}
                />
                <button
                  type="button"
                  onClick={sendManualMessage}
                  disabled={!draft.trim() || sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-600 text-white transition hover:bg-green-700 disabled:opacity-40 disabled:hover:bg-green-600"
                  aria-label="Enviar"
                >
                  {sending ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
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
