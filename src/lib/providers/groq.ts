// Provider Groq — API gerenciada (cloud) que serve modelos open-source via
// endpoints OpenAI-compatible. Free tier: ~30 RPM e 14k RPD pra Llama 3.3 70B.
// Doc: https://console.groq.com/docs/api-reference

import type { AgentProvider, ProviderResponse, ToolDeclaration } from './types';
import type { ChatTurn } from '@/lib/agent-types';

const apiKey = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_MODEL = import.meta.env.VITE_GROQ_MODEL ?? 'llama-3.3-70b-versatile';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// Mesma conversão do Ollama: SDK Gemini usa Type UPPERCASE; OpenAI/Groq usam JSON Schema lowercase.
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

function buildTools(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: lowercaseSchema(t.parameters),
    },
  }));
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

function buildMessages(systemInstruction: string, history: ChatTurn[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: 'system', content: systemInstruction }];

  // Pra reconstruir a relação tool_call ↔ tool_response, geramos ids
  // sintéticos seqüenciais e mapeamos por nome de tool (último call vence).
  let counter = 0;
  const lastIdByName = new Map<string, string>();

  for (const t of history) {
    if (t.role === 'user' && t.text) {
      out.push({ role: 'user', content: t.text });
    } else if (t.role === 'model' && t.text) {
      out.push({ role: 'assistant', content: t.text });
    } else if (t.toolCall) {
      const id = `call_${counter++}`;
      lastIdByName.set(t.toolCall.name, id);
      out.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id,
            type: 'function',
            function: {
              name: t.toolCall.name,
              arguments: JSON.stringify(t.toolCall.args ?? {}),
            },
          },
        ],
      });
    } else if (t.toolResponse) {
      const id = lastIdByName.get(t.toolResponse.name) ?? `call_${counter++}`;
      out.push({
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify(
          t.toolResponse.error ? { error: t.toolResponse.error } : t.toolResponse.data ?? {}
        ),
      });
    }
  }
  return out;
}

interface GroqChatResponse {
  choices: {
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export const groqProvider: AgentProvider = {
  id: 'groq',
  name: 'Groq (cloud)',
  modelLabel: GROQ_MODEL,

  isConfigured() {
    return Boolean(apiKey && apiKey.trim());
  },

  async ping() {
    if (!this.isConfigured()) {
      return { ok: false, message: 'VITE_GROQ_API_KEY não definido' };
    }
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        if (res.status === 401) return { ok: false, message: 'Chave Groq inválida (401).' };
        return { ok: false, message: `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Falha ao conectar: ${msg}` };
    }
  },

  async generate({ systemInstruction, tools, history }): Promise<ProviderResponse> {
    if (!apiKey) throw new Error('VITE_GROQ_API_KEY não definido');
    const messages = buildMessages(systemInstruction, history);
    const groqTools = buildTools(tools);

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        tools: groqTools.length > 0 ? groqTools : undefined,
        tool_choice: groqTools.length > 0 ? 'auto' : undefined,
        temperature: 0.2,
        stream: false,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Groq HTTP ${res.status}: ${errBody}`);
    }
    const data = (await res.json()) as GroqChatResponse;
    const choice = data.choices?.[0];
    if (!choice) throw new Error('Resposta vazia do Groq');

    const toolCalls = (choice.message.tool_calls ?? []).map((c) => {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = c.function.arguments ? JSON.parse(c.function.arguments) : {};
      } catch (err) {
        console.warn('[groq] argumentos não-JSON, usando string:', err);
        parsedArgs = { _raw: c.function.arguments };
      }
      return { name: c.function.name, args: parsedArgs };
    });

    return {
      text: toolCalls.length === 0 ? choice.message.content ?? '' : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        responseTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    };
  },
};
