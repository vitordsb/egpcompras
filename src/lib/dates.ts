// Helpers de data com tratamento correto de timezone (BRT/UTC-3).
//
// Bug que isso resolve: `new Date('2026-04-30')` é interpretado como UTC,
// que ao converter para BRT (UTC-3) cai em '2026-04-29T21:00:00', e
// `toLocaleDateString` exibe '29/04/2026' em vez de '30/04/2026'.

const BR_TZ = 'America/Sao_Paulo';

/**
 * Adiciona T12:00:00 a strings YYYY-MM-DD para travar a data ao meio-dia local
 * e evitar shifts de timezone em qualquer região.
 */
function safeParseDate(iso: string): Date {
  if (!iso) return new Date(NaN);
  // Se já tem T (datetime completo), usa como está
  if (iso.includes('T')) return new Date(iso);
  // Date-only → ancora ao meio-dia local (BRT) pra não pular o dia
  return new Date(iso + 'T12:00:00');
}

/**
 * Formata uma string ISO em DD/MM/YYYY na timezone BRT.
 * Aceita YYYY-MM-DD ou ISO completo. Retorna '—' se nulo/inválido.
 */
export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = safeParseDate(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: BR_TZ });
}

/**
 * Formata uma string ISO em DD/MM/YYYY HH:mm na timezone BRT.
 */
export function formatDateTimeBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = safeParseDate(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { timeZone: BR_TZ, dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Retorna a data de hoje em YYYY-MM-DD na timezone BRT.
 * Resolve o bug de virada de dia: depois das 21h BRT,
 * `new Date().toISOString().slice(0,10)` já retornava o próximo dia (UTC).
 */
export function todayBR(): string {
  // en-CA produz formato YYYY-MM-DD diretamente
  return new Date().toLocaleDateString('en-CA', { timeZone: BR_TZ });
}

/**
 * Soma `delta` dias a uma data YYYY-MM-DD, retornando outra YYYY-MM-DD.
 */
export function addDaysBR(iso: string, delta: number): string {
  const d = safeParseDate(iso);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('en-CA', { timeZone: BR_TZ });
}

/**
 * Calcula dias entre duas datas (ignora horas).
 */
export function daysBetween(isoA: string, isoB: string): number {
  const a = safeParseDate(isoA).getTime();
  const b = safeParseDate(isoB).getTime();
  return Math.floor((b - a) / 86400000);
}

/**
 * Quantos dias se passaram desde uma data até hoje (BRT).
 * Útil para "X dias atrás", "X dias inativo", etc.
 */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return daysBetween(iso, todayBR());
}

/**
 * Quantos dias faltam até uma data (BRT). Negativo se já passou.
 */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return daysBetween(todayBR(), iso);
}
