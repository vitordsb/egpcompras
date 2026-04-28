import type { ShipmentStatus } from '@/types/db';

export type DisplayStatus = ShipmentStatus | 'late';

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  pending: 'Pendente',
  shipped: 'Saiu',
  returned: 'Voltou',
  cancelled: 'Cancelado',
  late: 'Atrasado',
};

export const STATUS_PILL: Record<DisplayStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border border-amber-200',
  shipped: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  returned: 'bg-sky-50 text-sky-700 border border-sky-200',
  cancelled: 'bg-slate-100 text-slate-600 border border-slate-200',
  late: 'bg-red-50 text-red-700 border border-red-200',
};

/** Retorna true se o pedido está pendente e a data prevista já passou. */
export function isLate(s: { status: ShipmentStatus; data_prevista: string | null }): boolean {
  if (s.status !== 'pending' || !s.data_prevista) return false;
  // Compara só a data (sem hora) pra não depender de timezone
  const today = new Date().toISOString().slice(0, 10);
  return s.data_prevista < today;
}

/** Status visual derivado — não altera o DB. */
export function effectiveStatus(s: { status: ShipmentStatus; data_prevista: string | null }): DisplayStatus {
  return isLate(s) ? 'late' : s.status;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
