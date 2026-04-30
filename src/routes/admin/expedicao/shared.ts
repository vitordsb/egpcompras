import type { ShipmentStatus } from '@/types/db';
import { formatDateBR, formatDateTimeBR, todayBR } from '@/lib/dates';

// 'late' = data passou | 'pending' = é hoje | 'on_time' = futuro | sem data = pending
export type DisplayStatus = ShipmentStatus | 'late' | 'on_time';

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  pending: 'Pendente',
  shipped: 'Saiu',
  returned: 'Voltou',
  cancelled: 'Cancelado',
  late: 'Atrasado',
  on_time: 'No prazo',
};

export const STATUS_PILL: Record<DisplayStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border border-amber-200',
  shipped: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  returned: 'bg-sky-50 text-sky-700 border border-sky-200',
  cancelled: 'bg-slate-100 text-slate-600 border border-slate-200',
  late: 'bg-red-50 text-red-700 border border-red-200',
  on_time: 'bg-green-50 text-green-700 border border-green-200',
};

/** Retorna true se o pedido está pendente e a data prevista já passou. */
export function isLate(s: { status: ShipmentStatus; data_prevista: string | null }): boolean {
  if (s.status !== 'pending' || !s.data_prevista) return false;
  return s.data_prevista < todayBR();
}

/** Retorna true se o pedido é pendente e a data prevista é futura (após hoje). */
export function isOnTime(s: { status: ShipmentStatus; data_prevista: string | null }): boolean {
  if (s.status !== 'pending' || !s.data_prevista) return false;
  return s.data_prevista > todayBR();
}

/**
 * Status visual derivado — não altera o DB.
 *  - data_prevista < hoje → 'late' (vermelho)
 *  - data_prevista > hoje → 'on_time' (verde)
 *  - data_prevista == hoje OU sem data → 'pending' (amarelo)
 *  - shipped/returned/cancelled mantêm seu status
 */
export function effectiveStatus(s: { status: ShipmentStatus; data_prevista: string | null }): DisplayStatus {
  if (s.status !== 'pending') return s.status;
  if (isLate(s))   return 'late';
  if (isOnTime(s)) return 'on_time';
  return 'pending';
}

export const formatDate = formatDateBR;
export const formatDateTime = formatDateTimeBR;
