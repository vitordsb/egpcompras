// Estrutura de um turn de conversa armazenado no histórico/banco.
// Compartilhada entre orquestrador, providers e UI.

export interface ChatTurnProvider {
  id: string;        // 'gemini' | 'ollama' | ...
  name: string;      // ex: "Gemini"
  model: string;     // ex: "gemini-2.5-flash"
}

export interface ChatTurn {
  role: 'user' | 'model';
  text?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  toolResponse?: { name: string; data: unknown; error?: string };
  /** Marcado em turns do model — qual provider gerou aquela resposta */
  provider?: ChatTurnProvider;
  /** Arquivo inline único (legado — mantido para compat com histórico gravado) */
  inlineData?: { mimeType: string; data: string; fileName?: string };
  /** Lista de arquivos inline — usado quando múltiplos PDFs são enviados de uma vez */
  inlineDataList?: Array<{ mimeType: string; data: string; fileName?: string }>;
  /** ISO timestamp de quando o turn foi gerado (apenas turns novos — histórico carregado não terá) */
  timestamp?: string;
  /** True enquanto o texto ainda está chegando via streaming (UI usa pra mostrar cursor) */
  streaming?: boolean;
}
