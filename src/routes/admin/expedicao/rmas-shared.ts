// Tipos e helpers compartilhados do módulo RMA.

export type RmaStatus = 'recebido' | 'analise' | 'conserto' | 'pronto' | 'devolvido' | 'cancelado';
export type RmaMotivo = 'defeito' | 'desistencia' | 'garantia' | 'outro';
export type RmaSolucao = 'pendente' | 'troca' | 'reparo' | 'refund' | 'descartado' | 'outro';

export interface RmaItem {
  id: string;
  product_id: string | null;
  item_name: string | null;
  item_code: string | null;
  serial_number: string | null;
  quantity: number;
  notes: string | null;
}

export interface RmaRow {
  id: string;
  numero: number;
  client_name: string;
  client_trade_name: string | null;
  client_cnpj: string | null;
  client_phone: string | null;
  client_email: string | null;
  motivo: RmaMotivo;
  status: RmaStatus;
  diagnostico: string | null;
  solucao: RmaSolucao;
  data_recebido: string | null;
  data_devolvido: string | null;
  shipment_origem_id: string | null;
  numero_venda_origem: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  observations_count?: number;
}

export const STATUS_LABEL: Record<RmaStatus, string> = {
  recebido:  'Recebido',
  analise:   'Em análise',
  conserto:  'Em conserto',
  pronto:    'Pronto p/ devolver',
  devolvido: 'Devolvido',
  cancelado: 'Cancelado',
};

export const STATUS_PILL: Record<RmaStatus, string> = {
  recebido:  'bg-blue-50 text-blue-700 border border-blue-200',
  analise:   'bg-amber-50 text-amber-700 border border-amber-200',
  conserto:  'bg-purple-50 text-purple-700 border border-purple-200',
  pronto:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  devolvido: 'bg-slate-100 text-slate-700 border border-slate-200',
  cancelado: 'bg-red-50 text-red-700 border border-red-200',
};

export const MOTIVO_LABEL: Record<RmaMotivo, string> = {
  defeito:     'Defeito',
  desistencia: 'Desistência',
  garantia:    'Garantia',
  outro:       'Outro',
};

export const SOLUCAO_LABEL: Record<RmaSolucao, string> = {
  pendente:    'Pendente',
  troca:       'Troca',
  reparo:      'Reparo',
  refund:      'Refund',
  descartado:  'Descartado',
  outro:       'Outro',
};

export function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}
