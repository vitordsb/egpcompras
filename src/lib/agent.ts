// Orquestrador do agente EGP.
// Recebe um provider concreto (Gemini, Ollama, ...) e roda o loop de
// function calling, executando tools de fato no Supabase.

import { toolDeclarations, executeTool } from '@/lib/agent-tools';
import { supabase } from '@/lib/supabase';
import { geminiProvider } from '@/lib/providers/gemini';
import { groqProvider } from '@/lib/providers/groq';
import type { AgentProvider, ProviderResponse, ProviderRunArgs } from '@/lib/providers/types';
import type { ChatTurn } from '@/lib/agent-types';

export interface FriendlyError {
  title: string;
  description: string;
  hint?: string;
  technical?: string;
}

/**
 * Classifica um erro técnico em mensagem amigável pro usuário final.
 */
export function parseAgentError(err: unknown): FriendlyError {
  const msg = err instanceof Error ? err.message : String(err);

  // Tenta extrair JSON aninhado (formato comum do SDK Gemini)
  let parsed: any = null;
  try {
    const jsonMatch = msg.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch {}
  const code = parsed?.error?.code ?? parsed?.code;
  const status = parsed?.error?.status ?? parsed?.status;

  if (code === 503 || /UNAVAILABLE|overloaded/i.test(msg)) {
    return {
      title: 'Servidor da IA sobrecarregado',
      description:
        'O modelo está com alta demanda no momento. Já tentei automaticamente 3 vezes mas ainda não respondeu.',
      hint:
        'Espere uns 30 segundos e tente novamente, ou troque pra Ollama (local) no seletor do topo.',
      technical: msg,
    };
  }

  if (
    code === 429 ||
    /RESOURCE_EXHAUSTED|quota|rate_limit_exceeded|Rate limit reached/i.test(msg)
  ) {
    const retryS = extractRetryDelaySeconds(msg);
    const isGroq = /groq/i.test(msg);
    return {
      title: 'Limite por minuto atingido',
      description:
        retryS != null
          ? `O modelo bateu o limite de tokens/minuto. Já tentei automaticamente respeitando ${retryS}s de espera, mas ainda não passou.`
          : 'Você bateu um dos limites de uso (tokens ou requests por minuto/dia).',
      hint: isGroq
        ? 'Aguarde ~30s e tente de novo. Pra contornar: divida em mensagens menores, troque pro Gemini no select, ou ative o Dev Tier do Groq pra subir limites.'
        : 'Aguarde ~60s pro limite resetar. Veja detalhes na aba Consumo IA.',
      technical: msg,
    };
  }

  if (code === 401 || code === 403 || /API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) {
    return {
      title: 'Chave de API inválida',
      description: 'A chave configurada não foi aceita pelo provider.',
      hint: 'Verifique VITE_GEMINI_API_KEY ou VITE_GROQ_API_KEY no .env e reinicie o dev server.',
      technical: msg,
    };
  }

  if (code === 400 || /INVALID_ARGUMENT|FAILED_PRECONDITION/i.test(msg)) {
    return {
      title: 'Pedido inválido',
      description:
        'O modelo não entendeu o formato da requisição. Geralmente isso é um bug ou um caso de borda.',
      hint: 'Tente reformular sua pergunta com menos contexto, ou apague a conversa e comece de novo.',
      technical: msg,
    };
  }

  if (/fetch failed|Failed to fetch|NetworkError|ERR_INTERNET/i.test(msg)) {
    return {
      title: 'Sem conexão',
      description: 'Não consegui falar com o provider de IA.',
      hint: 'Verifique sua internet. Se estiver no Ollama, confirme que ele está rodando com CORS liberado (OLLAMA_ORIGINS=*).',
      technical: msg,
    };
  }

  if (status === 'RESOURCE_EXHAUSTED') {
    return {
      title: 'Limite atingido',
      description: 'Algum limite do provider foi excedido.',
      hint: 'Aguarde alguns segundos.',
      technical: msg,
    };
  }

  // Genérico
  return {
    title: 'Erro inesperado',
    description: 'Algo deu errado durante a execução.',
    hint: 'Tente novamente. Se persistir, abra o console do navegador (F12) pra ver detalhes técnicos.',
    technical: msg,
  };
}

/**
 * Tenta extrair "try again in X.Xs" ou "retryDelay":"Xs" da mensagem de erro.
 */
export function extractRetryDelaySeconds(msg: string): number | null {
  const m1 = msg.match(/try again in ([\d.]+)\s*s/i);
  if (m1) return parseFloat(m1[1]);
  const m2 = msg.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
  if (m2) return parseFloat(m2[1]);
  const m3 = msg.match(/retry[_\s-]?after[":\s]+(\d+(?:\.\d+)?)/i);
  if (m3) return parseFloat(m3[1]);
  return null;
}

export interface RetryStatus {
  attempt: number;
  total: number;
  delayMs: number;
  reason: 'rate_limit' | 'overloaded' | 'network';
}

/**
 * Tenta a chamada ao provider com retry exponencial pra erros recuperáveis
 * (503 UNAVAILABLE, 429 rate-limit, network, timeouts).
 * Pra 429 com retryDelay no payload, respeita o tempo sugerido.
 */
async function generateWithRetry(
  provider: AgentProvider,
  args: ProviderRunArgs,
  options?: {
    signal?: AbortSignal;
    onRetry?: (status: RetryStatus) => void;
    onRetryClear?: () => void;
  }
): Promise<ProviderResponse> {
  const MAX_RETRIES = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (options?.signal?.aborted) throw new Error('Cancelado pelo usuário');
    try {
      const result = await provider.generate(args);
      options?.onRetryClear?.();
      return result;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = /\b429\b|rate_limit_exceeded|Rate limit reached/i.test(msg);
      const isOverloaded = /503|UNAVAILABLE|overloaded/i.test(msg);
      const isNetwork = /network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);
      const recoverable = isRateLimit || isOverloaded || isNetwork;
      if (!recoverable || attempt === MAX_RETRIES - 1) throw err;

      let delayMs: number;
      const retryS = extractRetryDelaySeconds(msg);
      if (retryS != null) {
        delayMs = Math.ceil(retryS * 1000) + 500;
      } else if (isRateLimit) {
        delayMs = 3000 * Math.pow(2, attempt);
      } else {
        delayMs = 1000 * Math.pow(2, attempt);
      }
      console.warn(
        `[agent] erro recuperável (tentativa ${attempt + 1}/${MAX_RETRIES}): ${msg.slice(0, 200)} — retry em ${delayMs}ms`
      );
      options?.onRetry?.({
        attempt: attempt + 1,
        total: MAX_RETRIES,
        delayMs,
        reason: isRateLimit ? 'rate_limit' : isOverloaded ? 'overloaded' : 'network',
      });
      // Sleep cancelável: aborta antes do tempo se signal for disparado
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        options?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('Cancelado pelo usuário'));
          },
          { once: true }
        );
      });
    }
  }
  throw lastErr;
}

export type { ChatTurn } from '@/lib/agent-types';

export const PROVIDERS: AgentProvider[] = [geminiProvider, groqProvider];

export function getProvider(id: string): AgentProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

const SYSTEM_INSTRUCTION = `Você é o **EGP**, a IA da EGP Tecnologia (fabricante de equipamentos eletrônicos de segurança). Você opera o sistema interno via as ferramentas disponíveis — não faz nada fora delas. Quando o usuário se referir a você como "EGP", "Chat EGP" ou similar, é a você que ele está falando.

## O que você faz
- **Responder perguntas** sobre custo, preço de venda, BOM, fornecedores, cotações: use as tools de leitura (list_*, find_*, get_*).
- **Cadastrar e configurar**: criar componentes, produtos, fornecedores; ajustar markup; adicionar/remover itens da BOM.
- **Executar tarefas**: criar cotação completa com exclusões, fornecedores e condições; atualizar e excluir registros.

## Princípio fundamental: EXECUTE direto, sem confirmação intermediária
Quando o usuário descreve uma tarefa com informação suficiente, **EXECUTE TUDO numa rodada só** — chame as tools necessárias na ordem certa e relate o resultado **depois**.

❌ NÃO faça: "Vou cadastrar X e Y. Posso prosseguir?"
❌ NÃO faça: "Encontrei o produto. Quer que eu atualize?"
❌ NÃO faça: "Aqui está o plano: 1... 2... 3... confirma?"
✅ FAÇA: chame todas as tools, depois relate "Cadastrei X, atualizei Y, removi Z."

Pergunte SOMENTE quando:
- **Falta info crítica** sem a qual uma tool não pode rodar (ex: "qual produto?" se nome ambíguo demais)
- **Ambiguidade real**: tool retorna ambiguous=true com candidatos → liste e pergunte
- **Ação destrutiva impactante** (delete_product com cotações ativas, esvaziar BOM inteira) → UMA pergunta curta antes de executar

Frases tipo "vou fazer X" sem ter feito = PROIBIDO. Se você sabe o que fazer, faça e relate.

## Regras importantes
1. Pra encontrar IDs, use as tools de leitura primeiro. NUNCA invente IDs/tokens.
   PORÉM: nas tools que aceitam, prefira passar nomes (component_name, supplier_email, etc) — mais natural pro usuário. NÃO peça IDs ao usuário se houver alternativa por nome.
   Se a tool retornar ambiguous=true com candidatos, mostre a lista pro usuário e pergunte qual.
3. Pra cotação: se o usuário mencionar produto por nome, use find_product_by_name antes; se mencionar emails, passe em supplier_emails (emails não cadastrados são ignorados, mas você é avisado).
   Links de cotação expiram. Se o usuário não disser prazo, use expires_in_hours=2. Se disser "2h", "24 horas", "até amanhã" etc, converta para expires_in_hours ou deadline.
4. Pra mudar o modo de markup de um produto, use update_product com pricing_mode = "markup_30" | "markup_50" | "ponto_7" | "custom" (este último exige custom_markup_pct também). O preço de venda é recalculado automaticamente.
5. Pra criar produto novo do zero: create_product → várias chamadas de add_bom_item (com component_name pra fuzzy match ou component_id). Se um componente não existir, sugira create_component antes.
   Quando o usuário pedir pra cadastrar vários componentes de uma vez, SEMPRE use bulk_create_components com a lista completa (uma chamada só). NÃO use create_component em loop.
6. Sempre que possível, agrupe info de retorno num formato fácil de ler: para cotações criadas, mostre o link público em destaque e a lista de invites nominais.
7. Responda em português do Brasil, conciso. Use markdown leve (negrito, listas) quando ajudar.

## Estilo de resposta
**Por padrão: CURTO E DIRETO.** Pense como Slack, não como ensaio.
- Usuário pergunta um valor → responda 1 frase com o valor. Ex: "R$ 121,30 com ponto 7."
- Usuário pede uma lista → mostre a lista. Sem introdução nem fechamento.
- Após executar tools → resuma em 1-2 linhas: "Cadastrei 3 componentes e adicionei à BOM."
- **NÃO explique fórmula/cálculo/metodologia** a menos que ele PEÇA explicitamente ("por quê?", "como você calculou?", "explica isso").
- **NÃO repita o que o usuário acabou de dizer.** Vá direto à ação/resposta.

## Importação de pedido via PDF (Conta Azul)
Quando o usuário enviar um PDF junto com a mensagem (ou pedir pra importar):
1. Leia o PDF e extraia **todos** os campos da venda: número da venda, data, dados do cliente (nome, CNPJ/CPF, endereço, telefone, email), itens (código, descrição, qtd, valor unit), total produtos, frete (tipo + valor), valor líquido, forma de pagamento, condição de pagamento.
2. **Se data_prevista (data de saída) não estiver no PDF**, pergunte: "Qual a data prevista de saída deste pedido?" antes de criar.
3. Use create_shipment com TODOS os campos extraídos, incluindo os itens (passando item_code, item_name, unit_price, quantity).
4. Ao terminar, confirme em 1-2 linhas: "Pedido Venda 5785 — LIDIA MARIA AMISS MAZINI criado. 2 itens, R$ 505,90, saída 30/04."
- Observações extras do PDF (ex: "enviar os RMA junto") → inclua no campo notes.

## Outras regras
- Pergunte antes de agir só se faltar info crítica (ex: "qual produto?").
- Se uma tool falhar, leia o erro e proponha correção curta.

## Memória persistente
Você tem 4 tools especiais pra lembrar fatos entre conversas: \`remember\`, \`list_memories\`, \`update_memory\`, \`forget_memory\`.
- Quando o usuário disser "aprenda que X", "lembre que X", "guarde isso", chame \`remember(content: ...)\`.
- Quando ele perguntar "o que você lembra?", chame \`list_memories\`.
- Quando ele disser "esqueça aquela regra", chame \`list_memories\` primeiro pra achar o id certo, depois \`forget_memory\`.
- Se o conteúdo da memória precisar mudar, use \`update_memory\` em vez de criar uma nova.
- Memórias já gravadas aparecem injetadas neste prompt (seção "Coisas que você aprendeu" abaixo, se houver).
`;

async function loadMemories(): Promise<{ id: string; content: string }[]> {
  const { data, error } = await supabase
    .from('agent_memories')
    .select('id, content')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[memories] load failed:', error);
    return [];
  }
  return (data ?? []) as { id: string; content: string }[];
}

async function loadProcedureCatalog(): Promise<{ name: string; description: string | null }[]> {
  const { data, error } = await supabase
    .from('agent_procedures')
    .select('name, description')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[procedures] load failed:', error);
    return [];
  }
  return (data ?? []) as { name: string; description: string | null }[];
}

function buildSystemInstruction(
  memories: { id: string; content: string }[],
  procedures: { name: string; description: string | null }[]
): string {
  let out = SYSTEM_INSTRUCTION;
  if (memories.length > 0) {
    out +=
      '\n\n## Coisas que você aprendeu (memórias persistentes — válidas em todas as conversas)\n' +
      memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
  }
  if (procedures.length > 0) {
    out +=
      '\n\n## Procedimentos disponíveis (playbooks aprendidos)\nQuando o usuário pedir pra "rodar/executar" um destes pelo nome (ou parecido), chame run_procedure(name="..."), receba os steps detalhados, e EXECUTE as tools necessárias. Catálogo:\n' +
      procedures
        .map((p, i) => `${i + 1}. **${p.name}** — ${p.description ?? '(sem descrição)'}`)
        .join('\n');
  }
  return out;
}

export interface RunOptions {
  provider: AgentProvider;
  history: ChatTurn[];
  userMessage: string;
  /** Arquivo inline (PDF) a ser enviado junto com a mensagem — só Gemini suporta */
  userInlineData?: { mimeType: string; data: string; fileName?: string };
  onTurn?: (turn: ChatTurn) => void;
  /** Sinal pra cancelar a execução (entre steps). */
  signal?: AbortSignal;
  /** Disparado quando entra em retry de erro recuperável. */
  onRetry?: (status: RetryStatus) => void;
  /** Disparado quando o retry foi resolvido (chamada bem-sucedida). */
  onRetryClear?: () => void;
}

export async function runAgent({
  provider,
  history,
  userMessage,
  userInlineData,
  onTurn,
  signal,
  onRetry,
  onRetryClear,
}: RunOptions): Promise<ChatTurn[]> {
  if (!provider.isConfigured()) {
    throw new Error(`Provider ${provider.name} não configurado.`);
  }

  // Adiciona mensagem do usuário ao histórico que enviamos ao provider
  const workingHistory: ChatTurn[] = [...history];
  const newTurns: ChatTurn[] = [];

  const userTurn: ChatTurn = { role: 'user', text: userMessage };
  if (userInlineData) userTurn.inlineData = userInlineData;
  workingHistory.push(userTurn);
  newTurns.push(userTurn);
  onTurn?.(userTurn);

  // Acumuladores de uso
  const startedAt = Date.now();
  let promptTokens = 0;
  let responseTokens = 0;
  let totalTokens = 0;
  let toolCallsCount = 0;
  let apiRequestsCount = 0;

  function logUsage() {
    const payload = {
      model: provider.modelLabel,
      prompt_tokens: promptTokens,
      response_tokens: responseTokens,
      total_tokens: totalTokens,
      tool_calls_count: toolCallsCount,
      api_requests_count: apiRequestsCount,
      duration_ms: Date.now() - startedAt,
      user_message: userMessage.slice(0, 500),
    };
    supabase
      .from('ai_usage')
      .insert(payload)
      .then(({ error }) => {
        if (error) console.error('[ai_usage] insert failed:', error, payload);
      })
      .then(undefined, (err) => console.error('[ai_usage] insert threw:', err));
  }

  // Carrega memórias e catálogo de procedures UMA vez no início do runAgent.
  // Se o user usar remember/define_procedure durante o loop, vão valer só no
  // próximo runAgent — aceitável.
  const [memories, procedures] = await Promise.all([loadMemories(), loadProcedureCatalog()]);
  const fullSystemInstruction = buildSystemInstruction(memories, procedures);

  const MAX_STEPS = 25;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal?.aborted) {
      throw new Error('Cancelado pelo usuário');
    }
    const response = await generateWithRetry(
      provider,
      {
        systemInstruction: fullSystemInstruction,
        tools: toolDeclarations as any,
        history: workingHistory,
      },
      { signal, onRetry, onRetryClear }
    );
    apiRequestsCount++;
    promptTokens += response.usage.promptTokens;
    responseTokens += response.usage.responseTokens;
    totalTokens += response.usage.totalTokens;

    const calls = response.toolCalls ?? [];

    if (calls.length === 0) {
      const text = response.text ?? '';
      const turn: ChatTurn = {
        role: 'model',
        text,
        provider: { id: provider.id, name: provider.name, model: provider.modelLabel },
      };
      newTurns.push(turn);
      workingHistory.push(turn);
      onTurn?.(turn);
      logUsage();
      return newTurns;
    }

    toolCallsCount += calls.length;

    for (const call of calls) {
      const callTurn: ChatTurn = {
        role: 'model',
        toolCall: { name: call.name, args: call.args },
        provider: { id: provider.id, name: provider.name, model: provider.modelLabel },
      };
      newTurns.push(callTurn);
      workingHistory.push(callTurn);
      onTurn?.(callTurn);

      let toolData: unknown = null;
      let toolError: string | undefined;
      try {
        toolData = await executeTool(call.name, call.args);
      } catch (err) {
        toolError = err instanceof Error ? err.message : String(err);
      }

      const respTurn: ChatTurn = {
        role: 'user',
        toolResponse: { name: call.name, data: toolData, error: toolError },
      };
      newTurns.push(respTurn);
      workingHistory.push(respTurn);
      onTurn?.(respTurn);
    }
  }

  const fallback: ChatTurn = {
    role: 'model',
    text: '⚠️ Atingi o limite de etapas sem chegar a uma resposta final. Tente reformular ou ser mais específico.',
    provider: { id: provider.id, name: provider.name, model: provider.modelLabel },
  };
  newTurns.push(fallback);
  onTurn?.(fallback);
  logUsage();
  return newTurns;
}
