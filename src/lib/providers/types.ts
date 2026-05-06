// Interface comum de provider de IA com function calling.
// Implementações concretas: gemini (cloud) e ollama (local).

import type { ChatTurn } from '@/lib/agent-types';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ProviderUsage {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

export interface ProviderResponse {
  text?: string;
  toolCalls?: ToolCall[];
  usage: ProviderUsage;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderRunArgs {
  systemInstruction: string;
  tools: ToolDeclaration[];
  history: ChatTurn[]; // histórico completo (inclui o último user message + tool calls/responses já executadas)
}

/** Chunk emitido durante streaming. text é parcial e vai sendo concatenado */
export interface ProviderStreamChunk {
  /** Pedaço de texto novo desde o último chunk (não acumulado) */
  text?: string;
  /** Tool calls — só vem no chunk final, geralmente */
  toolCalls?: ToolCall[];
  /** Uso de tokens — só vem no chunk final */
  usage?: ProviderUsage;
  /** True no último chunk do stream */
  done?: boolean;
}

export interface AgentProvider {
  id: 'gemini' | 'groq';
  name: string;
  modelLabel: string;
  /** Se a configuração mínima (chave / URL) está presente */
  isConfigured(): boolean;
  /** Verifica se o provider está realmente acessível agora */
  ping(): Promise<{ ok: boolean; message?: string }>;
  /** Faz uma chamada à API e retorna texto OU tool calls + uso de tokens */
  generate(args: ProviderRunArgs): Promise<ProviderResponse>;
  /** Versão streaming — quando suportada, yields chunks à medida que chegam */
  generateStream?(args: ProviderRunArgs): AsyncIterable<ProviderStreamChunk>;
}
