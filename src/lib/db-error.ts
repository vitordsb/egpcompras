// Traduz erros crus do Postgres/Supabase para mensagens amigáveis.

export function friendlyDbError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? 'Erro desconhecido');

  // Postgres error codes / patterns
  if (/duplicate key|unique.*constraint|violates unique/i.test(msg)) {
    if (/chave_acesso/i.test(msg))   return 'Essa chave de acesso (NF-e) já está cadastrada em outro pedido.';
    if (/numero_venda/i.test(msg))   return 'Já existe um pedido com esse número de venda.';
    if (/numero_nfe/i.test(msg))     return 'Já existe um pedido com esse número de NF.';
    if (/email/i.test(msg))          return 'Esse e-mail já está cadastrado.';
    if (/nome/i.test(msg))           return 'Já existe um cadastro com esse nome.';
    return 'Registro duplicado — esse dado já existe no sistema.';
  }

  if (/foreign key|violates foreign/i.test(msg)) {
    // Tentativa de DELETE bloqueada por dependências
    if (/update or delete on table/i.test(msg)) {
      if (/quotations/i.test(msg)) return 'Esse produto está em cotações antigas. Aplique a migration 0053 para permitir excluir mantendo cotações como snapshot.';
      if (/shipment/i.test(msg))   return 'Esse produto/componente está em pedidos já registrados — não dá pra excluir sem perder o histórico.';
      if (/product_kits/i.test(msg)) return 'Esse produto faz parte de um kit. Remova-o do kit antes de excluir.';
      if (/bom_items/i.test(msg))  return 'Esse componente está na BOM de algum produto. Remova das BOMs antes de excluir.';
      return 'Não foi possível excluir: o registro está vinculado a outros lugares no sistema.';
    }
    if (/financeira/i.test(msg))  return 'Financeira não encontrada. Selecione uma válida.';
    if (/product/i.test(msg))     return 'Produto não encontrado no catálogo.';
    if (/shipment/i.test(msg))    return 'Pedido não encontrado.';
    return 'Referência inválida — o registro vinculado não existe.';
  }

  if (/not.null|null value.*column/i.test(msg)) {
    if (/client_name/i.test(msg)) return 'O nome do cliente é obrigatório.';
    if (/valor/i.test(msg))       return 'O valor é obrigatório.';
    return 'Campo obrigatório não preenchido.';
  }

  if (/check.*constraint|violates check/i.test(msg)) {
    if (/status/i.test(msg))  return 'Status inválido.';
    if (/valor/i.test(msg))   return 'O valor deve ser maior que zero.';
    return 'Valor fora do permitido para esse campo.';
  }

  if (/permission denied|RLS|row.level security/i.test(msg)) {
    return 'Sem permissão para executar essa operação.';
  }

  if (/connection|timeout|ECONNRESET/i.test(msg)) {
    return 'Falha de conexão com o banco. Tente novamente.';
  }

  // Genérico — mostra a mensagem original mas limpa
  return msg.replace(/^Error:\s*/i, '');
}
