// Cotação USD→BRL via AwesomeAPI (free, sem chave).
// Doc: https://docs.awesomeapi.com.br/api-de-moedas
const ENDPOINT = 'https://economia.awesomeapi.com.br/last/USD-BRL';

type AwesomeResponse = {
  USDBRL: { bid: string; ask: string; create_date: string };
};

export async function fetchUsdBrl(): Promise<{ rate: number; fetchedAt: string }> {
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`Falha ao buscar cotação USD/BRL: ${res.status}`);
  const data = (await res.json()) as AwesomeResponse;
  const rate = Number(data.USDBRL.ask); // ask = preço de venda, mais conservador p/ compra
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Cotação USD/BRL inválida na resposta da AwesomeAPI');
  }
  return { rate, fetchedAt: data.USDBRL.create_date };
}

export function effectivePriceBRL(input: {
  unitPrice: number | null;
  currency: 'BRL' | 'USD';
  usdBrlRate?: number | null;
  ipiPct?: number;
  pisPct?: number;
  cofinsPct?: number;
  stPct?: number;
}): number | null {
  if (input.unitPrice == null) return null;
  const taxMultiplier =
    1 +
    (input.ipiPct ?? 0) +
    (input.pisPct ?? 0) +
    (input.cofinsPct ?? 0) +
    (input.stPct ?? 0);
  const fxMultiplier = input.currency === 'USD' ? input.usdBrlRate ?? 0 : 1;
  return input.unitPrice * taxMultiplier * fxMultiplier;
}
