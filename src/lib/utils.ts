export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function formatBRL(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatUSD(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPct(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Constrói a URL pública pra fornecedor abrir uma cotação.
 *
 * - Em produção, usa VITE_PUBLIC_QUOTE_BASE_URL (ex: https://cotacao.grupoegp.com.br)
 *   e retorna https://cotacao.grupoegp.com.br/<token> (sem prefixo /cotacao/, pois
 *   o subdomínio dedicado já dá o contexto).
 * - Em dev (sem env var), retorna http://localhost:5173/cotacao/<token>.
 */
export function buildPublicQuoteUrl(token: string): string {
  const base = import.meta.env.VITE_PUBLIC_QUOTE_BASE_URL;
  if (base && base.trim()) {
    return `${base.replace(/\/$/, '')}/${token}`;
  }
  if (typeof window === 'undefined') return `/cotacao/${token}`;
  return `${window.location.origin}/cotacao/${token}`;
}
