// Detecta quando o usuário corrige a IA e propõe uma memória persistente
// para evitar a mesma correção no futuro.

import { GoogleGenAI } from '@google/genai';
import type { ChatTurn } from '@/lib/agent-types';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';

// Padrões fortes — aparecem no início ou são frases inteiras de correção.
const STRONG_PATTERNS = [
  /^\s*(perd[aã]o|desculpa|alias|na verdade|errei|fiz errado|t[aá] errado|t[aá] incorreto|incorreto|esquece(?:\s|,|\.|$)|n[aã]o (?:[eé]|era|foi) (?:isso|assim))/i,
  /^\s*n[aã]o\b.*(é|era|foi|está|tá|fica|deve)/i,
  /(?:isso\s+(?:está|tá|fica)\s+errado|fiz?\s+errado|informa[cç][aã]o\s+errada)/i,
  /(?:n[aã]o\s+(?:precisava|devia|deveria|era pra|era pro))/i,
];

// Tokens que sozinhos NÃO contam (evita falso positivo: "não tenho isso", "não sei")
const FALSE_POSITIVE_PATTERNS = [
  /^\s*n[aã]o\s+(sei|tenho|consigo|encontrei|achei|lembro|posso)\b/i,
  /^\s*n[aã]o\s*$/i,
];

/**
 * Heurística: detecta se a mensagem do usuário é uma correção da resposta anterior da IA.
 * Só dispara quando o turno anterior do model fez algo (tool call ou afirmação).
 */
export function isCorrection(userText: string, lastModelTurn: ChatTurn | undefined): boolean {
  if (!lastModelTurn || lastModelTurn.role !== 'model') return false;
  // Só conta como correção se o turno anterior REALMENTE fez algo (executou tool ou afirmou)
  const modelDidSomething = !!lastModelTurn.toolCall || (lastModelTurn.text && lastModelTurn.text.length > 20);
  if (!modelDidSomething) return false;

  const t = userText.trim();
  if (t.length < 3) return false;

  // Falso positivo? rejeita
  for (const fp of FALSE_POSITIVE_PATTERNS) {
    if (fp.test(t)) return false;
  }

  // Padrão forte de correção?
  for (const p of STRONG_PATTERNS) {
    if (p.test(t)) return true;
  }
  return false;
}

export interface MemoryProposal {
  /** Texto sugerido para memória persistente */
  content: string;
  /** Resumo curto do que aconteceu (mostrado no banner) */
  reason: string;
}

/**
 * Chama Gemini Flash com prompt curto pra extrair uma memória acionável da correção.
 * Retorna null se não houver lição clara.
 */
export async function proposeMemoryFromCorrection(
  history: ChatTurn[],
  correctionText: string
): Promise<MemoryProposal | null> {
  if (!apiKey) return null;

  // Pega as últimas ~6 mensagens para contexto
  const recent = history.slice(-6).map((t) => {
    if (t.role === 'user' && t.text) return `Usuário: ${t.text}`;
    if (t.role === 'model' && t.text) return `IA: ${t.text}`;
    if (t.role === 'model' && t.toolCall) return `IA executou tool: ${t.toolCall.name}(${JSON.stringify(t.toolCall.args).slice(0, 200)})`;
    if (t.role === 'user' && t.toolResponse) {
      const data = (t.toolResponse.data as any) ?? null;
      return `Resultado da tool ${t.toolResponse.name}: ${data ? JSON.stringify(data).slice(0, 200) : '(vazio)'}`;
    }
    return '';
  }).filter(Boolean).join('\n');

  const prompt = `Você analisa conversas entre um usuário (operador da empresa EGP, fabricante de eletrônicos de segurança) e uma IA assistente interna. O usuário acabou de corrigir a IA. Sua tarefa: extrair UMA regra/memória curta (1 frase, máx 200 caracteres) que evite essa correção no futuro.

Conversa recente:
${recent}

Última mensagem do usuário (a correção):
"${correctionText}"

REGRAS:
- Retorne JSON válido: {"content": "...", "reason": "..."} OU {"skip": true, "why": "..."}
- "content" = a regra a ser memorizada (ex: "Pedidos do cliente HIKTEC sempre têm marca própria — sempre verificar a coluna 'Detalhe do item' do PDF antes de cadastrar.")
- "reason" = 1 linha curta resumindo o que motivou (ex: "IA não detectou marca própria HIKTEC no pedido")
- Use {"skip": true} quando: a correção é só pedido pra refazer com info nova, ou é decisão pontual sem regra geral, ou não houve erro real
- Não invente — só memorize o que ficou explícito na correção

JSON:`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.2, maxOutputTokens: 200 },
    });
    const text = res.text?.trim() ?? '';
    if (!text) return null;
    const cleaned = text.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.skip) return null;
    if (!parsed.content || typeof parsed.content !== 'string') return null;
    return {
      content: String(parsed.content).trim().slice(0, 500),
      reason: String(parsed.reason ?? '').trim().slice(0, 200),
    };
  } catch (err) {
    console.warn('[correction-detector] falha ao propor memória:', err);
    return null;
  }
}
