import { GoogleGenAI, type Content } from '@google/genai';
import type { AgentProvider, ProviderResponse } from './types';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';

let client: GoogleGenAI | null = null;
function getClient() {
  if (!client && apiKey) client = new GoogleGenAI({ apiKey });
  if (!client) throw new Error('Gemini não configurado');
  return client;
}

export const geminiProvider: AgentProvider = {
  id: 'gemini',
  name: 'Gemini',
  modelLabel: MODEL,

  isConfigured() {
    return Boolean(apiKey && apiKey.trim());
  },

  async ping() {
    if (!this.isConfigured()) {
      return { ok: false, message: 'VITE_GEMINI_API_KEY não definido' };
    }
    return { ok: true };
  },

  async generate({ systemInstruction, tools, history }): Promise<ProviderResponse> {
    const ai = getClient();
    const contents: Content[] = [];
    for (const t of history) {
      if (t.role === 'user' && t.text) {
        contents.push({ role: 'user', parts: [{ text: t.text }] });
      } else if (t.role === 'model' && t.text) {
        contents.push({ role: 'model', parts: [{ text: t.text }] });
      } else if (t.toolCall) {
        contents.push({
          role: 'model',
          parts: [{ functionCall: { name: t.toolCall.name, args: t.toolCall.args } }],
        });
      } else if (t.toolResponse) {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: t.toolResponse.name,
                response: t.toolResponse.error
                  ? { error: t.toolResponse.error }
                  : (t.toolResponse.data as Record<string, unknown>) ?? {},
              },
            },
          ],
        });
      }
    }

    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: tools as any }],
        temperature: 0.2,
      },
    });

    const calls = response.functionCalls ?? [];
    const usage = response.usageMetadata;
    return {
      text: calls.length === 0 ? response.text : undefined,
      toolCalls: calls.length > 0
        ? calls.map((c) => ({ name: c.name ?? '', args: (c.args ?? {}) as Record<string, unknown> }))
        : undefined,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        responseTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
    };
  },
};
