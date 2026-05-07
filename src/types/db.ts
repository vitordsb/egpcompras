// Tipos manuais inicialmente. Quando estabilizar, gerar via:
//   npx supabase gen types typescript --project-id <id> > src/types/db.generated.ts

export type Currency = 'BRL' | 'USD';
export type QuotationStatus = 'draft' | 'sent' | 'closed';
export type InviteStatus = 'pending' | 'sent' | 'opened' | 'responded' | 'expired';

export interface Component {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  ncm: string | null;
  unit: string;
  /** Quando este componente é uma "variante" (fork) de outro, aponta pro pai */
  parent_component_id: string | null;
  created_at: string;
}

export type PricingMode = 'markup_30' | 'markup_50' | 'ponto_7' | 'custom';

export interface Product {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;     // descrição de venda
  image_url: string | null;
  sale_price_brl: number | null;
  pricing_mode: PricingMode;
  custom_markup_pct: number | null; // só usado quando pricing_mode === 'custom'
  created_at: string;
}

// Linha da view products_with_cost — Product + custo unitário agregado.
export interface ProductWithCost extends Product {
  /** Custo total unitário (fabricacao + acervo, ou direct_cost_brl pra revenda) */
  unit_cost_brl: number;
  /** Apenas componentes da placa (tipo='fabricacao') */
  fabricacao_cost_brl?: number;
  /** Apenas embalagens/etiquetas/caixas (tipo='acervo') */
  acervo_cost_brl?: number;
}

export interface BomItem {
  id: string;
  product_id: string;
  component_id: string;
  quantity: number;
  target_price_brl: number | null;
  notes: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  email: string;
  contact_name: string | null;
  default_currency: Currency;
  notes: string | null;
  whatsapp_phone: string | null;
  created_at: string;
}

export interface Quotation {
  id: string;
  product_id: string;
  title: string;
  status: QuotationStatus;
  deadline: string | null;
  usd_brl_rate: number | null;
  created_at: string;
  closed_at: string | null;
}

export interface QuotationItem {
  id: string;
  quotation_id: string;
  component_id: string;
  quantity: number;
  target_price_brl: number | null;
  position: number;
}

export interface QuotationInvite {
  id: string;
  quotation_id: string;
  supplier_id: string;
  token: string;
  status: InviteStatus;
  sent_at: string | null;
  opened_at: string | null;
  responded_at: string | null;
}

export interface QuotationResponse {
  id: string;
  invite_id: string;
  currency: Currency;
  usd_brl_rate_used: number | null;
  notes: string | null;
  submitted_at: string;
}

export interface QuotationResponseItem {
  id: string;
  response_id: string;
  quotation_item_id: string;
  unit_price: number | null;
  ipi_pct: number;
  pis_pct: number;
  cofins_pct: number;
  st_pct: number;
}

export type ShipmentStatus = 'pending' | 'shipped' | 'returned' | 'cancelled';

export type CampaignSegment = 'all' | 'active' | 'inactive' | 'no_whatsapp' | 'opt_in_promo' | 'opt_in_catalog' | 'tag';
export type CampaignSendStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'opted_out';

export interface MarketingCampaign {
  id: string;
  name: string;
  description: string | null;
  template_name: string;
  template_lang: string;
  template_params: Record<string, string>;
  segment_filter: CampaignSegment;
  segment_tag: string | null;
  schedule_cron: string | null;
  next_run_at: string | null;
  max_per_run: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface MarketingSend {
  id: string;
  campaign_id: string;
  client_id: string | null;
  whatsapp_phone: string;
  status: CampaignSendStatus;
  message_id: string | null;
  error: string | null;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
}

export interface ClientContact {
  id: string;
  name: string;
  trade_name: string | null;
  cnpj: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  email: string | null;
  address: string | null;
  first_purchase_at: string | null;
  last_purchase_at: string | null;
  total_orders: number;
  total_spent: number;
  tags: string[];
  notes: string | null;
  opt_in_promo: boolean;
  opt_in_catalog: boolean;
  opt_in_at: string | null;
  opt_out_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Shipment {
  id: string;
  numero_nfe: string | null;
  numero_venda: string | null;
  data_venda: string | null;
  client_name: string;
  client_trade_name: string | null;
  client_cnpj: string | null;
  client_phone: string | null;
  client_email: string | null;
  client_address: string | null;
  status: ShipmentStatus;
  tipo_nota?: 'venda' | 'retorno_conserto' | 'retorno_garantia' | 'remessa_demonstracao' | 'remessa_conserto' | 'remessa_industrializacao' | 'rma' | 'outro';
  natureza_operacao?: string | null;
  data_prevista: string | null;
  data_saida: string | null;
  data_retorno: string | null;
  frete_tipo: string | null;
  frete_valor: number | null;
  total_produtos: number | null;
  valor_total: number | null;
  forma_pagamento: string | null;
  condicao_pagamento: string | null;
  chave_acesso: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShipmentItem {
  id: string;
  shipment_id: string;
  product_id: string | null;
  item_code: string | null;
  item_name: string | null;
  unit_price: number | null;
  quantity: number;
}

export interface ShipmentObservation {
  id: string;
  shipment_id: string;
  content: string;
  created_at: string;
}

export interface Financeira {
  id: string;
  nome: string;
  contato: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type TituloStatus = 'aberto' | 'pago' | 'devolvido' | 'protestado';

export interface Titulo {
  id: string;
  financeira_id: string;
  shipment_id: string | null;
  numero_titulo: string | null;
  numero_nfe: string | null;
  numero_venda: string | null;
  client_name: string;
  valor: number;
  vencimento: string | null;
  status: TituloStatus;
  data_entrada: string;
  data_pagamento: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Quando o schema estabilizar, gerar tipos via:
//   pnpm dlx supabase gen types typescript --project-id <ref> > src/types/db.generated.ts
