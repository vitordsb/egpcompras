// Captura áudio do microfone e transcreve via Gemini 2.5 Flash.
// O texto transcrito vai pro input pra o usuário revisar antes de enviar
// (segurança para comandos destrutivos).

import { GoogleGenAI } from '@google/genai';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';

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
 * Usa prompt curto pra evitar que o modelo invente respostas — só transcreve.
 */
export async function transcribeAudio(blob: Blob): Promise<string> {
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY não definida');
  if (blob.size < 200) throw new Error('Áudio muito curto. Tente de novo.');

  const base64 = await blobToBase64(blob);
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              'Transcreva o áudio abaixo em português do Brasil. Retorne SOMENTE o texto falado, sem nenhuma observação, formatação extra, aspas ou tradução. Se não conseguir entender, retorne uma string vazia.',
          },
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
  // Limpa aspas e marcadores comuns que o modelo às vezes adiciona
  return text.replace(/^["“”']+|["“”']+$/g, '').trim();
}
