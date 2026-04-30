export type UserRole = 'admin' | 'vendas' | 'compras' | 'expedicao' | 'financeiro' | 'producao';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin:      'Administrador',
  vendas:     'Vendas',
  compras:    'Compras',
  expedicao:  'Expedição',
  financeiro: 'Financeiro',
  producao:   'Produção',
};

export const ALL_ROLES: UserRole[] = ['vendas', 'compras', 'expedicao', 'financeiro', 'producao'];

// Emails sempre admin — imutável
export const HARDCODED_ADMINS = ['vitor@grupoegp.com.br', 'joane@grupoegp.com.br'];

// ===== Seções (page keys) =====

export type PageKey =
  | 'produtos' | 'whatsapp' | 'clientes' | 'campanhas'
  | 'cotacoes' | 'componentes' | 'falta_comprar' | 'fornecedores'
  | 'pedidos'  | 'saidas'
  | 'financeira'
  | 'producao' | 'estoque';

export interface PageDef {
  label: string;
  group: string;          // agrupamento visual na UI
  paths: string[];        // prefixos de rota
  tools: string[];        // tools liberadas ao ter acesso a essa seção
}

export const PAGE_DEFINITIONS: Record<PageKey, PageDef> = {
  produtos: {
    label: 'Produtos',
    group: 'Vendas',
    paths: ['/admin/produtos'],
    tools: ['list_products','find_product_by_name','get_product_details','summarize_catalog',
            'find_products_using_component','set_product_type','search_all'],
  },
  whatsapp: {
    label: 'WhatsApp',
    group: 'Vendas',
    paths: ['/admin/whatsapp'],
    tools: ['send_whatsapp_message','find_whatsapp_contact','list_whatsapp_contacts',
            'save_whatsapp_contact','list_whatsapp_conversations','get_whatsapp_conversation'],
  },
  clientes: {
    label: 'Clientes',
    group: 'Vendas',
    paths: ['/admin/clientes'],
    tools: ['list_client_contacts','find_client_contact','save_client_contact',
            'update_client_contact','delete_client_contact','tag_client_contact'],
  },
  campanhas: {
    label: 'Campanhas',
    group: 'Vendas',
    paths: ['/admin/campanhas'],
    tools: [],
  },
  cotacoes: {
    label: 'Cotações + Custos',
    group: 'Compras',
    paths: ['/admin/cotacoes', '/admin/custos'],
    tools: ['list_quotations','get_quotation_details','list_quotation_responses',
            'create_quotation','update_quotation','delete_quotation',
            'create_quotation_from_list','analyze_quotation_responses',
            'get_component_price_history','check_expired_quotations'],
  },
  componentes: {
    label: 'Componentes',
    group: 'Compras',
    paths: ['/admin/componentes'],
    tools: ['list_components','find_component_by_name','create_component',
            'bulk_create_components','update_component','delete_component',
            'list_item_aliases','add_item_alias','find_similar_stock_items',
            'check_component_stock_for_production'],
  },
  falta_comprar: {
    label: 'Falta Comprar',
    group: 'Compras',
    paths: ['/admin/falta-comprar'],
    tools: ['list_purchase_needs','register_purchase_need','update_purchase_need_status',
            'add_purchase_need_note','generate_purchase_list','get_procurement_alerts',
            'component_cost_alert'],
  },
  fornecedores: {
    label: 'Fornecedores',
    group: 'Compras',
    paths: ['/admin/fornecedores'],
    tools: ['list_suppliers','find_supplier_by_email','create_supplier','update_supplier',
            'delete_supplier','get_component_suppliers','set_component_supplier',
            'remove_component_supplier','send_quote_request_whatsapp','set_component_lead_time'],
  },
  pedidos: {
    label: 'Pedidos',
    group: 'Expedição',
    paths: ['/admin/expedicao/pedidos', '/admin/expedicao/observacoes'],
    tools: ['get_private_label_orders','find_partial_shipment','create_shipment',
            'list_shipments','get_shipment_details','mark_shipment_status','update_shipment',
            'delete_shipment','add_shipment_observation','list_late_shipments',
            'find_shipments_with_observations','link_document_to_shipment','add_shipment_items',
            'duplicate_shipment','bulk_mark_shipped','list_client_brands','register_client_brand',
            'delete_client_brand','check_order_fulfillment','generate_shipment_report','search_all'],
  },
  saidas: {
    label: 'Saídas',
    group: 'Expedição',
    paths: ['/admin/expedicao/saidas'],
    tools: ['list_shipments','get_shipment_details','mark_shipment_status','search_all'],
  },
  financeira: {
    label: 'Financeira',
    group: 'Financeiro',
    paths: ['/admin/financeira'],
    tools: ['register_titulo','list_titulos','mark_titulo_status','delete_titulo',
            'list_financeiras','create_financeira','find_financeira_by_name',
            'get_financeira_summary','financial_summary','list_overdue_titles','client_history'],
  },
  producao: {
    label: 'Produção',
    group: 'Produção',
    paths: ['/admin/producao'],
    tools: ['create_production_order','list_production_orders','get_production_order_details',
            'finish_production_order','add_production_note','get_bom_stock_status',
            'check_production_feasibility','get_max_producible','deduct_components_for_production'],
  },
  estoque: {
    label: 'Estoque',
    group: 'Produção',
    paths: ['/admin/estoque'],
    tools: ['register_stock_entry','get_stock_report','adjust_stock','deduct_stock_for_shipment',
            'reserve_stock','release_stock_reservation','set_stock_minimum',
            'get_low_stock_alerts','get_stock_history','register_incoming_material',
            'list_incoming_materials'],
  },
};

export const ALL_PAGE_KEYS = Object.keys(PAGE_DEFINITIONS) as PageKey[];

// ===== Helpers =====

export function canAccessPath(allowedKeys: PageKey[], path: string): boolean {
  return allowedKeys.some((key) =>
    PAGE_DEFINITIONS[key].paths.some((p) => path === p || path.startsWith(p + '/'))
  );
}

export function getToolsForPageKeys(keys: PageKey[]): Set<string> {
  const tools = new Set<string>();
  for (const key of keys) {
    for (const t of PAGE_DEFINITIONS[key].tools) tools.add(t);
  }
  return tools;
}

// Agrupa page keys por grupo visual (para UI de permissões)
export function groupedPageKeys(): Array<{ group: string; keys: PageKey[] }> {
  const map = new Map<string, PageKey[]>();
  for (const [key, def] of Object.entries(PAGE_DEFINITIONS) as [PageKey, PageDef][]) {
    if (!map.has(def.group)) map.set(def.group, []);
    map.get(def.group)!.push(key);
  }
  return Array.from(map.entries()).map(([group, keys]) => ({ group, keys }));
}
