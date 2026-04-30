export type UserRole = 'admin' | 'vendas' | 'compras' | 'expedicao' | 'financeiro' | 'producao';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin:     'Administrador',
  vendas:    'Vendas',
  compras:   'Compras',
  expedicao: 'Expedição',
  financeiro:'Financeiro',
  producao:  'Produção',
};

// Emails sempre admin independente do user_profiles
export const HARDCODED_ADMINS = ['vitor@grupoegp.com.br', 'joane@grupoegp.com.br'];

// Prefixos de rota acessíveis por cargo
export const ROLE_PAGES: Record<UserRole, string[]> = {
  admin:     ['*'],
  vendas:    ['/admin/produtos', '/admin/whatsapp'],
  compras:   ['/admin/cotacoes', '/admin/custos', '/admin/componentes', '/admin/falta-comprar', '/admin/fornecedores'],
  expedicao: ['/admin/expedicao', '/admin/produtos', '/admin/whatsapp'],
  financeiro:['/admin/financeira'],
  producao:  ['/admin/producao', '/admin/estoque', '/admin/falta-comprar'],
};

export function canAccessPage(role: UserRole, path: string): boolean {
  if (role === 'admin') return true;
  return ROLE_PAGES[role].some((p) => path === p || path.startsWith(p + '/'));
}

// ===== Ferramentas por cargo =====

const VENDAS_TOOLS = new Set([
  'list_products','find_product_by_name','get_product_details','summarize_catalog',
  'send_whatsapp_message','find_whatsapp_contact','list_whatsapp_contacts','save_whatsapp_contact',
  'list_whatsapp_conversations','get_whatsapp_conversation',
  'list_shipments','get_shipment_details',
  'search_all',
]);

const COMPRAS_TOOLS = new Set([
  'list_products','find_product_by_name','get_product_details','summarize_catalog',
  'list_suppliers','find_supplier_by_email','create_supplier','update_supplier','delete_supplier',
  'list_components','find_component_by_name','create_component','bulk_create_components','update_component','delete_component',
  'get_component_suppliers','set_component_supplier','remove_component_supplier',
  'list_quotations','get_quotation_details','list_quotation_responses',
  'create_quotation','update_quotation','delete_quotation','create_quotation_from_list','analyze_quotation_responses',
  'get_component_price_history','check_expired_quotations',
  'send_quote_request_whatsapp','find_whatsapp_contact','list_whatsapp_contacts',
  'list_purchase_needs','register_purchase_need','update_purchase_need_status','add_purchase_need_note','generate_purchase_list',
  'set_component_lead_time','component_cost_alert',
  'list_item_aliases','add_item_alias','find_similar_stock_items',
  'check_component_stock_for_production','get_procurement_alerts',
  'search_all',
]);

const EXPEDICAO_TOOLS = new Set([
  'list_products','find_product_by_name','get_product_details',
  'get_private_label_orders','find_partial_shipment',
  'create_shipment','list_shipments','get_shipment_details','mark_shipment_status','update_shipment','delete_shipment',
  'add_shipment_observation','list_late_shipments','find_shipments_with_observations',
  'link_document_to_shipment','add_shipment_items','duplicate_shipment','bulk_mark_shipped',
  'list_client_brands','register_client_brand','delete_client_brand',
  'generate_shipment_report','check_order_fulfillment',
  'send_whatsapp_message','find_whatsapp_contact','list_whatsapp_contacts','save_whatsapp_contact',
  'list_whatsapp_conversations','get_whatsapp_conversation',
  'search_all',
]);

const FINANCEIRO_TOOLS = new Set([
  'register_titulo','list_titulos','mark_titulo_status','delete_titulo',
  'list_financeiras','create_financeira','find_financeira_by_name','get_financeira_summary',
  'financial_summary','list_overdue_titles','client_history',
  'search_all',
]);

const PRODUCAO_TOOLS = new Set([
  'list_products','find_product_by_name','get_product_details','summarize_catalog',
  'list_components','find_component_by_name',
  'create_production_order','list_production_orders','get_production_order_details','finish_production_order','add_production_note',
  'get_bom_stock_status','check_production_feasibility','get_max_producible','deduct_components_for_production',
  'register_stock_entry','get_stock_report','adjust_stock','deduct_stock_for_shipment',
  'reserve_stock','release_stock_reservation',
  'set_stock_minimum','get_low_stock_alerts','get_stock_history',
  'register_incoming_material','list_incoming_materials',
  'list_purchase_needs','register_purchase_need',
  'search_all',
]);

const ROLE_TOOLS: Record<UserRole, Set<string>> = {
  admin:     new Set(['*']),
  vendas:    VENDAS_TOOLS,
  compras:   COMPRAS_TOOLS,
  expedicao: EXPEDICAO_TOOLS,
  financeiro:FINANCEIRO_TOOLS,
  producao:  PRODUCAO_TOOLS,
};

export function canUseTool(role: UserRole, toolName: string): boolean {
  if (role === 'admin') return true;
  return ROLE_TOOLS[role].has(toolName);
}

export function getToolNamesForRole(role: UserRole): Set<string> | '*' {
  if (role === 'admin') return '*';
  return ROLE_TOOLS[role];
}
