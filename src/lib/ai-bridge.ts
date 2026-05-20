// Bridge entre páginas manuais e a IA do chat (QuickChatDrawer).
//
// Quando uma página quer pedir algo pra IA sem o user digitar:
//   1. Página: setPendingAiMessage("Cria cotação dos 5 itens selecionados")
//   2. Página: dispara evento "open-quick-chat"
//   3. AdminLayout abre o QuickChatDrawer
//   4. BuyerAgentPage consome pendingAiMessage e dispara automaticamente
//
// Padrão usado em vez de Zustand pra evitar dependência nova (módulo +
// listener de evento serve perfeitamente pra esse caso simples).

let pendingMessage: string | null = null;
const listeners = new Set<(msg: string | null) => void>();

export function setPendingAiMessage(msg: string | null) {
  pendingMessage = msg;
  for (const fn of listeners) fn(msg);
}

export function getPendingAiMessage(): string | null {
  return pendingMessage;
}

export function onPendingAiMessage(fn: (msg: string | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Dispara abertura do QuickChatDrawer. AdminLayout escuta esse evento. */
export function openQuickChat() {
  window.dispatchEvent(new CustomEvent('open-quick-chat'));
}

/** Wrapper: seta mensagem + abre o drawer em 1 chamada. Mais ergonômico. */
export function askAi(msg: string) {
  setPendingAiMessage(msg);
  openQuickChat();
}

// ─────────────────────────────────────────────────────────────────────────
// Sugestões contextuais por rota — substituem QUICK_SUGGESTIONS fixos.
// Cada rota tem 3-5 prompts específicos pro que o user provavelmente quer
// fazer naquela tela. Adicione novos conforme aumentar a cobertura.
// ─────────────────────────────────────────────────────────────────────────

export const PAGE_SUGGESTIONS: Record<string, string[]> = {
  '/admin/expedicao/falta-comprar': [
    'O que tá faltando pros pedidos pendentes?',
    'Cria cotação dos 5 itens mais críticos',
    'Quais itens já estão pedidos mas atrasaram?',
    'Mostra os pedidos travados por falta de componente',
  ],
  '/admin/cotacoes': [
    'Quais cotações estão abertas e sem resposta?',
    'Qual o melhor preço da última cotação de bobina?',
    'Cria cotação do produto X com 100 unidades',
  ],
  '/admin/expedicao/pedidos': [
    'Quais pedidos atrasaram?',
    'Quais pedidos podem sair hoje?',
    'Resumo dos pedidos pendentes do mês',
  ],
  '/admin/expedicao/saidas': [
    'Quantos pedidos saíram essa semana?',
    'Quais clientes tiveram mais saídas no mês?',
  ],
  '/admin/financeira': [
    'Quais títulos venceram e não pagaram?',
    'Resumo financeiro do mês',
    'Histórico de pagamentos do cliente X',
  ],
  '/admin/producao': [
    'Quais ordens de produção estão abertas?',
    'Quantas unidades do Eletrificador 12V dá pra montar com o estoque?',
    'Cria ordem de produção de 50 unidades do produto X',
  ],
  '/admin/estoque': [
    'Quais itens estão abaixo do mínimo?',
    'Resumo do estoque crítico hoje',
    'Quanto tem disponível pra venda do componente X?',
  ],
  '/admin/produtos': [
    'Qual o custo do produto X?',
    'Compara o custo do 12V vs o 20V',
    'Quais produtos estão sem preço de venda definido?',
  ],
  '/admin/componentes': [
    'Quais componentes são SMD vs PTH?',
    'Onde o componente X é usado?',
    'Lista os componentes sem preço cadastrado',
  ],
  '/admin/whatsapp': [
    'Quais conversas estão sem resposta há mais de 1 hora?',
    'Manda uma mensagem pro cliente X dizendo que o pedido saiu',
  ],
  '/admin/rmas': [
    'Quais RMAs estão em conserto?',
    'Resumo dos RMAs recebidos esse mês',
  ],
  '/admin/imagens': [
    'Cria um flyer de Dia das Mães',
    'Cria uma promoção de 10% no Eletrificador 12V',
  ],
};

/**
 * Retorna sugestões da rota atual, fallback nas genéricas se não houver
 * mapping específico.
 */
export function getSuggestionsForRoute(pathname: string): string[] {
  // Match exato primeiro
  if (PAGE_SUGGESTIONS[pathname]) return PAGE_SUGGESTIONS[pathname];

  // Match por prefixo (ex: /admin/expedicao/pedidos/123 → /admin/expedicao/pedidos)
  for (const route of Object.keys(PAGE_SUGGESTIONS)) {
    if (pathname.startsWith(route + '/')) return PAGE_SUGGESTIONS[route];
  }

  // Default genérico
  return [
    'O que tá pendente hoje?',
    'Resumo do dia',
    'Quais ações precisam de atenção?',
  ];
}
