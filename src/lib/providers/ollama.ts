import type { AgentProvider, ProviderResponse, ToolDeclaration } from './types';
import type { ChatTurn } from '@/lib/agent-types';

const OLLAMA_URL = (import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'qwen2.5:7b';

// O Gemini SDK usa Type strings em UPPERCASE (OBJECT, STRING, ARRAY, NUMBER...).
// Ollama segue JSON Schema padrão (lowercase). Convertemos aqui.
function lowercaseSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(lowercaseSchema);
  const out: any = { ...schema };
  if (typeof out.type === 'string') out.type = out.type.toLowerCase();
  if (out.properties) {
    const props: any = {};
    for (const [k, v] of Object.entries(out.properties)) props[k] = lowercaseSchema(v);
    out.properties = props;
  }
  if (out.items) out.items = lowercaseSchema(out.items);
  return out;
}

function buildOllamaTools(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: lowercaseSchema(t.parameters),
    },
  }));
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string; // pra role=tool, indica qual tool foi respondida
}

function buildOllamaMessages(systemInstruction: string, history: ChatTurn[]): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: 'system', content: systemInstruction }];
  // Alguns modelos esperam tool calls e tool responses agrupados — iteramos
  // serial e empilhamos. O formato Ollama pra tool response é role: 'tool'.
  for (const t of history) {
    if (t.role === 'user' && t.text) {
      out.push({ role: 'user', content: t.text });
    } else if (t.role === 'model' && t.text) {
      out.push({ role: 'assistant', content: t.text });
    } else if (t.toolCall) {
      out.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: t.toolCall.name,
              arguments: t.toolCall.args,
            },
          },
        ],
      });
    } else if (t.toolResponse) {
      out.push({
        role: 'tool',
        tool_name: t.toolResponse.name,
        content: JSON.stringify(
          t.toolResponse.error ? { error: t.toolResponse.error } : t.toolResponse.data ?? {}
        ),
      });
    }
  }
  return out;
}

interface OllamaChatResponse {
  message?: {
    role: string;
    content: string;
    tool_calls?: {
      function: { name: string; arguments: Record<string, unknown> };
    }[];
  };
  prompt_eval_count?: number;
  eval_count?: number;
  done?: boolean;
}

export const ollamaProvider: AgentProvider = {
  id: 'ollama',
  name: 'Ollama (local)',
  modelLabel: OLLAMA_MODEL,
  verboseInstructions: true,

  isConfigured() {
    return Boolean(OLLAMA_URL);
  },

  async ping() {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const data = await res.json();
      const models: { name: string }[] = data.models ?? [];
      const has = models.some((m) => m.name.startsWith(OLLAMA_MODEL.split(':')[0]));
      if (!has) {
        return {
          ok: false,
          message: `Modelo ${OLLAMA_MODEL} não encontrado. Rode: ollama pull ${OLLAMA_MODEL}`,
        };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Ollama não respondeu (${msg}). Tá rodando? CORS liberado?` };
    }
  },

  async generate({ systemInstruction, tools, history }): Promise<ProviderResponse> {
    const messages = buildOllamaMessages(systemInstruction, history);
    const ollamaTools = buildOllamaTools(tools);

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        tools: ollamaTools,
        stream: false,
        options: { temperature: 0.2 },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Ollama HTTP ${res.status}: ${errBody}`);
    }
    const data = (await res.json()) as OllamaChatResponse;

    const toolCalls = (data.message?.tool_calls ?? []).map((c) => ({
      name: c.function.name,
      args: typeof c.function.arguments === 'string'
        ? (JSON.parse(c.function.arguments) as Record<string, unknown>)
        : (c.function.arguments ?? {}),
    }));

    return {
      text: toolCalls.length === 0 ? (data.message?.content ?? '') : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        responseTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  },
};
