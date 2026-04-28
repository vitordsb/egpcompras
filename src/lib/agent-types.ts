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
  /** Arquivo inline (PDF, etc.) anexado pelo usuário — só Gemini suporta */
  inlineData?: { mimeType: string; data: string; fileName?: string };
}
