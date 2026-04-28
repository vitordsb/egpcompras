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
    // Chamada light pra validar a chave de verdade (lista modelos).
    // Pega 401/403/400 com chave inválida sem consumir cota de geração.
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) return { ok: true };
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Chave inválida ou sem permissão' };
      }
      return { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Falha ao conectar: ${msg}` };
    }
  },

  async generate({ systemInstruction, tools, history }): Promise<ProviderResponse> {
    const ai = getClient();
    const contents: Content[] = [];
    for (const t of history) {
      if (t.role === 'user' && (t.text || t.inlineData)) {
        const parts: any[] = [];
        if (t.inlineData?.data) {
          // Só inclui o PDF se ainda tiver o base64 (memória desta sessão).
          // Turns carregados do banco não têm o data — são ignorados.
          parts.push({ inlineData: { mimeType: t.inlineData.mimeType, data: t.inlineData.data } });
        }
        if (t.text) parts.push({ text: t.text });
        contents.push({ role: 'user', parts });
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
