// Mapeia o nome técnico de cada tool pra um rótulo legível em português.
// Usado na UI do chat pra substituir "→ create_component {...}" por
// "Cadastrando componente Foo".

type LabelFn = (args: Record<string, any>) => string;

const TOOL_LABELS: Record<string, LabelFn> = {
  // ---------- LEITURAS ----------
  list_products: () => 'Listando produtos',
  find_product_by_name: (a) => `Buscando produto "${a.name ?? '…'}"`,
  get_product_details: () => 'Lendo detalhes do produto',
  list_components: () => 'Listando componentes',
  find_component_by_name: (a) => `Buscando componente "${a.name ?? '…'}"`,
  list_suppliers: () => 'Listando fornecedores',
  find_supplier_by_email: (a) => `Buscando fornecedor (${a.email ?? '…'})`,
  list_quotations: () => 'Listando cotações',
  get_quotation_details: () => 'Lendo detalhes da cotação',
  list_quotation_responses: () => 'Lendo respostas dos fornecedores',
  summarize_catalog: () => 'Resumindo o catálogo',
  find_products_using_component: (a) =>
    a.component_name
      ? `Buscando produtos que usam "${a.component_name}"`
      : 'Buscando produtos que usam esse componente',

  // ---------- COMPONENTES ----------
  create_component: (a) => `Cadastrando componente "${a.name ?? '…'}"`,
  bulk_create_components: (a) => {
    const n = Array.isArray(a.names) ? a.names.length : 0;
    return n > 0 ? `Cadastrando ${n} componentes` : 'Cadastrando componentes';
  },
  update_component: (a) => `Atualizando componente "${a.name ?? '…'}"`,
  delete_component: () => 'Removendo componente',

  // ---------- PRODUTOS ----------
  create_product: (a) => `Criando produto "${a.name ?? '…'}"`,
  update_product: (a) => {
    if (a.pricing_mode) return `Mudando markup pra ${a.pricing_mode}`;
    if (a.name) return `Renomeando produto pra "${a.name}"`;
    return 'Atualizando produto';
  },
  delete_product: () => 'Removendo produto',
  duplicate_product: (a) => `Duplicando produto como "${a.new_name ?? '…'}"`,

  // ---------- BOM ----------
  add_bom_item: (a) => {
    const name = a.component_name ?? '…';
    const qty = a.quantity != null ? ` (${a.quantity}x)` : '';
    return `Adicionando "${name}" à BOM${qty}`;
  },
  update_bom_item: (a) => {
    if (a.component_name) return `Atualizando "${a.component_name}" na BOM`;
    return 'Atualizando item da BOM';
  },
  remove_bom_item: (a) =>
    a.component_name ? `Removendo "${a.component_name}" da BOM` : 'Removendo item da BOM',
  bulk_update_bom_targets: (a) => {
    const n = Array.isArray(a.items) ? a.items.length : 0;
    return n > 0 ? `Atualizando valor de ${n} itens da BOM` : 'Atualizando valores da BOM';
  },

  // ---------- FORNECEDORES ----------
  create_supplier: (a) => `Cadastrando fornecedor "${a.name ?? '…'}"`,
  update_supplier: () => 'Atualizando fornecedor',
  delete_supplier: () => 'Removendo fornecedor',

  // ---------- COTAÇÕES ----------
  create_quotation: (a) => {
    const t = a.title ?? 'nova cotação';
    return `Criando cotação "${t}"`;
  },
  update_quotation: () => 'Atualizando cotação',
  delete_quotation: () => 'Removendo cotação',

  // ---------- MEMÓRIAS ----------
  remember: () => 'Salvando memória persistente',
  list_memories: () => 'Lendo memórias',
  update_memory: () => 'Atualizando memória',
  forget_memory: () => 'Esquecendo memória',

  // ---------- PROCEDURES ----------
  define_procedure: (a) => `Aprendendo "${a.name ?? '…'}"`,
  list_procedures: () => 'Listando procedimentos',
  run_procedure: (a) => `Executando "${a.name ?? '…'}"`,
  update_procedure: (a) => `Atualizando "${a.name ?? '…'}"`,
  forget_procedure: (a) => `Esquecendo "${a.name ?? '…'}"`,
};

export function describeToolCall(name: string, args: Record<string, unknown> = {}): string {
  const fn = TOOL_LABELS[name];
  if (fn) {
    try {
      return fn(args as any);
    } catch {
      // Falha de tipo no args — cai no fallback
    }
  }
  return name.replace(/_/g, ' ');
}
