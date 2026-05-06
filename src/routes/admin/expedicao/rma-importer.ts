// Lê uma foto/PDF da planilha técnica de RMA da EGP e extrai os campos
// estruturados via Gemini 2.5 Flash multimodal.

import { GoogleGenAI } from '@google/genai';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';

export interface ExtractedRmaItem {
  posicao?: number;
  item_name?: string;            // ex: "EGP 12V"
  componentes_trocados?: string;
  observacao_status?: string;    // "Desgaste do Componente" / "Testada" / "Erro de Ligação" / "Sem Defeito"
  data_fabricacao?: string;      // ISO YYYY-MM-DD
  tem_garantia?: boolean;
  valor_total?: number;
}

export interface ExtractedRma {
  client_name?: string;          // razão social do distribuidor
  client_trade_name?: string;
  client_cnpj?: string;
  client_phone?: string;
  client_email?: string;
  tecnico_nome?: string;
  tecnico_phone?: string;
  setor?: string;
  volume?: number;
  numero_os?: string;
  data_recebido?: string;        // ISO YYYY-MM-DD
  data_devolvido?: string;       // ISO YYYY-MM-DD
  desconto?: number;
  prazo_entrega?: string;
  condicao_pagamento?: string;
  items?: ExtractedRmaItem[];
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const SCHEMA_HINT = `
Retorne JSON estrito com este shape (omita campos que não existem na imagem):

{
  "client_name": "razão social do distribuidor (ex: 'Mundial Distribuidora')",
  "client_trade_name": "nome fantasia se diferente",
  "client_cnpj": "00.000.000/0000-00",
  "client_phone": "(11) 99999-9999",
  "client_email": "...",
  "tecnico_nome": "nome do técnico (ex: 'Julios')",
  "tecnico_phone": "(11) 99327-6306",
  "setor": "Manutenção",
  "volume": 1,
  "numero_os": "01050625",
  "data_recebido": "YYYY-MM-DD",
  "data_devolvido": "YYYY-MM-DD",
  "desconto": 0,
  "prazo_entrega": "YYYY-MM-DD",
  "condicao_pagamento": "...",
  "items": [
    {
      "posicao": 1,
      "item_name": "EGP 12V",
      "componentes_trocados": "Bobina, Res. 100K 3W",
      "observacao_status": "Desgaste do Componente",
      "data_fabricacao": "YYYY-MM-DD",
      "tem_garantia": false,
      "valor_total": 15.00
    }
  ]
}

REGRAS:
- Datas SEMPRE em ISO YYYY-MM-DD. "30/01/24" vira "2024-01-30".
- Garantia: "Sim" → true, "Não" → false.
- Valores: number sem prefixo "R$" e ponto decimal (ex: 15.00 não "R$ 15,00").
- "ENTRADA" vai pra data_recebido. "TÉRMINO" vai pra data_devolvido.
- Quando o produto for "EGP 12V" ou similar, copie EXATAMENTE como está.
- "Componentes" é a coluna que lista as peças trocadas/inspecionadas.
- "Observação" é o status diagnóstico (Desgaste / Testada / Erro de Ligação / Sem Defeito).
- Se houver linhas vazias na planilha, IGNORE — não inclua no array.
- Retorne APENAS JSON válido, sem markdown, sem texto explicativo.
`;

/**
 * Manda uma imagem ou PDF da planilha pra Gemini Flash e extrai campos
 * estruturados de RMA. Joga na cara do Gemini um schema rígido.
 */
export async function extractRmaFromImage(file: File | Blob): Promise<ExtractedRma> {
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY não definida');
  const sizeMb = (file as File).size / (1024 * 1024);
  if (sizeMb > 18) throw new Error(`Arquivo muito grande (${sizeMb.toFixed(1)} MB). Limite: 18 MB.`);

  const base64 = await blobToBase64(file);
  const mimeType = (file as File).type || 'image/jpeg';

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              'Você é um extrator de dados estruturados. Esta imagem (ou PDF) é uma planilha de RMA de uma indústria de eletrônicos chamada EGP Tecnologia. Extraia todos os campos do cabeçalho e cada linha da tabela de itens.' +
              SCHEMA_HINT,
          },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    config: { temperature: 0, maxOutputTokens: 4000 },
  });

  const text = (res.text ?? '').trim();
  if (!text) throw new Error('Gemini retornou resposta vazia.');

  // Limpa code-fences se vier
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('[rma-importer] JSON parse falhou:', cleaned.slice(0, 500));
    throw new Error('Não consegui ler a estrutura. A planilha pode estar pouco legível — tente foto melhor.');
  }
  return parsed as ExtractedRma;
}
