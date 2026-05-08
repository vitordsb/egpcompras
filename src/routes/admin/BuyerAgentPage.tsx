import { useEffect, useRef, useState } from 'react';
import {
  runAgent,
  parseAgentError,
  type ChatTurn,
  type FriendlyError,
  type RetryStatus,
} from '@/lib/agent';
import { geminiProvider } from '@/lib/providers/gemini';
import Logo from '@/components/Logo';
import { describeToolCall } from '@/lib/tool-labels';
import { supabase } from '@/lib/supabase';
import { useInternalAuth } from '@/lib/auth-context';
import { processXmlFile, processZipFile, type ParsedAttachment } from '@/lib/nfe-parser';
import { Button } from '@/components/ui/Button';
import MarkdownText from '@/components/MarkdownText';
import { cn } from '@/lib/utils';
import { isCorrection, proposeMemoryFromCorrection, type MemoryProposal } from '@/lib/correction-detector';
import { startRecording, transcribeAudio, type ActiveRecording } from '@/lib/voice-input';

const QUICK_SUGGESTIONS = [
  'Qual o custo do produto X?',
  'Liste meus produtos com preço de venda',
  'Cria uma cotação pro produto X com 100 unidades, sem o componente caixa',
  'Cadastra o componente "resistor 10k"',
];

interface ChatSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  is_exclusive: boolean;
}

import { todayBR } from '@/lib/dates';
function todayIso(): string {
  return todayBR();
}

function dateRange(iso: string): { start: string; end: string } {
  return {
    start: new Date(iso + 'T00:00:00').toISOString(),
    end:   new Date(iso + 'T23:59:59.999').toISOString(),
  };
}

function shiftDay(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

const RH_AUTHORIZED_EMAILS = ['vitor@grupoegp.com.br', 'joane@grupoegp.com.br'];
const RH_TOOL_NAMES = new Set(['list_prestadores', 'get_prestador', 'update_prestador', 'create_prestador']);

// Tools que MUTAM dados — usadas pra gerar a barra de status real e contrastar
// com o texto da IA. Se a IA disser "cadastrei" mas nenhuma tool dessa lista
// rodou com sucesso na resposta, é alucinação.
const WRITE_TOOL_NAMES = new Set([
  // shipments
  'create_shipment', 'update_shipment', 'delete_shipment', 'mark_shipment_status',
  'add_shipment_items', 'add_shipment_observation', 'duplicate_shipment',
  'bulk_mark_shipped', 'link_document_to_shipment',
  // products / components / BOM
  'create_product', 'update_product', 'delete_product',
  'create_component', 'update_component', 'delete_component', 'bulk_create_components',
  'add_bom_item', 'update_bom_item', 'remove_bom_item', 'bulk_update_bom_targets', 'setup_product_bom',
  'set_product_kit', 'duplicate_product',
  // suppliers
  'create_supplier', 'update_supplier', 'delete_supplier',
  'set_component_supplier', 'remove_component_supplier',
  // quotations
  'create_quotation', 'update_quotation', 'delete_quotation',
  // financeira
  'create_financeira', 'register_titulo', 'mark_titulo_status', 'delete_titulo',
  // produção / estoque
  'create_production_order', 'finish_production_order', 'add_production_note',
  'register_stock_entry', 'adjust_stock', 'reserve_stock', 'release_stock_reservation',
  'deduct_stock_for_shipment', 'deduct_components_for_production', 'set_stock_minimum',
  // RMA
  'create_rma', 'update_rma', 'add_rma_item', 'update_rma_item', 'delete_rma_item',
  'update_rma_status', 'add_rma_observation', 'delete_rma',
  // outras
  'register_client_brand', 'delete_client_brand',
  'create_scheduled_task', 'toggle_scheduled_task', 'delete_scheduled_task',
  'remember', 'update_memory', 'forget_memory',
  'send_quote_request_whatsapp',
]);

interface ActionSummary {
  total: number;
  success: number;
  failed: { name: string; error: string }[];
  verified: number;
  writeNames: string[];
}

/**
 * Para um turno do modelo no índice `modelIdx`, calcula o resumo das tools
 * de escrita que rodaram desde a última mensagem do usuário até esse turno.
 * Retorna null se nenhuma tool de escrita foi executada.
 */
function getActionSummary(history: ChatTurn[], modelIdx: number): ActionSummary | null {
  // Acha o índice da mensagem do usuário anterior
  let userStart = -1;
  for (let i = modelIdx - 1; i >= 0; i--) {
    if (history[i].role === 'user' && !history[i].toolResponse) {
      userStart = i;
      break;
    }
  }
  if (userStart === -1) userStart = 0;

  let success = 0;
  let verified = 0;
  const failed: { name: string; error: string }[] = [];
  const writeNames: string[] = [];

  for (let i = userStart + 1; i <= modelIdx; i++) {
    const t = history[i];
    if (!t.toolResponse) continue;
    if (!WRITE_TOOL_NAMES.has(t.toolResponse.name)) continue;
    writeNames.push(t.toolResponse.name);
    if (t.toolResponse.error) {
      failed.push({ name: t.toolResponse.name, error: t.toolResponse.error });
    } else {
      success++;
      // Read-after-write retorna { verified: true } no payload
      const data = t.toolResponse.data as any;
      if (data && (data.verified === true || data.all_verified === true)) {
        verified++;
      }
    }
  }

  const total = success + failed.length;
  if (total === 0) return null;
  return { total, success, failed, verified, writeNames };
}

function formatDateLabel(iso: string): string {
  const today = todayIso();
  if (iso === today) return 'Hoje';
  if (iso === shiftDay(today, -1)) return 'Ontem';
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatMsgTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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
  const { userLabel, userEmail, userRole, allowedPageKeys } = useInternalAuth();
  const isRhUser = userEmail != null && RH_AUTHORIZED_EMAILS.includes(userEmail.toLowerCase());
  const provider = geminiProvider;
  const [providerStatus, setProviderStatus] = useState<{ ok: boolean; message?: string } | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; mimeType: string; data: string }>>([]);
  const [pendingParseds, setPendingParseds] = useState<ParsedAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChatSummary | null>(null);
  const [chatsDrawerOpen, setChatsDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [retryStatus, setRetryStatus] = useState<RetryStatus | null>(null);
  const [memoryProposal, setMemoryProposal] = useState<MemoryProposal | null>(null);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryProposing, setMemoryProposing] = useState(false);
  const [recording, setRecording] = useState<ActiveRecording | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Marca que o turn atual chegou via streaming — usado pelo onTurn pra REPLACE
  // o turn temporário (em vez de PUSH duplicado) quando o stream termina.
  const streamingActiveRef = useRef(false);


  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // Timer de elapsed enquanto roda (atualiza a cada segundo)
  useEffect(() => {
    if (!running || !runStartedAt) {
      setElapsedSec(0);
      return;
    }
    const tick = () => setElapsedSec(Math.floor((Date.now() - runStartedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, runStartedAt]);

  // Auto-grow do textarea conforme o usuário digita.
  // Mantém altura mínima de 50px (alinha com os botões de 52px do form).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, 50), 320);
    el.style.height = `${next}px`;
  }, [input]);

  // Devolve o foco ao input quando a IA termina de responder.
  // Aguarda o React aplicar o `disabled=false` antes de focar.
  // Se o usuário tiver clicado em outro input/textarea, NÃO rouba o foco.
  useEffect(() => {
    if (running) return;
    if (!provider.isConfigured()) return;
    const active = document.activeElement;
    const focusedElsewhere =
      active &&
      active !== inputRef.current &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (focusedElsewhere) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [running, provider]);

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

  // ---- Load lista de chats (filtrada por dia) ---------------------------

  async function loadChats(date?: string) {
    const d = date ?? selectedDate;
    const range = dateRange(d);
    let q = supabase
      .from('ai_chats')
      .select('id, title, created_at, updated_at, is_exclusive')
      .gte('created_at', range.start)
      .lte('created_at', range.end)
      .order('created_at', { ascending: false })
      .limit(200);
    // Não-autorizados nunca veem chats exclusivos
    if (!isRhUser) q = q.eq('is_exclusive', false);
    const { data, error } = await q;
    if (error) {
      console.error('[ai_chats] load failed:', error);
      return;
    }
    setChats((data ?? []) as ChatSummary[]);
  }

  useEffect(() => {
    loadChats(selectedDate);
    inputRef.current?.focus();
  }, [selectedDate]);

  // Foco inicial
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ---- Auto-scroll quando mensagens mudam ------------------------------

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, running]);

  // ---- Selecionar / criar / excluir chat -------------------------------

  const lastChatKey = `egp-last-chat-${userLabel}`;
  const lastChatTsKey = `egp-last-chat-ts-${userLabel}`;
  const lastChatSessionKey = `egp-last-chat-session-${userLabel}`;
  const RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

  function persistLastChat(id: string) {
    localStorage.setItem(lastChatKey, id);
    localStorage.setItem(lastChatTsKey, String(Date.now()));
    // Carimba qual sessão de login pertence — se o usuário fizer login de novo,
    // o expiresAt da sessão muda e o restore enxerga "outra sessão"
    const sessionExpiresAt = localStorage.getItem('appCompras.internalSessionExpiresAt');
    if (sessionExpiresAt) {
      localStorage.setItem(lastChatSessionKey, sessionExpiresAt);
    }
  }

  async function selectChat(id: string, chatDate?: string) {
    if (running) return;
    setError(null);
    setCurrentChatId(id);
    persistLastChat(id);
    // Se o chat é de outro dia, sincroniza a sidebar para esse dia
    if (chatDate) {
      const d = chatDate.slice(0, 10);
      setSelectedDate(d);
    }
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

  // Restaura o último chat aberto ao montar a página
  // Exceções: não restaura se passou >24h ou se o login é de outra sessão
  useEffect(() => {
    const saved = localStorage.getItem(lastChatKey);
    if (!saved) return;

    const savedTs = Number(localStorage.getItem(lastChatTsKey) ?? 0);
    if (savedTs && Date.now() - savedTs > RESTORE_WINDOW_MS) {
      // Passou de 24h — começa em chat novo
      localStorage.removeItem(lastChatKey);
      localStorage.removeItem(lastChatTsKey);
      localStorage.removeItem(lastChatSessionKey);
      return;
    }

    const savedSession = localStorage.getItem(lastChatSessionKey);
    const currentSession = localStorage.getItem('appCompras.internalSessionExpiresAt');
    if (savedSession && currentSession && savedSession !== currentSession) {
      // Login diferente daquele que abriu o chat — começa novo
      localStorage.removeItem(lastChatKey);
      localStorage.removeItem(lastChatTsKey);
      localStorage.removeItem(lastChatSessionKey);
      return;
    }

    // Verifica se o chat ainda existe antes de restaurar
    supabase
      .from('ai_chats')
      .select('id, created_at')
      .eq('id', saved)
      .maybeSingle()
      .then(({ data }) => {
        if (data) selectChat(saved, (data as any).created_at);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastChatKey]);

  // Sincroniza o último chat no localStorage sempre que mudar
  // (cobre o caso de novo chat criado via envio de mensagem)
  useEffect(() => {
    if (currentChatId) {
      persistLastChat(currentChatId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChatId, lastChatKey]);

  function newChat() {
    if (running) return;
    localStorage.removeItem(lastChatKey);
    localStorage.removeItem(lastChatTsKey);
    localStorage.removeItem(lastChatSessionKey);
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

  function cancelRun() {
    abortRef.current?.abort();
  }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove o prefixo "data:application/pdf;base64,"
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function attachFile(file: File) {
    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();
    if (type === 'application/pdf' || name.endsWith('.pdf')) {
      const data = await readFileAsBase64(file);
      setPendingFiles((prev) => [...prev, { name: file.name, mimeType: 'application/pdf', data }]);
    } else if (name.endsWith('.xml') || type === 'text/xml' || type === 'application/xml') {
      const content = await file.text();
      const parsed = processXmlFile(file.name, content);
      if (!parsed) {
        setError({ title: 'XML não reconhecido', description: 'O arquivo não é uma NF-e nem CC-e válida.' });
        return;
      }
      setPendingParseds((prev) => [...prev, parsed]);
    } else if (name.endsWith('.zip') || type === 'application/zip' || type === 'application/x-zip-compressed') {
      try {
        const parsed = await processZipFile(file);
        if (!parsed) {
          setError({ title: 'ZIP sem conteúdo reconhecido', description: 'O ZIP não contém NF-e nem CC-e válidas.' });
          return;
        }
        setPendingParseds((prev) => [...prev, parsed]);
      } catch {
        setError({ title: 'Falha ao ler ZIP', description: 'Não foi possível abrir o arquivo ZIP.' });
        return;
      }
    } else if (
      name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv') ||
      type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv'
    ) {
      try {
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheetText: string[] = [];
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '', raw: false });
          sheetText.push(`=== Aba: ${sheetName} ===`);
          for (let r = 0; r < rows.length; r++) {
            const row = rows[r] ?? [];
            if (row.every((c) => c == null || String(c).trim() === '')) continue;
            const cells = row.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim());
            sheetText.push(`L${r + 1}\t${cells.join(' | ')}`);
          }
        }
        const text = sheetText.join('\n').slice(0, 30000);
        setPendingParseds((prev) => [...prev, {
          name: file.name,
          label: `Planilha ${file.name}`,
          text: `[Planilha ${file.name}]\n${text}`,
          docs: [],
        }]);
      } catch (err) {
        setError({ title: 'Falha ao ler planilha', description: err instanceof Error ? err.message : 'Arquivo XLSX/CSV inválido.' });
        return;
      }
    } else {
      setError({ title: 'Formato não suportado', description: 'Aceitos: PDF, XML (NF-e/CC-e), ZIP, XLSX, XLS e CSV.' });
      return;
    }
    inputRef.current?.focus();
  }

  async function attachFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) await attachFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) await attachFiles(e.dataTransfer.files);
  }

  // Atualiza o cronômetro de gravação enquanto está rolando
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecordingMs(Date.now() - recording.startedAt), 200);
    return () => clearInterval(id);
  }, [recording]);

  async function startVoice() {
    if (recording || transcribing) return;
    setVoiceError(null);
    try {
      const r = await startRecording();
      setRecording(r);
      setRecordingMs(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setVoiceError(/permission|denied/i.test(msg) ? 'Permita o acesso ao microfone do navegador.' : msg);
    }
  }

  async function stopVoice() {
    if (!recording) return;
    const r = recording;
    setRecording(null);
    setTranscribing(true);
    let textToSend = '';
    let extraInput = '';
    try {
      const blob = await r.stop();
      const text = await transcribeAudio(blob);
      if (!text) {
        setVoiceError('Não consegui entender o áudio. Tente de novo.');
        return;
      }
      extraInput = input.trim();
      textToSend = extraInput ? `${extraInput} ${text}` : text;
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      setTranscribing(false);
    }
    // Dispara o envio FORA do try/finally pra garantir que transcribing já
    // foi desativado e o estado tá limpo antes de send() rodar
    if (textToSend) {
      setInput('');
      await send(textToSend);
    }
  }

  function cancelVoice() {
    if (!recording) return;
    recording.cancel();
    setRecording(null);
    setRecordingMs(0);
  }

  async function send(text?: string) {
    const message = (text ?? input).trim();
    const hasPdfs = pendingFiles.length > 0;
    const hasParseds = pendingParseds.length > 0;
    if ((!message && !hasPdfs && !hasParseds) || running) return;
    if (!provider.isConfigured()) {
      setError({
        title: `Provider ${provider.name} não está configurado`,
        description: 'Defina a chave/URL no .env e reinicie o dev server.',
      });
      return;
    }
    const filesToSend = [...pendingFiles];
    const parsedsToSend = [...pendingParseds];

    // Monta texto da mensagem: texto do usuário + todos os XMLs parseados
    const parsedText = parsedsToSend.map((p) => p.text).join('\n\n');
    const finalMessage = parsedText
      ? (message ? `${message}\n\n${parsedText}` : parsedText)
      : (message || (hasPdfs
          ? `Importar ${filesToSend.length} pedido${filesToSend.length > 1 ? 's' : ''}: ${filesToSend.map((f) => f.name).join(', ')}`
          : ''));

    setInput('');
    setPendingFiles([]);
    setPendingParseds([]);
    setError(null);
    setRunning(true);
    setRunStartedAt(Date.now());
    setRetryStatus(null);

    // Captura snapshot pra detectar correção depois que a IA responder
    const historyBeforeSend = [...history];
    const lastModelTurn = [...history].reverse().find((t) => t.role === 'model');
    const shouldCheckCorrection = !!message && isCorrection(message, lastModelTurn);
    // Limpa qualquer proposta anterior — só uma de cada vez
    setMemoryProposal(null);

    // AbortController + timeout client-side de 3min (impede UI travada eterna)
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutMs = 3 * 60 * 1000;
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      let chatId = currentChatId;
      if (!chatId) {
        // Novo chat → garante que a sidebar mostra o dia de hoje
        setSelectedDate(todayIso());
        const titleText = parsedsToSend.length > 0
          ? (message || parsedsToSend.map((p) => p.label).join(', '))
          : finalMessage;
        const title = titleText.length > 80 ? titleText.slice(0, 80) + '…' : titleText;
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

      let nextPosition = history.length;

      // Estado para auto-anexar arquivos aos shipments criados pela IA
      const remainingFiles = [...filesToSend];
      let lastShipmentToolCall: { name: string; args: Record<string, unknown> } | null = null;

      await runAgent({
        provider,
        history,
        userMessage: finalMessage,
        currentUser: userLabel,
        userRole,
        allowedPageKeys: allowedPageKeys ?? undefined,
        userInlineDataList: filesToSend.length > 0
          ? filesToSend.map((f) => ({ mimeType: f.mimeType, data: f.data, fileName: f.name }))
          : undefined,
        signal: controller.signal,
        onRetry: (s) => setRetryStatus(s),
        onRetryClear: () => setRetryStatus(null),
        onTextChunk: (chunk, done) => {
          if (chunk) {
            const isFirstChunk = !streamingActiveRef.current;
            if (isFirstChunk) {
              streamingActiveRef.current = true;
              const ts = new Date().toISOString();
              const turn: ChatTurn = {
                role: 'model',
                text: chunk,
                streaming: true,
                timestamp: ts,
                provider: { id: provider.id, name: provider.name, model: provider.modelLabel },
              };
              setHistory((prev) => [...prev, turn]);
            } else {
              setHistory((prev) => {
                const last = prev[prev.length - 1];
                if (!last || last.role !== 'model') return prev;
                return [...prev.slice(0, -1), { ...last, text: (last.text ?? '') + chunk }];
              });
            }
          }
          if (done) {
            // Marca o turn temporário como não-streaming (cursor desaparece)
            setHistory((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'model' || !last.streaming) return prev;
              return [...prev.slice(0, -1), { ...last, streaming: false }];
            });
          }
        },
        onTurn: (t) => {
          const ts = new Date().toISOString();
          const turn = { ...t, timestamp: ts };
          // Se este turn é a finalização de um stream em andamento, REPLACE
          // (o conteúdo já foi adicionado incrementalmente via onTextChunk)
          if (streamingActiveRef.current && t.role === 'model' && t.text) {
            streamingActiveRef.current = false;
            setHistory((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'model') {
                return [...prev.slice(0, -1), turn];
              }
              return [...prev, turn];
            });
          } else {
            setHistory((prev) => [...prev, turn]);
          }
          // Se a ferramenta é de RH, marca o chat como exclusivo
          if (t.toolCall && RH_TOOL_NAMES.has(t.toolCall.name) && chatId) {
            supabase.from('ai_chats').update({ is_exclusive: true }).eq('id', chatId).then(() => {});
          }
          // Auto-anexar arquivos aos shipments criados via IA (ou já existentes)
          if (t.toolCall?.name === 'create_shipment') {
            lastShipmentToolCall = t.toolCall;
          } else if (t.toolResponse?.name === 'create_shipment' && !t.toolResponse.error && lastShipmentToolCall) {
            const result = (t.toolResponse.data ?? {}) as Record<string, unknown>;
            const created = (result.created ?? {}) as Record<string, unknown>;
            // Match: id de novo shipment OU shipment_id de retorno already_exists
            const shipmentId = (typeof created?.id === 'string' && created.id)
              || (typeof result.shipment_id === 'string' && result.shipment_id)
              || null;
            const numeroNfe = String(lastShipmentToolCall.args?.numero_nfe ?? '');
            const numeroVenda = String(lastShipmentToolCall.args?.numero_venda ?? '');
            const callRef = lastShipmentToolCall;

            if (shipmentId && remainingFiles.length > 0) {
              // Tenta match por número NF-e ou venda; senão pega o primeiro
              let idx = -1;
              if (numeroNfe) {
                idx = remainingFiles.findIndex((f) => f.name.includes(numeroNfe));
              }
              if (idx < 0 && numeroVenda) {
                idx = remainingFiles.findIndex((f) => f.name.includes(numeroVenda));
              }
              if (idx < 0) idx = 0;

              const file = remainingFiles[idx];
              remainingFiles.splice(idx, 1);

              import('@/lib/shipment-attachments').then(({ uploadShipmentAttachment, detectAttachmentType }) => {
                uploadShipmentAttachment({
                  shipmentId,
                  fileName: file.name,
                  mimeType: file.mimeType,
                  data: file.data,
                  type: detectAttachmentType(file.name, file.mimeType),
                  uploadedBy: userLabel,
                }).catch((err) => console.error('[auto-attach] falhou:', err, callRef));
              });
            }
            lastShipmentToolCall = null;
          }
          const pos = nextPosition++;
          supabase
            .from('ai_messages')
            .insert({
              chat_id: chatId,
              position: pos,
              // inlineData (PDF base64) não é armazenado — pesa muito e não é
              // necessário recarregar. Fica apenas o nome do arquivo no texto.
              payload: t.inlineDataList
                ? { ...t, inlineDataList: t.inlineDataList.map((d) => ({ mimeType: d.mimeType, fileName: d.fileName })) }
                : t.inlineData
                  ? { ...t, inlineData: { mimeType: t.inlineData.mimeType, fileName: t.inlineData.fileName } }
                  : t as unknown as Record<string, unknown>,
            })
            .then(({ error: insErr }) => {
              if (insErr) console.error('[ai_messages] insert failed:', insErr);
            });
        },
      });

      await supabase
        .from('ai_chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);
      await loadChats();

      // Aprendizado de correções: roda em background depois que a IA respondeu
      if (shouldCheckCorrection) {
        setMemoryProposing(true);
        proposeMemoryFromCorrection(
          [...historyBeforeSend, { role: 'user', text: finalMessage }],
          finalMessage
        )
          .then((proposal) => {
            if (proposal) setMemoryProposal(proposal);
          })
          .catch((err) => console.warn('[memory-proposal] erro:', err))
          .finally(() => setMemoryProposing(false));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted) {
        // Cancelamento: pode ter sido manual ou pelo timeout
        const wasTimeout = !msg.includes('Cancelado pelo usuário') || (Date.now() - (runStartedAt ?? 0)) >= timeoutMs;
        setError({
          title: wasTimeout ? 'Tempo limite excedido' : 'Cancelado',
          description: wasTimeout
            ? 'O agente passou de 3 minutos sem responder.'
            : 'Você cancelou a execução.',
          hint: wasTimeout
            ? 'Tente novamente. Se persistir, troque pra outro provider no select ou divida o pedido em partes menores.'
            : 'Tente reformular ou mande um pedido mais simples.',
        });
      } else {
        setError(parseAgentError(err));
      }
    } finally {
      window.clearTimeout(timeoutId);
      abortRef.current = null;
      setRunning(false);
      setRunStartedAt(null);
      setRetryStatus(null);
      // Garante que se o stream foi interrompido, o ref seja resetado
      // e o cursor piscante seja limpo (caso ainda esteja ativo)
      if (streamingActiveRef.current) {
        streamingActiveRef.current = false;
        setHistory((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'model' || !last.streaming) return prev;
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        });
      }
      // foco do input é devolvido pelo useEffect que escuta `running`
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

      {/* Sidebar de chats — drawer no mobile, colapsável no desktop */}
      <aside
        className={cn(
          // Mobile: drawer sobre a tela
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-all duration-200',
          // Desktop: inline, colapsa via largura 0
          'md:relative md:inset-auto md:z-auto',
          // Mobile open/close via transform
          chatsDrawerOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0',
          // Desktop open/close via width
          sidebarOpen ? 'md:w-64' : 'md:w-0 md:overflow-hidden md:border-r-0'
        )}
      >
        <div className="flex flex-col border-b border-slate-200">
          <div className="flex items-center justify-between gap-2 p-3 pb-2">
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
          {/* Navegador de data */}
          <div className="flex items-center justify-between gap-1 px-3 pb-3">
            <button
              type="button"
              onClick={() => setSelectedDate((d) => shiftDay(d, -1))}
              className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
              title="Dia anterior"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(todayIso())}
              className={cn(
                'flex-1 rounded px-2 py-1 text-center text-xs font-medium transition-colors',
                selectedDate === todayIso()
                  ? 'text-brand-700 bg-brand-50'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
              title={selectedDate === todayIso() ? 'Hoje' : 'Clique para voltar a hoje'}
            >
              {formatDateLabel(selectedDate)}
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate((d) => shiftDay(d, 1))}
              disabled={selectedDate >= todayIso()}
              className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
              title="Próximo dia"
            >
              ›
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {/* Chats regulares (não exclusivos) */}
          {(() => {
            const regular = chats.filter((c) => !c.is_exclusive);
            const exclusive = chats.filter((c) => c.is_exclusive);
            const renderList = (list: ChatSummary[], exclusive = false) => (
              <ul className="space-y-1">
                {list.map((c) => (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => selectChat(c.id, c.created_at)}
                      disabled={running}
                      className={cn(
                        'flex w-full flex-col rounded-md px-3 py-2 pr-8 text-left transition-colors',
                        currentChatId === c.id
                          ? exclusive ? 'bg-violet-50 text-violet-700' : 'bg-brand-50 text-brand-700'
                          : exclusive ? 'text-slate-700 hover:bg-violet-50' : 'text-slate-700 hover:bg-slate-100',
                        running && 'cursor-not-allowed opacity-60'
                      )}
                    >
                      <span className="line-clamp-1 text-sm font-medium">{c.title}</span>
                      <span className="text-[11px] text-slate-400">{formatRelativeDate(c.updated_at)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(c); }}
                      aria-label="Excluir conversa"
                      className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-white hover:text-red-600 md:hidden md:group-hover:block"
                    >×</button>
                  </li>
                ))}
              </ul>
            );
            return (
              <>
                {regular.length === 0 && exclusive.length === 0 && (
                  <p className="px-2 py-3 text-xs text-slate-500">Nenhuma conversa ainda.</p>
                )}
                {regular.length > 0 && renderList(regular)}
                {isRhUser && exclusive.length > 0 && (
                  <>
                    <div className="mt-3 mb-1 flex items-center gap-2 px-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-500">Exclusivo</span>
                      <div className="flex-1 border-t border-violet-100" />
                    </div>
                    {renderList(exclusive, true)}
                  </>
                )}
              </>
            );
          })()}
        </div>
      </aside>

      {/* Área principal */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="border-b border-slate-200 bg-white px-4 py-3 md:px-8 md:py-4">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 md:gap-3">
            <div className="flex min-w-0 items-center gap-2 md:gap-3">
              {/* Mobile: abre drawer */}
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
              {/* Desktop: toggle sidebar */}
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-label={sidebarOpen ? 'Fechar histórico' : 'Abrir histórico'}
                className="hidden md:flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
                title={sidebarOpen ? 'Fechar histórico' : 'Abrir histórico'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                </svg>
              </button>
              <Logo size={36} />
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-slate-900 md:text-lg">EGP</h1>
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
              <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600">
                Gemini · gemini-2.5-flash
              </span>
            </div>
          </div>
        </header>

        {providerStatus && !providerStatus.ok && (
          <div className="mx-auto mt-4 w-full max-w-3xl px-4 md:px-8">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <strong>{provider.name}</strong> indisponível: {providerStatus.message}
            </div>
          </div>
        )}

        <div
          ref={scrollRef}
          className={cn(
            'relative flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-8 transition-colors',
            isDragging && 'bg-brand-50'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="rounded-xl border-2 border-dashed border-brand-400 bg-brand-50/90 px-10 py-8 text-center shadow-lg">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 h-10 w-10 text-brand-500">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <p className="text-sm font-medium text-brand-700">Solte o arquivo aqui (PDF, XML NF-e/CC-e, ZIP)</p>
              </div>
            </div>
          )}
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
                if (t.role === 'user' && (t.text || t.inlineData)) {
                  // Detecta se é mensagem com dados de NF-e/CC-e extraídos (começa com "[NF-e" ou "[Carta")
                  const nfeMatch = t.text?.match(/^\[(NF-e \d+[^\]]*|Carta de Corre[^\]]*|ZIP[^\]]*)\]/);
                  if (nfeMatch) {
                    const firstLine = t.text!.split('\n')[0];
                    const rest = t.text!.slice(firstLine.length).trim();
                    const userPart = rest.includes('\n[') ? rest.slice(0, rest.indexOf('\n[')).trim() : '';
                    const dataPart = userPart ? rest.slice(userPart.length).trim() : rest;
                    return (
                      <div key={idx} className="flex flex-col items-end gap-1">
                        <span className="px-1 text-[11px] font-medium text-slate-400">{userLabel}</span>
                        {/* Cabeçalho: tipo do documento */}
                        <div className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                          </svg>
                          <span className="font-semibold">{firstLine.replace(/^\[|\]$/g, '')}</span>
                          <span className="rounded bg-emerald-100 px-1 text-[10px] font-bold uppercase text-emerald-600">extraído</span>
                        </div>
                        {/* Instrução do usuário (se houver) */}
                        {userPart && (
                          <div className="max-w-[80%] rounded-lg bg-brand-600 px-4 py-2.5 text-white whitespace-pre-wrap">
                            {userPart}
                          </div>
                        )}
                        {/* Dados técnicos colapsáveis */}
                        <details className="max-w-[80%] rounded-md border border-slate-200 bg-slate-50 text-xs">
                          <summary className="cursor-pointer select-none px-3 py-1.5 text-slate-500 hover:text-slate-700">
                            dados extraídos
                          </summary>
                          <pre className="overflow-x-auto px-3 pb-2 font-mono text-[11px] text-slate-600 whitespace-pre-wrap break-all">
                            {dataPart}
                          </pre>
                        </details>
                        {t.timestamp && (
                          <span className="px-1 text-[10px] text-slate-400">{formatMsgTime(t.timestamp)}</span>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className="flex flex-col items-end gap-1">
                      <span className="px-1 text-[11px] font-medium text-slate-400">
                        {userLabel}
                      </span>
                      {/* Múltiplos PDFs */}
                      {t.inlineDataList && t.inlineDataList.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {t.inlineDataList.map((d, i) => (
                            <div key={i} className="flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs text-brand-700">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 shrink-0">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                              </svg>
                              {d.fileName ?? 'pedido.pdf'}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* PDF único (legado) */}
                      {!t.inlineDataList && t.inlineData && (
                        <div className="flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs text-brand-700">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                          </svg>
                          {t.inlineData.fileName ?? 'pedido.pdf'}
                        </div>
                      )}
                      {t.text && (
                        <div className="max-w-[80%] rounded-lg bg-brand-600 px-4 py-2.5 text-white whitespace-pre-wrap">
                          {t.text}
                        </div>
                      )}
                      {t.timestamp && (
                        <span className="px-1 text-[10px] text-slate-400">{formatMsgTime(t.timestamp)}</span>
                      )}
                    </div>
                  );
                }
                if (t.role === 'model' && t.text) {
                  const providerColor = 'text-brand-600';
                  // Remove linhas técnicas de tool calls que o modelo às vezes inclui na resposta
                  const cleanText = t.text
                    .split('\n')
                    .filter(line => !/\b(was called with|called with)\b/.test(line) &&
                      !/^[a-z_]+\s*\([^)]*\)\s*\.?\s*$/.test(line.trim()))
                    .join('\n')
                    .trim();
                  if (!cleanText) return null;
                  // Calcula resumo real das ações de escrita desta resposta
                  // (apenas no turno final — não enquanto streaming)
                  const summary = !t.streaming ? getActionSummary(history, idx) : null;
                  return (
                    <div key={idx} className="flex flex-col items-start">
                      <div className="max-w-[85%] rounded-lg bg-white border border-slate-200 px-4 py-3 text-sm text-slate-800 shadow-sm">
                        <MarkdownText text={cleanText} />
                        {t.streaming && (
                          <span className="ml-0.5 inline-block h-4 w-[2px] -mb-1 animate-pulse bg-brand-500 align-text-bottom" />
                        )}
                      </div>
                      {summary && (
                        <div
                          className={cn(
                            'mt-1.5 max-w-[85%] rounded-md border px-2.5 py-1.5 text-[11px]',
                            summary.failed.length > 0
                              ? 'border-red-200 bg-red-50 text-red-800'
                              : summary.verified === summary.success && summary.success > 0
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : 'border-amber-200 bg-amber-50 text-amber-800'
                          )}
                          title="Status real das ações executadas no banco — independente do que a IA falou no texto"
                        >
                          {summary.failed.length === 0 ? (
                            <span>
                              <strong>✓ {summary.success} {summary.success === 1 ? 'ação executada' : 'ações executadas'}</strong>
                              {summary.verified > 0 && (
                                <span className="ml-1.5 opacity-75">· {summary.verified} verificada{summary.verified === 1 ? '' : 's'} no banco</span>
                              )}
                              {summary.verified < summary.success && (
                                <span className="ml-1.5 opacity-60">· {summary.success - summary.verified} sem confirmação automática</span>
                              )}
                            </span>
                          ) : (
                            <div className="space-y-0.5">
                              <div className="font-semibold">
                                ⚠ {summary.failed.length} de {summary.total} {summary.total === 1 ? 'ação falhou' : 'ações falharam'}
                                {summary.success > 0 && <span className="ml-1 opacity-75">· {summary.success} ok</span>}
                              </div>
                              {summary.failed.slice(0, 3).map((f, i) => (
                                <div key={i} className="truncate opacity-80">
                                  • <code className="font-mono text-[10px]">{f.name}</code>: {f.error.slice(0, 120)}
                                </div>
                              ))}
                              {summary.failed.length > 3 && (
                                <div className="opacity-60">+ {summary.failed.length - 3} outros erros</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-2 px-1">
                        {t.provider && !t.streaming && (
                          <span className={cn('text-[11px]', providerColor)}>
                            via <strong>{t.provider.name}</strong>
                            <span className="text-slate-400"> · {t.provider.model}</span>
                          </span>
                        )}
                        {t.timestamp && !t.streaming && (
                          <span className="text-[10px] text-slate-400">{formatMsgTime(t.timestamp)}</span>
                        )}
                      </div>
                    </div>
                  );
                }
                if (t.toolCall) {
                  const label = describeToolCall(t.toolCall.name, t.toolCall.args);
                  const hasArgs = Object.keys(t.toolCall.args ?? {}).length > 0;
                  // Operações de escrita: pill colorido e mais visível
                  const WRITE_OPS = new Set([
                    'create_shipment','update_shipment','delete_shipment','mark_shipment_status',
                    'add_shipment_items','add_shipment_observation',
                    'create_product','update_product',
                    'create_component','update_component',
                    'create_supplier','update_supplier',
                    'create_quotation','update_quotation',
                    'create_financeira','register_titulo','mark_titulo_status',
                    'create_scheduled_task','toggle_scheduled_task','delete_scheduled_task',
                    'remember','update_memory','forget_memory',
                    'bulk_mark_shipped','duplicate_shipment',
                  ]);
                  const isWrite = WRITE_OPS.has(t.toolCall.name);
                  // Spinner no último tool call enquanto a IA ainda está rodando
                  const isLastTurn = idx === history.length - 1;
                  const isActive = running && isLastTurn;
                  return (
                    <div key={idx} className="flex justify-start">
                      {isWrite ? (
                        <div className={cn(
                          'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium',
                          'bg-brand-600 text-white shadow-sm'
                        )}>
                          {isActive ? (
                            <svg className="h-3.5 w-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/>
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5 shrink-0">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                          )}
                          <span>{label}</span>
                          {hasArgs && (
                            <details className="ml-1">
                              <summary className="cursor-pointer text-[10px] text-brand-200 hover:text-white">
                                técnico
                              </summary>
                              <pre className="mt-1 max-w-[400px] overflow-x-auto whitespace-pre-wrap break-all rounded bg-brand-700 p-2 text-[10px] font-mono text-brand-100">
                                {t.toolCall.name}({JSON.stringify(t.toolCall.args, null, 2)})
                              </pre>
                            </details>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
                          {isActive ? (
                            <svg className="h-3 w-3 shrink-0 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4l-3 3-3-3h4z"/>
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3 w-3 shrink-0 text-slate-300">
                              <circle cx="11" cy="11" r="8"/><path strokeLinecap="round" d="m21 21-4.35-4.35"/>
                            </svg>
                          )}
                          <span>{label}</span>
                          {hasArgs && (
                            <details className="ml-auto">
                              <summary className="cursor-pointer text-[10px] text-slate-400 hover:text-slate-600">técnico</summary>
                              <pre className="mt-1 max-w-[400px] overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[10px] font-mono text-slate-500">
                                {t.toolCall.name}({JSON.stringify(t.toolCall.args, null, 2)})
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
                if (t.toolResponse) {
                  if (t.toolResponse.error) {
                    return (
                      <div key={idx} className="flex justify-start">
                        <div className="flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                          Falhou: {t.toolResponse.error}
                        </div>
                      </div>
                    );
                  }
                  return null; // sucesso: o toolCall já confirma visualmente
                }
                return null;
              })}

              {running && !(history[history.length - 1]?.role === 'model' && history[history.length - 1]?.streaming) && (
                <div className="flex justify-start">
                  <div className="flex max-w-[85%] flex-col gap-1 rounded-lg bg-white border border-slate-200 px-4 py-3 shadow-sm">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
                        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms]" />
                        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:240ms]" />
                      </span>
                      <span className="text-sm text-slate-700">
                        {(() => {
                          // Status derivado do último turn no histórico
                          const last = history[history.length - 1];
                          if (last?.toolCall) {
                            return describeToolCall(last.toolCall.name, last.toolCall.args) + '…';
                          }
                          if (last?.toolResponse) return 'Processando resposta…';
                          return 'Pensando…';
                        })()}
                      </span>
                      <span className="text-xs text-slate-400">{elapsedSec}s</span>
                      <button
                        type="button"
                        onClick={cancelRun}
                        className="ml-auto text-xs text-red-600 hover:underline"
                      >
                        cancelar
                      </button>
                    </div>
                    {retryStatus && (
                      <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        {retryStatus.reason === 'rate_limit'
                          ? `Limite atingido. Tentando de novo em ${Math.ceil(retryStatus.delayMs / 1000)}s…`
                          : retryStatus.reason === 'overloaded'
                            ? `Modelo sobrecarregado. Tentando de novo em ${Math.ceil(retryStatus.delayMs / 1000)}s…`
                            : `Falha de rede. Tentando de novo em ${Math.ceil(retryStatus.delayMs / 1000)}s…`}{' '}
                        <span className="text-amber-600">
                          (tentativa {retryStatus.attempt}/{retryStatus.total})
                        </span>
                      </div>
                    )}
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

        <div className="relative border-t border-slate-200 bg-white px-4 py-3 md:px-8 md:py-4">
          {/* Mobile: botão circular flutuante sobre a linha divisória do painel */}
          <div className="pointer-events-none absolute -top-7 right-4 z-10 md:hidden">
            <div className="pointer-events-auto">
              {recording ? (
                <div className="flex items-center gap-2 rounded-full border border-red-300 bg-red-50 py-1 pl-1.5 pr-3 shadow-lg">
                  <button
                    type="button"
                    onClick={stopVoice}
                    disabled={transcribing}
                    title="Parar gravação e enviar"
                    aria-label="Parar gravação e enviar"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    <span className="block h-3 w-3 rounded-sm bg-white" />
                  </button>
                  <span className="font-mono text-sm font-semibold tabular-nums text-red-700">
                    {Math.floor(recordingMs / 1000).toString().padStart(2, '0')}:{Math.floor((recordingMs % 1000) / 10).toString().padStart(2, '0')}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <span className="block h-2 w-1 animate-pulse rounded-full bg-red-500" style={{ animationDelay: '0ms' }} />
                    <span className="block h-3 w-1 animate-pulse rounded-full bg-red-500" style={{ animationDelay: '150ms' }} />
                    <span className="block h-2 w-1 animate-pulse rounded-full bg-red-500" style={{ animationDelay: '300ms' }} />
                  </span>
                  <button
                    type="button"
                    onClick={cancelVoice}
                    title="Cancelar gravação"
                    aria-label="Cancelar gravação"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-red-400 hover:bg-red-100 hover:text-red-700"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startVoice}
                  disabled={running || transcribing}
                  title={transcribing ? 'Transcrevendo…' : 'Gravar mensagem por voz'}
                  aria-label="Gravar mensagem por voz"
                  className={cn(
                    'flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105 active:scale-95',
                    transcribing
                      ? 'bg-amber-500 text-white'
                      : 'bg-brand-600 text-white hover:bg-brand-700',
                    (running || transcribing) && 'cursor-not-allowed opacity-60 hover:scale-100'
                  )}
                >
                  {transcribing ? (
                    <svg viewBox="0 0 24 24" className="h-6 w-6 animate-spin">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.3" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="mx-auto max-w-3xl space-y-2">
            {/* Erro de voz */}
            {voiceError && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                <span>🎙 {voiceError}</span>
                <button type="button" onClick={() => setVoiceError(null)} className="text-red-400 hover:text-red-700">×</button>
              </div>
            )}
            {/* Sugestão de memória a partir de correção do usuário */}
            {(memoryProposing || memoryProposal) && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                </svg>
                <div className="min-w-0 flex-1">
                  {memoryProposing && !memoryProposal ? (
                    <p className="text-amber-800">
                      <span className="font-medium">Detectei uma correção…</span>{' '}
                      <span className="text-amber-600">analisando se vale memorizar</span>
                    </p>
                  ) : memoryProposal ? (
                    <>
                      <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Salvar como memória da IA?</p>
                      <p className="mt-0.5 text-amber-900">{memoryProposal.content}</p>
                      {memoryProposal.reason && (
                        <p className="mt-0.5 text-xs text-amber-600 italic">{memoryProposal.reason}</p>
                      )}
                    </>
                  ) : null}
                </div>
                {memoryProposal && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!memoryProposal) return;
                        setMemorySaving(true);
                        const { error: insErr } = await supabase
                          .from('agent_memories')
                          .insert({ content: memoryProposal.content });
                        setMemorySaving(false);
                        if (insErr) {
                          console.error('[memory] insert failed:', insErr);
                          return;
                        }
                        setMemoryProposal(null);
                      }}
                      disabled={memorySaving}
                      className="rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {memorySaving ? 'Salvando…' : 'Salvar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMemoryProposal(null)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    >
                      Ignorar
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* Fila de arquivos pendentes */}
            {(pendingFiles.length > 0 || pendingParseds.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs text-brand-700">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 shrink-0 text-brand-500">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <span className="max-w-[180px] truncate font-medium">{f.name}</span>
                    <button type="button" onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))} className="text-brand-400 hover:opacity-70">×</button>
                  </div>
                ))}
                {pendingParseds.map((p, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 shrink-0 text-emerald-500">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <span className="max-w-[180px] truncate font-medium">{p.label}</span>
                    <span className="rounded bg-emerald-100 px-1 text-[10px] font-bold uppercase text-emerald-600">extraído</span>
                    <button type="button" onClick={() => setPendingParseds((prev) => prev.filter((_, j) => j !== i))} className="text-emerald-400 hover:opacity-70">×</button>
                  </div>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-end gap-2"
            >
              {/* Botão de upload de PDF */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xml,.zip,.xlsx,.xls,.csv,application/pdf,text/xml,application/xml,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                multiple
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.length) attachFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={running}
                title="Anexar arquivo (PDF, XML NF-e/CC-e, ZIP, XLSX, CSV)"
                aria-label="Anexar arquivo"
                className={cn(
                  'flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-md border transition-colors',
                  pendingParseds.length > 0
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-600'
                    : pendingFiles.length > 0
                      ? 'border-brand-300 bg-brand-50 text-brand-600'
                      : 'border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700',
                  running && 'cursor-not-allowed opacity-50'
                )}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              </button>

              {/* Desktop: botão de microfone inline, mesma altura do input */}
              {recording ? (
                <div className="hidden h-[52px] shrink-0 items-center gap-2 rounded-md border border-red-300 bg-red-50 px-2.5 md:flex">
                  <button
                    type="button"
                    onClick={stopVoice}
                    disabled={transcribing}
                    title="Parar gravação e enviar"
                    aria-label="Parar gravação e enviar"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    <span className="block h-3 w-3 rounded-sm bg-white" />
                  </button>
                  <span className="font-mono text-sm font-semibold tabular-nums text-red-700">
                    {Math.floor(recordingMs / 1000).toString().padStart(2, '0')}:{Math.floor((recordingMs % 1000) / 10).toString().padStart(2, '0')}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <span className="block h-2 w-1 animate-pulse rounded-full bg-red-500" style={{ animationDelay: '0ms' }} />
                    <span className="block h-3 w-1 animate-pulse rounded-full bg-red-500" style={{ animationDelay: '150ms' }} />
                    <span className="block h-2 w-1 animate-pulse rounded-full bg-red-500" style={{ animationDelay: '300ms' }} />
                  </span>
                  <button
                    type="button"
                    onClick={cancelVoice}
                    title="Cancelar gravação"
                    aria-label="Cancelar gravação"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-red-400 hover:bg-red-100 hover:text-red-700"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startVoice}
                  disabled={running || transcribing}
                  title={transcribing ? 'Transcrevendo…' : 'Gravar mensagem por voz'}
                  aria-label="Gravar mensagem por voz"
                  className={cn(
                    'hidden h-[52px] w-[52px] shrink-0 items-center justify-center rounded-md border transition-colors md:flex',
                    transcribing
                      ? 'border-amber-300 bg-amber-50 text-amber-600'
                      : 'border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700',
                    (running || transcribing) && 'cursor-not-allowed opacity-50'
                  )}
                >
                  {transcribing ? (
                    <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin text-amber-600">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                    </svg>
                  )}
                </button>
              )}

              <div className="flex min-h-[52px] flex-1 items-stretch rounded-md border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
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
                  placeholder={(pendingFiles.length > 0 || pendingParseds.length > 0) ? 'Ex: "saída pra 15/06, financeira Bradesco" — Enter envia' : 'Diga o que você quer fazer… (Enter envia, Shift+Enter quebra linha)'}
                  rows={1}
                  disabled={running || !provider.isConfigured()}
                  className="block w-full resize-none rounded-md bg-transparent px-3 py-3 text-sm leading-6 outline-none disabled:bg-slate-50"
                  style={{ minHeight: '50px', maxHeight: '320px' }}
                />
                {input.length > 200 && (
                  <div className="flex items-center justify-end border-t border-slate-100 px-3 py-1 text-[11px] text-slate-400">
                    {input.length} caracteres · {input.split('\n').length} linha
                    {input.split('\n').length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
              <Button
                type="submit"
                disabled={(!input.trim() && pendingFiles.length === 0 && pendingParseds.length === 0) || running || !provider.isConfigured()}
                className="h-[52px]"
              >
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
