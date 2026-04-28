import type { ShipmentStatus } from '@/types/db';

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  pending: 'Pendente',
  shipped: 'Saiu',
  returned: 'Voltou',
  cancelled: 'Cancelado',
};

export const STATUS_PILL: Record<ShipmentStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border border-amber-200',
  shipped: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  returned: 'bg-sky-50 text-sky-700 border border-sky-200',
  cancelled: 'bg-slate-100 text-slate-600 border border-slate-200',
};

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
