import { useEffect, useRef, useState } from 'react';
import {
  runAgent,
  PROVIDERS,
  getProvider,
  parseAgentError,
  type ChatTurn,
  type FriendlyError,
} from '@/lib/agent';
import type { AgentProvider } from '@/lib/providers/types';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import MarkdownText from '@/components/MarkdownText';
import { cn } from '@/lib/utils';

const PROVIDER_STORAGE_KEY = 'appCompras.aiProvider';

// Em produção, ocultamos o Ollama (provider local — não há servidor lá).
// Groq e Gemini ficam disponíveis pro usuário escolher livremente.
const isProd = import.meta.env.PROD;
const PROVIDER_DEFAULT_IN_PROD = 'groq';

function getAvailableProviders() {
  return isProd ? PROVIDERS.filter((p) => p.id !== 'ollama') : PROVIDERS;
}

function loadInitialProviderId(): string {
  const available = getAvailableProviders();
  if (typeof window === 'undefined') return available[0]?.id ?? 'gemini';
  const saved = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
  if (saved && available.some((p) => p.id === saved)) return saved;
  if (isProd) return PROVIDER_DEFAULT_IN_PROD;
  const firstConfigured = available.find((p) => p.isConfigured());
  return firstConfigured?.id ?? 'gemini';
}

const QUICK_SUGGESTIONS = [
  'Qual o custo do produto X?',
  'Liste meus produtos com preço de venda',
  'Cria uma cotação pro produto X com 100 unidades, sem o componente caixa',
  'Cadastra o componente "resistor 10k"',
];

interface ChatSummary {
  id: string;
  title: string;
  updated_at: string;
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin} min atrás`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h atrás`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} dia${diffDay === 1 ? '' : 's'} atrás`;
  return d.toLocaleDateString('pt-BR');
}

export default function BuyerAgentPage() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChatSummary | null>(null);
  const [chatsDrawerOpen, setChatsDrawerOpen] = useState(false);

  const [providerId, setProviderId] = useState<string>(() => loadInitialProviderId());
  const provider: AgentProvider = getProvider(providerId) ?? PROVIDERS[0];
  const [providerStatus, setProviderStatus] = useState<{
    ok: boolean;
    message?: string;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Persiste escolha
  useEffect(() => {
    window.localStorage.setItem(PROVIDER_STORAGE_KEY, providerId);
  }, [providerId]);

  // Fecha drawer mobile ao trocar de conversa
  useEffect(() => {
    setChatsDrawerOpen(false);
  }, [currentChatId]);

  // Fecha drawer com Esc
  useEffect(() => {
    if (!chatsDrawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setChatsDrawerOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [chatsDrawerOpen]);

  // Ping no provider quando muda
  useEffect(() => {
    let cancelled = false;
    setProviderStatus(null);
    (async () => {
      const status = await provider.ping();
      if (!cancelled) setProviderStatus(status);
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // ---- Load lista de chats ---------------------------------------------

  async function loadChats() {
    const { data, error } = await supabase
      .from('ai_chats')
      .select('id, title, updated_at')
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('[ai_chats] load failed:', error);
      return;
    }
    setChats((data ?? []) as ChatSummary[]);
  }

  useEffect(() => {
    loadChats();
    inputRef.current?.focus();
  }, []);

  // ---- Auto-scroll quando mensagens mudam ------------------------------

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, running]);

  // ---- Selecionar / criar / excluir chat -------------------------------

  async function selectChat(id: string) {
    if (running) return;
    setError(null);
    setCurrentChatId(id);
    const { data, error } = await supabase
      .from('ai_messages')
      .select('payload')
      .eq('chat_id', id)
      .order('position');
    if (error) {
      setError({
        title: 'Falha ao carregar conversa',
        description: error.message,
      });
      return;
    }
    setHistory(((data ?? []) as { payload: ChatTurn }[]).map((r) => r.payload));
    inputRef.current?.focus();
  }

  function newChat() {
    if (running) return;
    setCurrentChatId(null);
    setHistory([]);
    setError(null);
    inputRef.current?.focus();
  }

  async function doDeleteChat() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    const { error } = await supabase.from('ai_chats').delete().eq('id', id);
    if (error) {
      setError({
        title: 'Falha ao excluir',
        description: error.message,
      });
      return;
    }
    if (currentChatId === id) {
      setCurrentChatId(null);
      setHistory([]);
    }
    setConfirmDelete(null);
    await loadChats();
  }

  // ---- Enviar mensagem -------------------------------------------------

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || running) return;
    if (!provider.isConfigured()) {
      setError({
        title: `Provider ${provider.name} não está configurado`,
        description: 'Defina a chave/URL no .env e reinicie o dev server.',
      });
      return;
    }
    setInput('');
    setError(null);
    setRunning(true);

    try {
      // Garante que existe um chat
      let chatId = currentChatId;
      if (!chatId) {
        const title = message.length > 80 ? message.slice(0, 80) + '…' : message;
        const { data, error: createErr } = await supabase
          .from('ai_chats')
          .insert({ title })
          .select('id')
          .single();
        if (createErr || !data) {
          throw new Error(createErr?.message ?? 'Falha ao criar conversa');
        }
        chatId = data.id as string;
        setCurrentChatId(chatId);
      }

      // Position counter — começa do tamanho atual do histórico
      let nextPosition = history.length;

      await runAgent({
        provider,
        history,
        userMessage: message,
        onTurn: (t) => {
          setHistory((prev) => [...prev, t]);
          const pos = nextPosition++;
          // fire-and-forget com log de erro
          supabase
            .from('ai_messages')
            .insert({
              chat_id: chatId,
              position: pos,
              payload: t as unknown as Record<string, unknown>,
            })
            .then(({ error: insErr }) => {
              if (insErr) console.error('[ai_messages] insert failed:', insErr);
            });
        },
      });

      // Atualiza updated_at do chat (e refresca a lista pra subir o atual)
      await supabase
        .from('ai_chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);
      await loadChats();
    } catch (err) {
      setError(parseAgentError(err));
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }

  // ---- Render ---------------------------------------------------------

  return (
    <div className="relative flex h-full bg-slate-50">
      {/* Backdrop quando drawer aberto em mobile */}
      {chatsDrawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
          onClick={() => setChatsDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar de chats — drawer no mobile, fixa no desktop */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform duration-200',
          'md:relative md:inset-auto md:w-64 md:translate-x-0',
          chatsDrawerOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:shadow-none'
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-3">
          <Button
            type="button"
            onClick={newChat}
            disabled={running}
            className="flex-1 justify-center"
          >
            + Nova conversa
          </Button>
          <button
            type="button"
            onClick={() => setChatsDrawerOpen(false)}
            aria-label="Fechar lista de conversas"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {chats.length === 0 ? (
            <p className="px-2 py-3 text-xs text-slate-500">Nenhuma conversa ainda.</p>
          ) : (
            <ul className="space-y-1">
              {chats.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => selectChat(c.id)}
                    disabled={running}
                    className={cn(
                      'flex w-full flex-col rounded-md px-3 py-2 pr-8 text-left transition-colors',
                      currentChatId === c.id
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-slate-700 hover:bg-slate-100',
                      running && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    <span className="line-clamp-1 text-sm font-medium">{c.title}</span>
                    <span className="text-[11px] text-slate-400">
                      {formatRelativeDate(c.updated_at)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(c);
                    }}
                    aria-label="Excluir conversa"
                    className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-white hover:text-red-600 md:hidden md:group-hover:block"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Área principal */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="border-b border-slate-200 bg-white px-4 py-3 md:px-8 md:py-4">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 md:gap-3">
            <div className="flex min-w-0 items-center gap-2 md:gap-3">
              <button
                type="button"
                onClick={() => setChatsDrawerOpen(true)}
                aria-label="Abrir lista de conversas"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 md:hidden"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                </svg>
              </button>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-slate-900 md:text-lg">Comprador</h1>
                <p className="hidden text-xs text-slate-500 sm:block">
                  Assistente que executa ações no sistema
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  providerStatus == null
                    ? 'bg-slate-300 animate-pulse'
                    : providerStatus.ok
                      ? 'bg-emerald-500'
                      : 'bg-red-500'
                )}
                title={
                  providerStatus == null
                    ? 'verificando…'
                    : providerStatus.ok
                      ? 'online'
                      : providerStatus.message ?? 'offline'
                }
              />
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                disabled={running}
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {getAvailableProviders().map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.modelLabel}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        {providerStatus && !providerStatus.ok && (
          <div className="mx-auto mt-4 w-full max-w-3xl px-4 md:px-8">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <strong>{provider.name}</strong> indisponível: {providerStatus.message}
              {provider.id === 'ollama' && (
                <div className="mt-1 text-xs">
                  Cheque se está rodando com CORS liberado:{' '}
                  <code>OLLAMA_ORIGINS=* ollama serve</code>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-8">
          <div className="mx-auto max-w-3xl">
            {history.length === 0 && !running && (
              <div className="space-y-6">
                <div className="rounded-lg border border-slate-200 bg-white p-5">
                  <h2 className="text-sm font-semibold text-slate-900">O que eu posso fazer</h2>
                  <ul className="mt-3 space-y-2 text-sm text-slate-600">
                    <li>• <strong>Responder perguntas</strong> — "qual o custo do produto X?"</li>
                    <li>• <strong>Cadastrar e configurar</strong> — produtos, componentes, fornecedores; markup; BOM</li>
                    <li>• <strong>Executar tarefas</strong> — criar cotação inteira com exclusões e fornecedores</li>
                  </ul>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Sugestões pra começar
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {QUICK_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        disabled={running || !provider.isConfigured()}
                        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {history.map((t, idx) => {
                if (t.role === 'user' && t.text) {
                  return (
                    <div key={idx} className="flex justify-end">
                      <div className="max-w-[80%] rounded-lg bg-brand-600 px-4 py-2.5 text-white whitespace-pre-wrap">
                        {t.text}
                      </div>
                    </div>
                  );
                }
                if (t.role === 'model' && t.text) {
                  const providerColor =
                    t.provider?.id === 'ollama'
                      ? 'text-emerald-600'
                      : t.provider?.id === 'gemini'
                        ? 'text-brand-600'
                        : t.provider?.id === 'groq'
                          ? 'text-cyan-600'
                          : 'text-slate-400';
                  return (
                    <div key={idx} className="flex flex-col items-start">
                      <div className="max-w-[85%] rounded-lg bg-white border border-slate-200 px-4 py-3 text-sm text-slate-800 shadow-sm">
                        <MarkdownText text={t.text} />
                      </div>
                      {t.provider && (
                        <div className={cn('mt-1 px-1 text-[11px]', providerColor)}>
                          via <strong>{t.provider.name}</strong>
                          <span className="text-slate-400"> · {t.provider.model}</span>
                        </div>
                      )}
                    </div>
                  );
                }
                if (t.toolCall) {
                  const borderColor =
                    t.provider?.id === 'ollama'
                      ? 'border-emerald-300'
                      : t.provider?.id === 'gemini'
                        ? 'border-brand-300'
                        : t.provider?.id === 'groq'
                          ? 'border-cyan-300'
                          : 'border-slate-300';
                  return (
                    <div key={idx} className="flex justify-start">
                      <div
                        className={cn(
                          'max-w-[85%] rounded-md border border-dashed bg-white px-3 py-1.5 text-xs',
                          borderColor
                        )}
                      >
                        <span className="font-mono text-slate-500">→ {t.toolCall.name}</span>
                        {Object.keys(t.toolCall.args ?? {}).length > 0 && (
                          <span className="ml-2 font-mono text-slate-400">
                            {JSON.stringify(t.toolCall.args)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }
                if (t.toolResponse) {
                  return (
                    <div key={idx} className="flex justify-start">
                      <div className="max-w-[85%] rounded-md bg-slate-100 px-3 py-1.5 text-xs">
                        {t.toolResponse.error ? (
                          <span className="text-red-600">erro: {t.toolResponse.error}</span>
                        ) : (
                          <span className="text-slate-500">✓ {t.toolResponse.name}</span>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              })}

              {running && (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-white border border-slate-200 px-4 py-3 shadow-sm">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
                      <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms]" />
                      <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:240ms]" />
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-semibold text-red-800">{error.title}</div>
                    <div className="text-red-700">{error.description}</div>
                    {error.hint && (
                      <div className="text-xs text-red-600">💡 {error.hint}</div>
                    )}
                    {error.technical && (
                      <details className="mt-1 text-xs text-red-500">
                        <summary className="cursor-pointer hover:text-red-700">
                          detalhes técnicos
                        </summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-red-100 p-2 font-mono text-[11px] text-red-700">
                          {error.technical}
                        </pre>
                      </details>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    aria-label="Fechar"
                    className="text-red-400 hover:text-red-700"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 bg-white px-4 py-3 md:px-8 md:py-4">
          <div className="mx-auto max-w-3xl">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-end gap-2"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Diga o que você quer fazer… (Enter envia, Shift+Enter quebra linha)"
                rows={2}
                disabled={running || !provider.isConfigured()}
                className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50"
              />
              <Button type="submit" disabled={!input.trim() || running || !provider.isConfigured()}>
                Enviar
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Modal de confirmação de exclusão */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                  />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-slate-900">Excluir conversa?</h2>
              <p className="mt-1 text-sm text-slate-600">
                <strong>{confirmDelete.title}</strong> e todas as mensagens dela serão removidas
                permanentemente.
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <Button type="button" variant="secondary" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={doDeleteChat}>
                Excluir
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
