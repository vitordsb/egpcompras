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
  unit_cost_brl: number;
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

// Quando o schema estabilizar, gerar tipos via:
//   pnpm dlx supabase gen types typescript --project-id <ref> > src/types/db.generated.ts
