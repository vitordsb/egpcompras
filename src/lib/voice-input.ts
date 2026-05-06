// Captura áudio do microfone e transcreve via Gemini 2.5 Flash.
// O texto transcrito vai pro input pra o usuário revisar antes de enviar
// (segurança para comandos destrutivos).

import { GoogleGenAI } from '@google/genai';
import { supabase } from '@/lib/supabase';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';

// Cache do vocabulário da empresa — recarrega no máx a cada 5min
let vocabCache: { items: string[]; loadedAt: number } | null = null;
const VOCAB_TTL_MS = 5 * 60 * 1000;

async function loadCompanyVocabulary(): Promise<string[]> {
  if (vocabCache && Date.now() - vocabCache.loadedAt < VOCAB_TTL_MS) {
    return vocabCache.items;
  }
  try {
    const [contacts, products, clients, suppliers, sellers, templates, components] = await Promise.all([
      supabase.from('whatsapp_contacts').select('name').limit(100),
      supabase.from('products').select('name').limit(150),
      supabase.from('client_contacts').select('name, trade_name').limit(120),
      supabase.from('suppliers').select('name').limit(80),
      supabase.from('sellers').select('name').limit(20),
      supabase.from('marketing_templates').select('name').limit(40),
      supabase.from('components').select('name').limit(60),
    ]);
    const set = new Set<string>();
    for (const r of (contacts.data ?? []) as any[]) if (r.name) set.add(String(r.name).trim());
    for (const r of (products.data ?? []) as any[]) if (r.name) set.add(String(r.name).trim());
    for (const r of (clients.data ?? []) as any[]) {
      if (r.name) set.add(String(r.name).trim());
      if (r.trade_name) set.add(String(r.trade_name).trim());
    }
    for (const r of (suppliers.data ?? []) as any[]) if (r.name) set.add(String(r.name).trim());
    for (const r of (sellers.data ?? []) as any[]) if (r.name) set.add(String(r.name).trim());
    for (const r of (templates.data ?? []) as any[]) if (r.name) set.add(String(r.name).trim());
    for (const r of (components.data ?? []) as any[]) if (r.name) set.add(String(r.name).trim());
    const items = Array.from(set).filter((s) => s.length >= 2 && s.length <= 60);
    vocabCache = { items, loadedAt: Date.now() };
    return items;
  } catch (err) {
    console.warn('[voice-input] falha ao carregar vocabulário:', err);
    return vocabCache?.items ?? [];
  }
}

/** Limpa o cache — usado quando o usuário cadastra novo contato/produto */
export function invalidateVoiceVocabulary() {
  vocabCache = null;
}

export interface ActiveRecording {
  stop: () => Promise<Blob>;
  cancel: () => void;
  stream: MediaStream;
  startedAt: number;
}

/**
 * Inicia gravação do microfone. Retorna handle com `stop()` (resolve com Blob)
 * e `cancel()` (descarta sem retornar áudio).
 *
 * Pede permissão na 1ª chamada — o navegador trata o prompt.
 */
export async function startRecording(): Promise<ActiveRecording> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Seu navegador não suporta gravação de áudio.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  // Preferência de mime: opus é o mais leve e bem suportado pelo Gemini
  const mimeOptions = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  const mimeType = mimeOptions.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(100);
  const startedAt = Date.now();

  let cancelled = false;

  function cleanup() {
    stream.getTracks().forEach((t) => t.stop());
  }

  return {
    stream,
    startedAt,
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        if (cancelled) return reject(new Error('Gravação cancelada'));
        if (recorder.state === 'inactive') {
          cleanup();
          return resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
        }
        recorder.onstop = () => {
          cleanup();
          resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
        };
        recorder.onerror = (e) => {
          cleanup();
          reject(e);
        };
        recorder.stop();
      }),
    cancel: () => {
      cancelled = true;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      cleanup();
    },
  };
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

/**
 * Manda o áudio gravado pro Gemini Flash e retorna a transcrição em PT-BR.
 * Injeta vocabulário da empresa (nomes de contatos, produtos, clientes,
 * fornecedores) pra melhorar a transcrição de termos próprios — ex: "Natana"
 * vira "Nathanna", "no break" vira "nobreak".
 */
export async function transcribeAudio(blob: Blob): Promise<string> {
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY não definida');
  if (blob.size < 200) throw new Error('Áudio muito curto. Tente de novo.');

  const [base64, vocab] = await Promise.all([blobToBase64(blob), loadCompanyVocabulary()]);

  const vocabHint = vocab.length > 0
    ? `\n\nIMPORTANTE — Esta empresa (EGP, fabricante de eletrônicos) tem termos próprios. Quando o áudio falar algo FONETICAMENTE PARECIDO com qualquer item desta lista, escreva EXATAMENTE como está aqui (mesma grafia, sem traduzir, sem corrigir, sem separar palavras):\n\n${vocab.join(' · ')}\n\nExemplos do tipo de correção esperada: "Natana"→"Nathanna", "no break"→"nobreak", "iktek"→"HIKTEC". Sempre prefira o termo da lista se houver match razoável.`
    : '';

  const promptText =
    'Transcreva o áudio abaixo em português do Brasil. Retorne SOMENTE o texto falado, sem nenhuma observação, formatação extra, aspas ou tradução. Se não conseguir entender, retorne uma string vazia.' +
    vocabHint;

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType: blob.type || 'audio/webm',
              data: base64,
            },
          },
        ],
      },
    ],
    config: { temperature: 0, maxOutputTokens: 600 },
  });
  const text = (res.text ?? '').trim();
  return text.replace(/^["“”']+|["“”']+$/g, '').trim();
}
