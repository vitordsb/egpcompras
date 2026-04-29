// Tools que o Gemini pode chamar pra operar a app.
// Cada tool tem:
//  - declaration (schema JSON pro modelo)
//  - implementation (função que executa no Supabase)
//
// Princípios:
//   - read tools → não mutam estado, retornam dados pro modelo "saber"
//   - write tools → mutam estado, sempre retornam o que mudou pro modelo confirmar
//   - sempre validar entrada e devolver erros claros (o modelo vai reagir a eles)

import { supabase } from '@/lib/supabase';
import { fetchUsdBrl } from '@/lib/currency';
import { buildPublicQuoteUrl } from '@/lib/utils';
import type { Type } from '@google/genai';

// ===== Schemas (declarations) =============================================

export const toolDeclarations = [
  // ---------- LEITURAS ----------
  {
    name: 'list_products',
    description:
      'Lista todos os produtos cadastrados (id, nome, custo unitário, preço de venda).',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'find_product_by_name',
    description:
      'Busca produto por nome aproximado. Retorna o melhor match com BOM completa (componentes, qtd, valor unit) + outros matches.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name: { type: 'STRING' as Type, description: 'Nome ou parte. Ex: "controle 2 botões".' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_product_details',
    description:
      'Retorna dados completos de um produto pelo id: nome, descrição, custo unitário, preço de venda, modo de markup, BOM detalhada.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { product_id: { type: 'STRING' as Type } },
      required: ['product_id'],
    },
  },
  {
    name: 'list_components',
    description: 'Lista todos os componentes do catálogo (id, nome).',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'find_component_by_name',
    description:
      'Busca componentes por nome aproximado. Retorna até 10 matches.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { name: { type: 'STRING' as Type } },
      required: ['name'],
    },
  },
  {
    name: 'list_suppliers',
    description: 'Lista fornecedores (id, nome, email, moeda padrão).',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'list_quotations',
    description:
      'Lista cotações (id, título, produto, status, n° convidados, n° respondidos, criada em). Limite default 20.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        limit: { type: 'NUMBER' as Type, description: 'Quantas no máximo (default 20).' },
        status: {
          type: 'STRING' as Type,
          description: '"draft" | "sent" | "closed" — opcional.',
        },
      },
    },
  },
  {
    name: 'summarize_catalog',
    description:
      'Visão geral do catálogo: quantidade de produtos, componentes, fornecedores, cotações ativas e nos últimos 7 dias. Útil pra responder "como tá o sistema?".',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'find_products_using_component',
    description:
      'Lista todos os produtos que usam um componente específico. Útil pra avaliar impacto antes de remover ou substituir um componente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        component_id: { type: 'STRING' as Type },
        component_name: { type: 'STRING' as Type, description: 'Alternativa ao id (fuzzy match).' },
      },
    },
  },
  {
    name: 'find_supplier_by_email',
    description: 'Busca um fornecedor pelo email exato. Mais direto que list_suppliers quando você já sabe o email.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { email: { type: 'STRING' as Type } },
      required: ['email'],
    },
  },
  {
    name: 'list_quotation_responses',
    description:
      'Lista todas as respostas que chegaram numa cotação, com identificação do fornecedor (nome empresa, vendedor, CNPJ), preço por item, totais e condição de pagamento. Útil pra comparar propostas.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { quotation_id: { type: 'STRING' as Type } },
      required: ['quotation_id'],
    },
  },
  {
    name: 'get_quotation_details',
    description:
      'Retorna detalhes completos de uma cotação: itens, convites nominais, link público.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { quotation_id: { type: 'STRING' as Type } },
      required: ['quotation_id'],
    },
  },

  // ---------- ESCRITAS — COMPONENTES ----------
  {
    name: 'create_component',
    description: 'Cria UM componente no catálogo. Pra criar vários de uma vez, prefira bulk_create_components.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { name: { type: 'STRING' as Type } },
      required: ['name'],
    },
  },
  {
    name: 'bulk_create_components',
    description:
      'Cria VÁRIOS componentes em uma única chamada (mais eficiente). Use sempre que o usuário pedir pra cadastrar mais de um.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        names: {
          type: 'ARRAY' as Type,
          items: { type: 'STRING' as Type },
          description: 'Lista de nomes de componentes a criar.',
        },
      },
      required: ['names'],
    },
  },
  {
    name: 'update_component',
    description: 'Atualiza o nome de um componente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        component_id: { type: 'STRING' as Type },
        name: { type: 'STRING' as Type },
      },
      required: ['component_id', 'name'],
    },
  },
  {
    name: 'delete_component',
    description:
      'Remove um componente. Falha se já estiver em alguma BOM (FK). Confirme com o usuário antes.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { component_id: { type: 'STRING' as Type } },
      required: ['component_id'],
    },
  },

  // ---------- ESCRITAS — PRODUTOS ----------
  {
    name: 'create_product',
    description: 'Cria um novo produto (sem BOM ainda — adicione com add_bom_item depois). Para criar produto + BOM de uma vez, prefira setup_product_bom.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name:         { type: 'STRING' as Type },
        description:  { type: 'STRING' as Type },
        product_type: { type: 'STRING' as Type, description: '"revenda" (default) ou "fabricacao".' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_product',
    description:
      'Atualiza dados de um produto. Use pricing_mode pra mudar markup (markup_30, markup_50, ponto_7, custom). Se custom, passar custom_markup_pct.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_id: { type: 'STRING' as Type },
        name: { type: 'STRING' as Type },
        description: { type: 'STRING' as Type },
        pricing_mode: {
          type: 'STRING' as Type,
          description: '"markup_30" | "markup_50" | "ponto_7" | "custom"',
        },
        custom_markup_pct: { type: 'NUMBER' as Type },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'delete_product',
    description:
      'Remove um produto e toda a BOM associada (cascade). Cotações já criadas são preservadas. Confirme antes.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { product_id: { type: 'STRING' as Type } },
      required: ['product_id'],
    },
  },

  // ---------- ESCRITAS — BOM ----------
  {
    name: 'add_bom_item',
    description:
      'Adiciona um componente à BOM de um produto. Pode usar component_id OU component_name (faz fuzzy match).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_id: { type: 'STRING' as Type },
        component_id: { type: 'STRING' as Type },
        component_name: {
          type: 'STRING' as Type,
          description: 'Alternativa a component_id. Se ambos forem fornecidos, id vence.',
        },
        quantity: {
          type: 'NUMBER' as Type,
          description: 'Quantidade que vai em CADA unidade do produto.',
        },
        value_unit: {
          type: 'NUMBER' as Type,
          description: 'Valor unitário em BRL (target/custo). Opcional.',
        },
      },
      required: ['product_id', 'quantity'],
    },
  },
  {
    name: 'update_bom_item',
    description:
      'Atualiza qty ou valor unit de uma linha da BOM. Use bom_item_id (preferido, vem de get_product_details/find_product_by_name) OU passe product_id + component_name pra fuzzy match. Se houver ambiguidade no nome, retorna a lista de candidatos.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        bom_item_id: { type: 'STRING' as Type },
        product_id: { type: 'STRING' as Type, description: 'Use junto com component_name quando não tiver bom_item_id.' },
        component_name: { type: 'STRING' as Type, description: 'Match aproximado por substring no nome do componente.' },
        quantity: { type: 'NUMBER' as Type },
        value_unit: { type: 'NUMBER' as Type },
      },
    },
  },
  {
    name: 'bulk_update_bom_targets',
    description:
      'Atualiza o valor unitário de vários componentes da BOM de um produto numa única chamada. Use quando o usuário trouxer "atualização de tabela de preços". Cada item recebe um nome aproximado (fuzzy) e o novo valor.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_id: { type: 'STRING' as Type },
        items: {
          type: 'ARRAY' as Type,
          items: {
            type: 'OBJECT' as Type,
            properties: {
              component_name: { type: 'STRING' as Type },
              value_unit: { type: 'NUMBER' as Type },
            },
            required: ['component_name', 'value_unit'],
          },
          description: 'Lista de ajustes: { component_name, value_unit }.',
        },
      },
      required: ['product_id', 'items'],
    },
  },
  {
    name: 'setup_product_bom',
    description:
      'Define ou redefine a BOM completa de um produto de uma vez. Cria o produto se não existir. Para cada componente: busca no catálogo por nome/SKU (fuzzy); se não encontrar, cria automaticamente. Use quando o usuário disser "o produto X usa os componentes A, B, C" ou "o acervo do produto X é...".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_name: { type: 'STRING' as Type, description: 'Nome do produto.' },
        replace_existing: {
          type: 'BOOLEAN' as Type,
          description: 'Se true, apaga o BOM atual antes de inserir. Default false (adiciona/atualiza).',
        },
        product_type: {
          type: 'STRING' as Type,
          description: '"fabricacao" (default quando tem BOM) ou "revenda". Defina ao criar produto novo.',
        },
        components: {
          type: 'ARRAY' as Type,
          description: 'Lista completa de componentes do produto.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              name:     { type: 'STRING' as Type, description: 'Nome do componente.' },
              sku:      { type: 'STRING' as Type, description: 'SKU/código (opcional).' },
              quantity: { type: 'NUMBER' as Type, description: 'Quantidade por unidade do produto.' },
              unit:     { type: 'STRING' as Type, description: 'Unidade (opcional, default un).' },
            },
            required: ['name', 'quantity'],
          },
        },
      },
      required: ['product_name', 'components'],
    },
  },
  {
    name: 'duplicate_product',
    description:
      'Cria um novo produto copiando a BOM e configurações de markup de um existente. Útil pra criar variações.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        source_product_id: { type: 'STRING' as Type },
        new_name: { type: 'STRING' as Type },
      },
      required: ['source_product_id', 'new_name'],
    },
  },
  {
    name: 'remove_bom_item',
    description:
      'Remove uma linha da BOM. Use bom_item_id (preferido) OU product_id + component_name (fuzzy). Se houver ambiguidade no nome, retorna candidatos pra você esclarecer com o usuário.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        bom_item_id: { type: 'STRING' as Type },
        product_id: { type: 'STRING' as Type },
        component_name: { type: 'STRING' as Type },
      },
    },
  },

  // ---------- ESCRITAS — FORNECEDORES ----------
  {
    name: 'create_supplier',
    description: 'Cadastra um fornecedor.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name: { type: 'STRING' as Type },
        email: { type: 'STRING' as Type },
        default_currency: { type: 'STRING' as Type, description: '"BRL" ou "USD". Default BRL.' },
      },
      required: ['name', 'email'],
    },
  },
  {
    name: 'update_supplier',
    description: 'Atualiza dados de um fornecedor.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        supplier_id: { type: 'STRING' as Type },
        name: { type: 'STRING' as Type },
        email: { type: 'STRING' as Type },
        default_currency: { type: 'STRING' as Type },
      },
      required: ['supplier_id'],
    },
  },
  {
    name: 'delete_supplier',
    description: 'Remove um fornecedor. Confirme com o usuário antes.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { supplier_id: { type: 'STRING' as Type } },
      required: ['supplier_id'],
    },
  },

  // ---------- MEMÓRIAS PERSISTENTES ----------
  {
    name: 'remember',
    description:
      'Grava uma memória persistente — um fato/regra que vai estar disponível em TODAS as conversas futuras (qualquer provider). Use quando o usuário disser "aprenda que X", "lembre que X", "guarde isso pra sempre". Memórias devem ser concisas, atemporais e específicas do negócio.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        content: {
          type: 'STRING' as Type,
          description:
            'Texto da memória. Ex: "Custo de montagem padrão é R$ 1,71". "Fornecedor X cobra à vista com 5% desc."',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_memories',
    description: 'Lista todas as memórias persistentes que o agente já aprendeu.',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'update_memory',
    description: 'Atualiza o conteúdo de uma memória existente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        memory_id: { type: 'STRING' as Type },
        content: { type: 'STRING' as Type },
      },
      required: ['memory_id', 'content'],
    },
  },
  {
    name: 'forget_memory',
    description: 'Remove uma memória persistente. Peça list_memories antes pra ter o id certo.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { memory_id: { type: 'STRING' as Type } },
      required: ['memory_id'],
    },
  },

  // ---------- PROCEDURES (PLAYBOOKS APRENDIDOS) ----------
  {
    name: 'define_procedure',
    description:
      'Salva um "procedimento" (playbook) que o agente pode executar depois. Use quando o usuário disser "aprenda a fazer X", "ensina pra você Y", "salve esse fluxo". Os passos são texto livre — você vai interpretá-los e executar as tools certas quando rodar.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name: {
          type: 'STRING' as Type,
          description: 'Nome curto e único do procedimento. Ex: "cotação mensal padrão".',
        },
        description: {
          type: 'STRING' as Type,
          description: 'Resumo de uma linha do que o procedimento faz.',
        },
        steps: {
          type: 'STRING' as Type,
          description:
            'Passos detalhados em texto livre. Inclua TODOS os parâmetros que serão usados (produto, qty, fornecedores, etc). Você vai ler isso depois e executar as tools normais.',
        },
      },
      required: ['name', 'steps'],
    },
  },
  {
    name: 'list_procedures',
    description: 'Lista os procedimentos aprendidos (id, nome, descrição). NÃO retorna os steps — pra obter os steps, use run_procedure.',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'run_procedure',
    description:
      'Carrega os steps detalhados de um procedimento pelo nome. Após receber os steps, EXECUTE as tools necessárias pra cumprir cada passo. Confirme com o usuário antes de fazer ações destrutivas. Você é responsável por mapear os passos descritos pras tools certas.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { name: { type: 'STRING' as Type } },
      required: ['name'],
    },
  },
  {
    name: 'update_procedure',
    description: 'Atualiza descrição e/ou steps de um procedimento existente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name: { type: 'STRING' as Type, description: 'Nome do procedimento a atualizar.' },
        new_name: { type: 'STRING' as Type, description: 'Renomear (opcional).' },
        description: { type: 'STRING' as Type },
        steps: { type: 'STRING' as Type },
      },
      required: ['name'],
    },
  },
  {
    name: 'forget_procedure',
    description: 'Remove um procedimento aprendido.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { name: { type: 'STRING' as Type } },
      required: ['name'],
    },
  },

  // ---------- SAÍDAS / PEDIDOS ----------
  {
    name: 'create_shipment',
    description:
      'Cria um pedido de saída (controle paralelo ao Conta Azul). Use quando o usuário disser "adiciona pedido X pra sair", "registra a saída de X", "cadastra pedido Y do cliente Z", ou ao importar um PDF de venda. Pode incluir produtos com qtd e todos os dados do Conta Azul.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        client_name:          { type: 'STRING' as Type, description: 'Nome do cliente.' },
        numero_nfe:           { type: 'STRING' as Type, description: 'Número da NFe (opcional).' },
        numero_venda:         { type: 'STRING' as Type, description: 'Número da venda no Conta Azul (ex: 5785).' },
        data_venda:           { type: 'STRING' as Type, description: 'Data da emissão da venda, YYYY-MM-DD.' },
        data_prevista:        { type: 'STRING' as Type, description: 'Data prevista pra sair, YYYY-MM-DD.' },
        client_cnpj:          { type: 'STRING' as Type, description: 'CNPJ ou CPF do cliente.' },
        client_phone:         { type: 'STRING' as Type, description: 'Telefone do cliente.' },
        client_email:         { type: 'STRING' as Type, description: 'E-mail do cliente.' },
        client_address:       { type: 'STRING' as Type, description: 'Endereço completo do cliente.' },
        frete_tipo:           { type: 'STRING' as Type, description: 'Ex: SEDEX, PAC, TRL FOB, Retirada.' },
        frete_valor:          { type: 'NUMBER' as Type, description: 'Valor do frete em R$.' },
        total_produtos:       { type: 'NUMBER' as Type, description: 'Subtotal dos produtos (sem frete).' },
        valor_total:          { type: 'NUMBER' as Type, description: 'Valor líquido total (produtos + frete).' },
        forma_pagamento:      { type: 'STRING' as Type, description: 'Ex: PIX, Boleto Bancário, Cartão.' },
        condicao_pagamento:   { type: 'STRING' as Type, description: 'Ex: À VISTA, 28-56-84.' },
        chave_acesso:         { type: 'STRING' as Type, description: 'Chave de acesso da NF-e (44 dígitos, SEFAZ).' },
        notes: { type: 'STRING' as Type, description: 'Observação geral (opcional).' },
        items: {
          type: 'ARRAY' as Type,
          description: 'Itens do pedido. Cada item pode ter product_name (fuzzy match), item_code, item_name, unit_price e quantity.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              product_name: { type: 'STRING' as Type, description: 'Nome pra fuzzy match no catálogo.' },
              product_id:   { type: 'STRING' as Type, description: 'UUID do produto se já conhecido.' },
              item_code:    { type: 'STRING' as Type, description: 'Código do item no Conta Azul (ex: cod17, EGPADV1).' },
              item_name:    { type: 'STRING' as Type, description: 'Descrição livre do item.' },
              unit_price:   { type: 'NUMBER' as Type, description: 'Valor unitário em R$.' },
              quantity:     { type: 'NUMBER' as Type },
            },
            required: ['quantity'],
          },
        },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'list_shipments',
    description:
      'Lista pedidos de saída. Filtros opcionais: status, client_name (fuzzy), nfe (fuzzy). Default: últimos 50.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        status: {
          type: 'STRING' as Type,
          description: 'pending | shipped | returned | cancelled',
        },
        client_name: { type: 'STRING' as Type, description: 'Match aproximado por cliente.' },
        nfe: { type: 'STRING' as Type, description: 'Match aproximado por NFe.' },
        numero_venda: { type: 'STRING' as Type, description: 'Match aproximado pelo número da venda.' },
        limit: { type: 'NUMBER' as Type },
      },
    },
  },
  {
    name: 'get_shipment_details',
    description:
      'Retorna detalhes completos de um pedido pelo id (ou nfe, ou client_name fuzzy): itens, observações, datas.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id: { type: 'STRING' as Type },
        numero_nfe: { type: 'STRING' as Type },
        numero_venda: { type: 'STRING' as Type },
        client_name: { type: 'STRING' as Type },
      },
    },
  },
  {
    name: 'mark_shipment_status',
    description:
      'Atualiza o status de um pedido. Use pra "pedido X saiu", "pedido X voltou", "pedido X cancelado". Identifica o pedido por id, nfe ou client_name (fuzzy). Também atualiza data_saida/data_retorno automaticamente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id: { type: 'STRING' as Type },
        numero_nfe: { type: 'STRING' as Type },
        numero_venda: { type: 'STRING' as Type },
        client_name: { type: 'STRING' as Type },
        new_status: {
          type: 'STRING' as Type,
          description: 'pending | shipped | returned | cancelled',
        },
      },
      required: ['new_status'],
    },
  },
  {
    name: 'update_shipment',
    description:
      'Edita campos de um pedido. Pra mudar status, prefira mark_shipment_status.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id:          { type: 'STRING' as Type },
        client_name:          { type: 'STRING' as Type },
        numero_nfe:           { type: 'STRING' as Type },
        numero_venda:         { type: 'STRING' as Type },
        data_venda:           { type: 'STRING' as Type },
        data_prevista:        { type: 'STRING' as Type },
        client_cnpj:          { type: 'STRING' as Type },
        client_phone:         { type: 'STRING' as Type },
        client_email:         { type: 'STRING' as Type },
        client_address:       { type: 'STRING' as Type },
        frete_tipo:           { type: 'STRING' as Type },
        frete_valor:          { type: 'NUMBER' as Type },
        total_produtos:       { type: 'NUMBER' as Type },
        valor_total:          { type: 'NUMBER' as Type },
        forma_pagamento:      { type: 'STRING' as Type },
        condicao_pagamento:   { type: 'STRING' as Type },
        notes:                { type: 'STRING' as Type },
      },
      required: ['shipment_id'],
    },
  },
  {
    name: 'delete_shipment',
    description: 'Remove um pedido (e suas observações + itens). Confirme com o usuário antes.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { shipment_id: { type: 'STRING' as Type } },
      required: ['shipment_id'],
    },
  },
  {
    name: 'add_shipment_observation',
    description:
      'Adiciona uma observação livre a um pedido. Use pra "anota: pedido X saiu com 5 peças do produto Y faltando", "marca falta no pedido Z". Pode identificar o pedido por id, nfe ou client_name.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id: { type: 'STRING' as Type },
        numero_nfe: { type: 'STRING' as Type },
        numero_venda: { type: 'STRING' as Type },
        client_name: { type: 'STRING' as Type },
        content: { type: 'STRING' as Type },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_late_shipments',
    description:
      'Lista pedidos pendentes que estão atrasados (data_prevista < hoje). Retorna os pedidos e, se include_items=true, também os itens de cada pedido. Use para "quais pedidos estão atrasados?", "quais itens estão nos pedidos atrasados?".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        include_items: {
          type: 'BOOLEAN' as Type,
          description: 'Se true, inclui a lista de itens de cada pedido atrasado.',
        },
      },
    },
  },
  {
    name: 'find_shipments_with_observations',
    description:
      'Lista pedidos que têm pelo menos uma observação — útil pra "quais pedidos tiveram faltas", "lista pedidos com problemas". Retorna pedido + cliente + observações.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        contains: {
          type: 'STRING' as Type,
          description: 'Filtra observações que contêm esse texto (opcional).',
        },
      },
    },
  },
  // ── Falta Comprar ────────────────────────────────────────────────────────────
  {
    name: 'register_purchase_need',
    description:
      'Registra itens que faltam para dar saída em um pedido. Use quando o usuário informar que falta X no pedido Y. Identifica o pedido por shipment_id, numero_venda ou client_name (fuzzy).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id:   { type: 'STRING' as Type },
        numero_venda:  { type: 'STRING' as Type },
        client_name:   { type: 'STRING' as Type },
        items: {
          type: 'ARRAY' as Type,
          description: 'Lista de itens faltantes.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              item_name: { type: 'STRING' as Type, description: 'Nome do item.' },
              item_code: { type: 'STRING' as Type, description: 'Código (opcional).' },
              quantity:  { type: 'NUMBER' as Type, description: 'Quantidade (opcional).' },
              unit:      { type: 'STRING' as Type, description: 'Unidade: un, m, kg, etc. (opcional).' },
            },
            required: ['item_name'],
          },
        },
        note: { type: 'STRING' as Type, description: 'Observação inicial opcional (ex: "cobrado do fornecedor X").' },
      },
      required: ['items'],
    },
  },
  {
    name: 'list_purchase_needs',
    description:
      'Lista itens que precisam ser comprados. Filtros opcionais por status e pedido. Retorna itens + últimas notas — use para responder "o que falta comprar?", "material X já foi pedido?".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        status:       { type: 'STRING' as Type, description: 'pendente | pedido | chegou | cancelado. Omitir = pendente+pedido.' },
        shipment_id:  { type: 'STRING' as Type },
        numero_venda: { type: 'STRING' as Type },
        client_name:  { type: 'STRING' as Type, description: 'Fuzzy match pelo cliente do pedido.' },
        item_name:    { type: 'STRING' as Type, description: 'Fuzzy match pelo nome do item.' },
      },
    },
  },
  {
    name: 'update_purchase_need_status',
    description:
      'Atualiza o status de um item faltante. Use para "chegou o material X", "já foi pedido o item Y".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        need_id:      { type: 'STRING' as Type, description: 'ID do item (preferido).' },
        item_name:    { type: 'STRING' as Type, description: 'Fuzzy match pelo nome.' },
        numero_venda: { type: 'STRING' as Type, description: 'Filtrar pelo pedido.' },
        client_name:  { type: 'STRING' as Type },
        new_status:   { type: 'STRING' as Type, description: 'pendente | pedido | chegou | cancelado.' },
      },
      required: ['new_status'],
    },
  },
  {
    name: 'add_purchase_need_note',
    description:
      'Adiciona uma anotação a um item faltante. Use quando o comprador quiser registrar: "cobrei o fornecedor", "prazo X", "chegou parcialmente". Essas notas são usadas pela IA para responder perguntas sobre o status.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        need_id:      { type: 'STRING' as Type, description: 'ID do item (preferido).' },
        item_name:    { type: 'STRING' as Type, description: 'Fuzzy match pelo nome.' },
        numero_venda: { type: 'STRING' as Type, description: 'Filtrar pelo pedido.' },
        client_name:  { type: 'STRING' as Type },
        content:      { type: 'STRING' as Type, description: 'Texto da nota.' },
        author:       { type: 'STRING' as Type, description: 'Quem anotou (opcional).' },
      },
      required: ['content'],
    },
  },
  // ── Estoque ──────────────────────────────────────────────────────────────────
  {
    name: 'register_stock_entry',
    description:
      'Registra entrada de itens no estoque. Use quando o usuário disser "chegou X de Y", "armazene no estoque", ou mandar uma lista de materiais recebidos. Cria o item no estoque se ainda não existir.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        items: {
          type: 'ARRAY' as Type,
          description: 'Lista de itens recebidos.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              item_code: { type: 'STRING' as Type, description: 'Código do produto (ex: EGPS1). Use o código do catálogo se souber.' },
              item_name: { type: 'STRING' as Type, description: 'Nome do item.' },
              quantity:  { type: 'NUMBER' as Type, description: 'Quantidade recebida.' },
              unit:      { type: 'STRING' as Type, description: 'Unidade: un, m, kg, etc.' },
            },
            required: ['item_name', 'quantity'],
          },
        },
        notes: { type: 'STRING' as Type, description: 'Observação (ex: "NF 1234", "fornecedor X").' },
      },
      required: ['items'],
    },
  },
  {
    name: 'get_stock_report',
    description:
      'Retorna o estoque atual. Com include_needs=true, cruza com pedidos pendentes e mostra o que falta comprar. Use para "qual o estoque?", "preciso comprar o quê?", "relatório de compras".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        include_needs:    { type: 'BOOLEAN' as Type, description: 'Se true, cruza com shipment_items dos pedidos pendentes e calcula o que falta.' },
        only_shortages:   { type: 'BOOLEAN' as Type, description: 'Se true, retorna só os itens com estoque insuficiente.' },
        item_code:        { type: 'STRING' as Type, description: 'Filtrar por código específico.' },
        item_name:        { type: 'STRING' as Type, description: 'Fuzzy match por nome.' },
      },
    },
  },
  {
    name: 'adjust_stock',
    description:
      'Corrige o saldo de um item no estoque (contagem física, perda, devolução). Use quando o usuário quiser corrigir uma quantidade manualmente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        item_code:    { type: 'STRING' as Type },
        item_name:    { type: 'STRING' as Type, description: 'Fuzzy match se não souber o código.' },
        new_quantity: { type: 'NUMBER' as Type, description: 'Novo saldo após ajuste.' },
        notes:        { type: 'STRING' as Type, description: 'Motivo do ajuste.' },
      },
      required: ['new_quantity'],
    },
  },
  {
    name: 'deduct_stock_for_shipment',
    description:
      'Desconta do estoque todos os itens de um pedido (shipment). Chame AUTOMATICAMENTE sempre que marcar um pedido como "saiu" (shipped). Identifica o pedido por shipment_id, numero_venda ou client_name.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id:  { type: 'STRING' as Type },
        numero_venda: { type: 'STRING' as Type },
        client_name:  { type: 'STRING' as Type },
      },
    },
  },
  // ── Ordens de Produção (Romaneios) ───────────────────────────────────────────
  {
    name: 'create_production_order',
    description:
      'Cria um romaneio de produção: registra que X unidades do produto Y foram enviadas para a montadora. Desconta automaticamente os componentes do BOM do estoque e marca como em poder da montadora. Aceita observações de itens faltantes.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_name:    { type: 'STRING' as Type, description: 'Nome ou parte do nome do produto.' },
        quantity:        { type: 'NUMBER' as Type, description: 'Quantidade de unidades enviadas para montagem.' },
        assembler_name:  { type: 'STRING' as Type, description: 'Nome da montadora (opcional).' },
        sent_at:         { type: 'STRING' as Type, description: 'Data de envio YYYY-MM-DD (opcional, default hoje).' },
        notes:           { type: 'STRING' as Type, description: 'Observação geral.' },
        missing_items: {
          type: 'ARRAY' as Type,
          description: 'Itens que foram com quantidade menor que o BOM prevê.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              component_name: { type: 'STRING' as Type },
              quantity_sent:  { type: 'NUMBER' as Type, description: 'Quanto foi enviado de fato.' },
              notes:          { type: 'STRING' as Type, description: 'Ex: "faltaram 50 unidades".' },
            },
            required: ['component_name'],
          },
        },
      },
      required: ['product_name', 'quantity'],
    },
  },
  {
    name: 'list_production_orders',
    description: 'Lista ordens de produção. Filtros: status (rascunho/enviado/em_montagem/concluido/cancelado).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        status: { type: 'STRING' as Type },
        limit:  { type: 'NUMBER' as Type },
      },
    },
  },
  {
    name: 'get_production_order_details',
    description: 'Retorna detalhes completos de uma ordem: componentes enviados, saldo na montadora, retornos, observações.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        order_id:     { type: 'STRING' as Type },
        product_name: { type: 'STRING' as Type, description: 'Busca pela última ordem desse produto.' },
      },
    },
  },
  {
    name: 'finish_production_order',
    description:
      'Registra a conclusão de uma ordem: quantidade de unidades montadas que voltaram, e o que aconteceu com os componentes restantes (voltaram para nós ou ficaram com a montadora). Atualiza estoque.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        order_id:          { type: 'STRING' as Type },
        product_name:      { type: 'STRING' as Type, description: 'Busca pela última ordem em andamento.' },
        quantity_returned: { type: 'NUMBER' as Type, description: 'Unidades montadas devolvidas.' },
        returned_at:       { type: 'STRING' as Type, description: 'Data de retorno YYYY-MM-DD.' },
        component_returns: {
          type: 'ARRAY' as Type,
          description: 'Componentes que voltaram para o nosso estoque (sobras). Omitir = sobras ficaram com a montadora.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              component_name:    { type: 'STRING' as Type },
              quantity_returned: { type: 'NUMBER' as Type, description: 'Quantidade que voltou para nós.' },
            },
            required: ['component_name', 'quantity_returned'],
          },
        },
        notes: { type: 'STRING' as Type },
      },
      required: ['quantity_returned'],
    },
  },
  {
    name: 'add_production_note',
    description: 'Adiciona uma observação a uma ordem de produção. Use para registrar problemas, atrasos, ajustes parciais.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        order_id:     { type: 'STRING' as Type },
        product_name: { type: 'STRING' as Type },
        content:      { type: 'STRING' as Type, description: 'Texto da observação.' },
        author:       { type: 'STRING' as Type },
      },
      required: ['content'],
    },
  },
  // ── Produção / BOM ───────────────────────────────────────────────────────────
  {
    name: 'check_production_feasibility',
    description:
      'Verifica se há componentes em estoque suficientes para produzir X unidades de um produto. Cruza BOM × estoque e mostra o que falta. Use: "consigo produzir 50 eletrificadores 12v?", "tem componentes para o pedido de 30 unidades?".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_name: { type: 'STRING' as Type, description: 'Nome ou parte do nome do produto (fuzzy).' },
        quantity:     { type: 'NUMBER' as Type, description: 'Quantidade de unidades a produzir.' },
      },
      required: ['product_name', 'quantity'],
    },
  },
  {
    name: 'get_max_producible',
    description:
      'Calcula quantas unidades de um produto é possível produzir com o estoque atual de componentes. Use: "quantos eletrificadores 12v consigo produzir agora?".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_name: { type: 'STRING' as Type, description: 'Nome ou parte do nome do produto (fuzzy).' },
      },
      required: ['product_name'],
    },
  },
  {
    name: 'deduct_components_for_production',
    description:
      'Desconta do estoque os componentes usados para produzir X unidades de um produto. Chame quando a produção for concluída. Registra movimento de saída para cada componente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_name: { type: 'STRING' as Type },
        quantity:     { type: 'NUMBER' as Type, description: 'Unidades produzidas.' },
        notes:        { type: 'STRING' as Type, description: 'Ex: "Produção lote 001".' },
      },
      required: ['product_name', 'quantity'],
    },
  },
  // ── Prazos e chegada de materiais ────────────────────────────────────────────
  {
    name: 'set_component_lead_time',
    description:
      'Define o prazo típico de entrega/produção de um componente em dias. Use: "bobina demora 15 dias", "resistor 10k tem lead time de 7 dias".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        component_name: { type: 'STRING' as Type, description: 'Nome ou parte do nome do componente.' },
        lead_time_days: { type: 'NUMBER' as Type, description: 'Dias típicos de lead time.' },
      },
      required: ['component_name', 'lead_time_days'],
    },
  },
  {
    name: 'register_incoming_material',
    description:
      'Registra que um material foi pedido e tem data prevista de chegada. Use para: "a bobina vai chegar dia 05/05", "componente X vem pela JadLog dia 10/05", "fornecedor vai entregar X no dia Y". Vincula ao item em falta se existir, ou cria registro novo.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        item_name:        { type: 'STRING' as Type, description: 'Nome do material/componente.' },
        expected_arrival: { type: 'STRING' as Type, description: 'Data de chegada YYYY-MM-DD.' },
        carrier:          { type: 'STRING' as Type, description: 'Transportadora, correios, retirada, etc.' },
        ordered_quantity: { type: 'NUMBER' as Type, description: 'Quantidade pedida.' },
        ordered_at:       { type: 'STRING' as Type, description: 'Data do pedido YYYY-MM-DD (default hoje).' },
        shipment_id:      { type: 'STRING' as Type, description: 'Pedido de venda vinculado (opcional).' },
        numero_venda:     { type: 'STRING' as Type },
        notes:            { type: 'STRING' as Type, description: 'Observação livre.' },
      },
      required: ['item_name', 'expected_arrival'],
    },
  },
  {
    name: 'list_incoming_materials',
    description:
      'Lista materiais que foram pedidos e têm data de chegada registrada. Use para "o que está chegando?", "quando chega o componente X?", "materiais a caminho".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        item_name:  { type: 'STRING' as Type, description: 'Filtrar por nome (fuzzy).' },
        due_before: { type: 'STRING' as Type, description: 'Listar só os que chegam até esta data YYYY-MM-DD.' },
      },
    },
  },
  {
    name: 'get_procurement_alerts',
    description:
      'Alerta inteligente de compras: cruza estoque atual + materiais chegando + pedidos pendentes + lead times. Identifica o que precisa ser comprado AGORA considerando o tempo que demora para chegar. Use: "o que preciso pedir hoje?", "tem algo urgente para comprar?", "alertas de reposição".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        horizon_days: { type: 'NUMBER' as Type, description: 'Janela de análise em dias (default 30). Considera pedidos com saída prevista dentro desse prazo.' },
      },
    },
  },
  {
    name: 'set_product_type',
    description:
      'Define se um produto é de "revenda" (compra e vende direto, estoque do produto em si) ou "fabricacao" (montado com componentes do BOM). Use quando o usuário disser "esse produto é de revenda" ou "esse produto é de fabricação/produção".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_name:  { type: 'STRING' as Type, description: 'Nome ou parte do nome do produto.' },
        product_type:  { type: 'STRING' as Type, description: '"revenda" ou "fabricacao".' },
      },
      required: ['product_name', 'product_type'],
    },
  },
  {
    name: 'check_order_fulfillment',
    description:
      'Verifica se é possível atender um pedido (ou todos os pedidos pendentes) com o estoque atual. Para cada item: se for revenda → verifica estoque direto; se for fabricação → cruza BOM × estoque de componentes. Retorna o que pode ser atendido e o que falta. Use para "consigo atender o pedido X?", "quais pedidos eu consigo dar saída agora?", "o que falta para atender todos os pedidos?".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id:  { type: 'STRING' as Type, description: 'ID do pedido específico (opcional).' },
        numero_venda: { type: 'STRING' as Type, description: 'Número da venda (opcional).' },
        client_name:  { type: 'STRING' as Type, description: 'Cliente (fuzzy, opcional).' },
        all_pending:  { type: 'BOOLEAN' as Type, description: 'Se true, analisa todos os pedidos pendentes.' },
      },
    },
  },
  {
    name: 'set_stock_minimum',
    description: 'Define a quantidade mínima de reposição de um item. Quando o saldo cair abaixo, o sistema marca como "baixo". Use: "mínimo de 50 sirenes EGPS1", "ponto de reposição do cabo CABOD31 é 30".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        item_code:    { type: 'STRING' as Type },
        item_name:    { type: 'STRING' as Type, description: 'Fuzzy match se não souber o código.' },
        min_quantity: { type: 'NUMBER' as Type, description: 'Quantidade mínima desejada.' },
      },
      required: ['min_quantity'],
    },
  },
  {
    name: 'get_low_stock_alerts',
    description: 'Lista itens com saldo crítico: negativos, zerados ou abaixo do mínimo configurado. Use para "o que está em falta?", "itens críticos de estoque", ou em tarefas agendadas de monitoramento.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        include_zero: { type: 'BOOLEAN' as Type, description: 'Se true, inclui itens com saldo zero (default true).' },
      },
    },
  },
  {
    name: 'get_stock_history',
    description: 'Retorna o histórico de movimentações de um item específico. Use para "histórico do EGPS1", "quando foi a última entrada de cabo?", "quanto de X entrou no último mês?".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        item_code: { type: 'STRING' as Type },
        item_name: { type: 'STRING' as Type, description: 'Fuzzy match.' },
        days:      { type: 'NUMBER' as Type, description: 'Últimos N dias (default 30).' },
      },
    },
  },
  {
    name: 'generate_purchase_list',
    description: 'Gera uma lista de compras formatada para enviar ao fornecedor (WhatsApp, e-mail). Cruza estoque atual + reservas + pedidos pendentes e calcula o que falta. Retorna texto pronto para copiar.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        include_all: { type: 'BOOLEAN' as Type, description: 'Se true, inclui todos os itens (mesmo os com estoque suficiente). Default: só os que precisam comprar.' },
        supplier:    { type: 'STRING' as Type, description: 'Filtrar por fornecedor (fuzzy match).' },
      },
    },
  },
  {
    name: 'reserve_stock',
    description: 'Reserva suave de estoque para um pedido criado mas ainda não saído. Chame ao criar um novo pedido. Reduz o saldo disponível sem baixar o saldo físico.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id:  { type: 'STRING' as Type },
        numero_venda: { type: 'STRING' as Type },
        client_name:  { type: 'STRING' as Type },
      },
    },
  },
  {
    name: 'release_stock_reservation',
    description: 'Libera a reserva de estoque de um pedido cancelado ou devolvido. Chame sempre que cancelar ou devolver um pedido.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id:  { type: 'STRING' as Type },
        numero_venda: { type: 'STRING' as Type },
        client_name:  { type: 'STRING' as Type },
      },
    },
  },
  {
    name: 'add_shipment_items',
    description:
      'Adiciona itens a um pedido existente. Suporta itens com product_name/product_id (match no catálogo) ou itens livres com item_code/item_name/unit_price. Se o item já estiver no pedido, atualiza.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id: { type: 'STRING' as Type },
        items: {
          type: 'ARRAY' as Type,
          items: {
            type: 'OBJECT' as Type,
            properties: {
              product_name: { type: 'STRING' as Type },
              product_id:   { type: 'STRING' as Type },
              item_code:    { type: 'STRING' as Type, description: 'Código no Conta Azul (ex: EGPADV1).' },
              item_name:    { type: 'STRING' as Type, description: 'Descrição livre.' },
              unit_price:   { type: 'NUMBER' as Type, description: 'Valor unitário R$.' },
              quantity:     { type: 'NUMBER' as Type },
            },
            required: ['quantity'],
          },
        },
      },
      required: ['shipment_id', 'items'],
    },
  },

  // ---------- TAREFAS AGENDADAS ----------
  {
    name: 'create_scheduled_task',
    description:
      'Cria uma tarefa agendada que o EGP executará automaticamente no horário definido. Use quando o usuário disser "todo dia às X" ou "toda segunda às Y".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name:          { type: 'STRING' as Type, description: 'Nome curto da tarefa. Ex: "Análise de cotações".' },
        instruction:   { type: 'STRING' as Type, description: 'O que a IA deve fazer/responder nesse horário.' },
        schedule_time: { type: 'STRING' as Type, description: 'Horário no formato HH:MM (horário de Brasília). Ex: "09:00".' },
        days_of_week:  {
          type: 'ARRAY' as Type,
          items: { type: 'NUMBER' as Type },
          description: 'Dias da semana: 0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sáb. Omitir = todo dia.',
        },
      },
      required: ['name', 'instruction', 'schedule_time'],
    },
  },
  {
    name: 'list_scheduled_tasks',
    description: 'Lista todas as tarefas agendadas (ativas e inativas).',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'toggle_scheduled_task',
    description: 'Ativa ou desativa uma tarefa agendada.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        task_id: { type: 'STRING' as Type },
        name:    { type: 'STRING' as Type, description: 'Identificar por nome (fuzzy) se não tiver id.' },
        enabled: { type: 'BOOLEAN' as Type, description: 'true = ativa, false = pausa.' },
      },
      required: ['enabled'],
    },
  },
  {
    name: 'delete_scheduled_task',
    description: 'Remove uma tarefa agendada permanentemente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        task_id: { type: 'STRING' as Type },
        name:    { type: 'STRING' as Type },
      },
    },
  },

  // ---------- TOOLS EXTRAS ----------
  {
    name: 'financial_summary',
    description:
      'Resumo financeiro: total em saídas no período, valor em aberto nas financeiras, títulos vencidos. Use quando pedirem visão geral financeira.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        period: { type: 'STRING' as Type, description: 'Ex: "this_week", "this_month", "last_30_days", "today". Default: this_month.' },
      },
    },
  },
  {
    name: 'client_history',
    description: 'Histórico completo de um cliente: todos os pedidos de saída, títulos em aberto e pagos, total faturado.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        client_name: { type: 'STRING' as Type, description: 'Nome ou parte do nome do cliente (fuzzy).' },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'list_overdue_titles',
    description: 'Lista títulos que já venceram e ainda estão em aberto. Use quando pedirem "títulos vencidos" ou "em atraso".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        financeira_name: { type: 'STRING' as Type, description: 'Filtrar por financeira (opcional).' },
      },
    },
  },
  {
    name: 'duplicate_shipment',
    description: 'Clona um pedido de saída existente (mesmo cliente, mesmos itens) com nova data prevista. Útil para pedidos recorrentes.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id:   { type: 'STRING' as Type },
        client_name:   { type: 'STRING' as Type, description: 'Identificar por client_name se não tiver id.' },
        data_prevista: { type: 'STRING' as Type, description: 'Data de saída do novo pedido YYYY-MM-DD.' },
      },
    },
  },
  {
    name: 'bulk_mark_shipped',
    description: 'Marca vários pedidos como "saiu" de uma vez. Recebe lista de ids, nfes ou client_names.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_ids:   { type: 'ARRAY' as Type, items: { type: 'STRING' as Type }, description: 'Lista de UUIDs.' },
        client_names:   { type: 'ARRAY' as Type, items: { type: 'STRING' as Type }, description: 'Lista de nomes (fuzzy match).' },
        numero_nfes:    { type: 'ARRAY' as Type, items: { type: 'STRING' as Type }, description: 'Lista de números de NF.' },
      },
    },
  },
  {
    name: 'search_all',
    description: 'Busca global por texto em pedidos, cotações, componentes e fornecedores de uma vez. Use quando o usuário não especificar onde buscar.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        query: { type: 'STRING' as Type, description: 'Texto a buscar.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'component_cost_alert',
    description: 'Lista componentes onde o custo atual está acima do target_price_brl definido na BOM. Use quando pedirem "componentes fora do target" ou "alertas de custo".',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'generate_shipment_report',
    description: 'Gera um relatório em texto formatado das saídas de um período. Útil para copiar/colar em e-mail ou reunião.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        period:  { type: 'STRING' as Type, description: 'Ex: "this_week", "this_month", "today".' },
        status:  { type: 'STRING' as Type, description: 'pending | shipped | all. Default: all.' },
      },
    },
  },

  // ---------- FINANCEIRA ----------
  {
    name: 'find_financeira_by_name',
    description:
      'Busca financeira por nome aproximado. Se não encontrar, instrua o usuário a cadastrar via create_financeira.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { name: { type: 'STRING' as Type } },
      required: ['name'],
    },
  },
  {
    name: 'list_financeiras',
    description: 'Lista todas as financeiras cadastradas.',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'create_financeira',
    description: 'Cadastra uma nova financeira.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        nome:    { type: 'STRING' as Type, description: 'Nome da financeira.' },
        contato: { type: 'STRING' as Type, description: 'Telefone ou email (opcional).' },
        notes:   { type: 'STRING' as Type, description: 'Observação (opcional).' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'register_titulo',
    description:
      'Registra um título (duplicata mercantil) em uma financeira. Identifica a financeira por nome (fuzzy). Pode vincular ao pedido de saída pelo client_name, numero_nfe ou numero_venda.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        financeira_name: { type: 'STRING' as Type, description: 'Nome da financeira (fuzzy match).' },
        client_name:     { type: 'STRING' as Type, description: 'Nome do cliente do título.' },
        valor:           { type: 'NUMBER' as Type, description: 'Valor do título em R$.' },
        vencimento:      { type: 'STRING' as Type, description: 'Data de vencimento YYYY-MM-DD (opcional).' },
        numero_titulo:   { type: 'STRING' as Type, description: 'Número do título/duplicata (opcional).' },
        numero_nfe:      { type: 'STRING' as Type, description: 'Número da NF (opcional).' },
        numero_venda:    { type: 'STRING' as Type, description: 'Número da venda no Conta Azul (opcional).' },
        shipment_id:     { type: 'STRING' as Type, description: 'UUID do pedido de saída (opcional).' },
        data_entrada:    { type: 'STRING' as Type, description: 'Data de entrada na financeira YYYY-MM-DD (opcional, default hoje).' },
        notes:           { type: 'STRING' as Type, description: 'Observação (opcional).' },
      },
      required: ['financeira_name', 'client_name', 'valor'],
    },
  },
  {
    name: 'list_titulos',
    description: 'Lista títulos com filtros opcionais. Default: apenas em aberto, últimos 100.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        financeira_name: { type: 'STRING' as Type, description: 'Filtrar por financeira (fuzzy).' },
        status:          { type: 'STRING' as Type, description: 'aberto | pago | devolvido | protestado. Omitir = todos.' },
        client_name:     { type: 'STRING' as Type, description: 'Filtrar por cliente (fuzzy).' },
        vencimento_ate:  { type: 'STRING' as Type, description: 'Listar títulos com vencimento até esta data YYYY-MM-DD.' },
        limit:           { type: 'NUMBER' as Type },
      },
    },
  },
  {
    name: 'mark_titulo_status',
    description: 'Altera o status de um título (pago, devolvido, protestado). Identifica por id ou numero_titulo + financeira.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        titulo_id:       { type: 'STRING' as Type },
        numero_titulo:   { type: 'STRING' as Type },
        financeira_name: { type: 'STRING' as Type },
        new_status:      { type: 'STRING' as Type, description: 'pago | devolvido | protestado | aberto' },
        data_pagamento:  { type: 'STRING' as Type, description: 'Data do pagamento YYYY-MM-DD (obrigatório se new_status=pago).' },
      },
      required: ['new_status'],
    },
  },
  {
    name: 'get_financeira_summary',
    description:
      'Retorna resumo por financeira: total em aberto, quantidade de títulos, próximos vencimentos. Útil para "quanto está em aberto na financeira X?".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        financeira_name: { type: 'STRING' as Type, description: 'Filtrar por financeira específica (omitir = todas).' },
      },
    },
  },
  {
    name: 'delete_titulo',
    description: 'Remove um título. Confirmar com o usuário antes.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { titulo_id: { type: 'STRING' as Type } },
      required: ['titulo_id'],
    },
  },

  // ---------- ESCRITAS — COTAÇÕES ----------
  {
    name: 'create_quotation',
    description:
      'Cria uma cotação a partir de um produto. Snapshotta a BOM, opcionalmente exclui componentes (fuzzy), aplica multiplicador de fabricação, e cria invites nominais pros emails que correspondam a fornecedores cadastrados. Sempre gera link público.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_id: { type: 'STRING' as Type },
        title: { type: 'STRING' as Type },
        units_to_manufacture: { type: 'NUMBER' as Type, description: 'Default 1.' },
        exclude_component_names: {
          type: 'ARRAY' as Type,
          items: { type: 'STRING' as Type },
        },
        payment_terms: { type: 'STRING' as Type },
        expires_in_hours: {
          type: 'NUMBER' as Type,
          description: 'Validade do link em horas a partir de agora. Default 2.',
        },
        deadline: {
          type: 'STRING' as Type,
          description: 'Alternativa a expires_in_hours: data/hora ISO em que o link expira.',
        },
        supplier_emails: {
          type: 'ARRAY' as Type,
          items: { type: 'STRING' as Type },
        },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'update_quotation',
    description: 'Atualiza título e/ou condição de pagamento de uma cotação.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        quotation_id: { type: 'STRING' as Type },
        title: { type: 'STRING' as Type },
        payment_terms: { type: 'STRING' as Type },
        expires_in_hours: {
          type: 'NUMBER' as Type,
          description: 'Nova validade do link em horas a partir de agora.',
        },
        deadline: {
          type: 'STRING' as Type,
          description: 'Nova data/hora ISO em que o link expira. Use null para remover expiração.',
        },
      },
      required: ['quotation_id'],
    },
  },
  {
    name: 'delete_quotation',
    description:
      'Remove uma cotação e tudo associado (itens, convites, respostas). Confirme antes.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { quotation_id: { type: 'STRING' as Type } },
      required: ['quotation_id'],
    },
  },
];

// ===== Implementations ====================================================

interface BomItemFull {
  id: string;
  component_id: string;
  quantity: number;
  target_price_brl: number | null;
  component_name: string;
}

const DEFAULT_QUOTE_EXPIRATION_HOURS = 2;

function addHoursFromNow(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('expires_in_hours precisa ser maior que 0');
  }
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function resolveQuotationDeadline(args: any): string {
  if (args.deadline) return String(args.deadline);
  if (args.expires_in_hours !== undefined) {
    return addHoursFromNow(Number(args.expires_in_hours));
  }
  return addHoursFromNow(DEFAULT_QUOTE_EXPIRATION_HOURS);
}

async function getProductWithBom(productId: string) {
  const [prodRes, bomRes] = await Promise.all([
    supabase.from('products').select('*').eq('id', productId).single(),
    supabase
      .from('bom_items')
      .select('id, component_id, quantity, target_price_brl, component:components(name)')
      .eq('product_id', productId),
  ]);
  if (prodRes.error || !prodRes.data) {
    throw new Error(`Produto não encontrado: ${prodRes.error?.message ?? 'desconhecido'}`);
  }
  const bom: BomItemFull[] = ((bomRes.data ?? []) as any[]).map((b) => ({
    id: b.id,
    component_id: b.component_id,
    quantity: Number(b.quantity),
    target_price_brl: b.target_price_brl != null ? Number(b.target_price_brl) : null,
    component_name: b.component?.name ?? '',
  }));
  return { product: prodRes.data, bom };
}

async function findComponentByName(name: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from('components')
    .select('id, name')
    .ilike('name', `%${name}%`)
    .limit(1);
  if (!data || data.length === 0) return null;
  return data[0] as { id: string; name: string };
}

async function findProductByName(name: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from('products')
    .select('id, name')
    .ilike('name', `%${name}%`)
    .limit(1);
  if (!data || data.length === 0) return null;
  return data[0] as { id: string; name: string };
}

/**
 * Resolve um shipment_id a partir dos args (id direto, venda, nfe ou client_name fuzzy).
 * Retorna string com o id quando há resolução única, ou objeto ambiguous com candidatos.
 */
async function resolveShipmentId(
  args: any
): Promise<
  | string
  | {
      ambiguous: true;
      message: string;
      candidates: {
        shipment_id: string;
        client_name: string;
        numero_nfe: string | null;
        numero_venda: string | null;
        status: string;
      }[];
    }
> {
  if (args.shipment_id) return String(args.shipment_id);

  if (!args.numero_nfe && !args.numero_venda && !args.client_name) {
    throw new Error('Forneça shipment_id OU numero_nfe OU numero_venda OU client_name');
  }

  let query = supabase
    .from('shipments')
    .select('id, client_name, numero_nfe, numero_venda, status')
    .order('created_at', { ascending: false })
    .limit(20);

  // Quando um número é fornecido, busca nos DOIS campos (numero_nfe e numero_venda) com OR.
  // Isso resolve o caso onde o usuário diz "pedido 5526" mas o número está só em numero_nfe.
  const nfeVal  = args.numero_nfe    ? String(args.numero_nfe).trim()    : null;
  const vendaVal = args.numero_venda ? String(args.numero_venda).trim()  : null;
  const numVal  = nfeVal ?? vendaVal; // valor numérico que temos

  if (numVal && !args.client_name) {
    // Busca em ambos os campos simultaneamente
    query = query.or(`numero_nfe.ilike.%${numVal}%,numero_venda.ilike.%${numVal}%`);
  } else {
    if (nfeVal)  query = query.ilike('numero_nfe',   `%${nfeVal}%`);
    if (vendaVal && !nfeVal) query = query.ilike('numero_venda', `%${vendaVal}%`);
    if (args.client_name) query = query.ilike('client_name', `%${String(args.client_name)}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const matches = (data ?? []) as any[];
  if (matches.length === 0) {
    throw new Error(
      `Nenhum pedido encontrado com${nfeVal ? ` número "${nfeVal}"` : ''}${
        vendaVal && !nfeVal ? ` venda "${vendaVal}"` : ''
      }${args.client_name ? ` cliente "${args.client_name}"` : ''}.`
    );
  }
  if (matches.length === 1) return matches[0].id as string;
  return {
    ambiguous: true,
    message: 'Mais de um pedido bate com a busca. Mostre os candidatos e pergunte qual.',
    candidates: matches.map((m) => ({
      shipment_id: m.id,
      client_name: m.client_name,
      numero_nfe: m.numero_nfe,
      numero_venda: m.numero_venda,
      status: m.status,
    })),
  };
}

/**
 * Resolve um bom_item_id a partir dos args (que podem vir como bom_item_id direto
 * OU como product_id + component_name pra fuzzy match).
 * - Retorna string com o id quando há resolução única.
 * - Retorna objeto com `ambiguous: true` + candidatos quando há mais de um match.
 */
async function resolveBomItemId(
  args: any
): Promise<string | { ambiguous: true; message: string; candidates: { bom_item_id: string; component_name: string; quantity: number }[] }> {
  if (args.bom_item_id) return String(args.bom_item_id);
  const productId = String(args.product_id ?? '');
  const componentName = String(args.component_name ?? '').trim();
  if (!productId || !componentName) {
    throw new Error('Forneça bom_item_id OU product_id + component_name');
  }
  const { data, error } = await supabase
    .from('bom_items')
    .select('id, quantity, component:components(name)')
    .eq('product_id', productId);
  if (error) throw new Error(error.message);
  const lower = componentName.toLowerCase();
  const matches = ((data ?? []) as any[]).filter((b) =>
    (b.component?.name ?? '').toLowerCase().includes(lower)
  );
  if (matches.length === 0) {
    throw new Error(`Nenhum item da BOM bate com "${componentName}". Verifique o nome.`);
  }
  if (matches.length === 1) return matches[0].id as string;
  return {
    ambiguous: true,
    message: `Mais de um item da BOM bate com "${componentName}". Mostre os candidatos ao usuário e pergunte qual.`,
    candidates: matches.map((m) => ({
      bom_item_id: m.id,
      component_name: m.component?.name ?? '—',
      quantity: Number(m.quantity),
    })),
  };
}

export async function executeTool(name: string, args: any): Promise<unknown> {
  switch (name) {
    // ---------- LEITURAS ----------
    case 'list_products': {
      const { data, error } = await supabase
        .from('products_with_cost')
        .select('id, name, unit_cost_brl, sale_price_brl, pricing_mode')
        .order('name');
      if (error) throw new Error(error.message);
      return { products: data };
    }

    case 'find_product_by_name': {
      const search = String(args.name ?? '').trim();
      if (!search) throw new Error('name é obrigatório');
      const { data, error } = await supabase
        .from('products_with_cost')
        .select('id, name, unit_cost_brl, sale_price_brl, pricing_mode')
        .ilike('name', `%${search}%`)
        .order('name');
      if (error) throw new Error(error.message);
      const products = data ?? [];
      if (products.length === 0) {
        return { found: false, message: `Nenhum produto encontrado com "${search}".` };
      }
      const best = products[0];
      const { bom } = await getProductWithBom(best.id);
      return {
        found: true,
        match_count: products.length,
        product: best,
        bom: bom.map((b) => ({
          bom_item_id: b.id,
          component_name: b.component_name,
          quantity_per_product: b.quantity,
          value_unit_brl: b.target_price_brl,
        })),
        other_matches: products.slice(1).map((p) => ({ id: p.id, name: p.name })),
      };
    }

    case 'get_product_details': {
      const productId = String(args.product_id ?? '');
      if (!productId) throw new Error('product_id é obrigatório');
      const [pRes, costRes, bomData] = await Promise.all([
        supabase.from('products').select('*').eq('id', productId).single(),
        supabase
          .from('products_with_cost')
          .select('unit_cost_brl, sale_price_brl')
          .eq('id', productId)
          .single(),
        getProductWithBom(productId),
      ]);
      if (pRes.error || !pRes.data) throw new Error(pRes.error?.message ?? 'Produto não encontrado');
      const product: any = pRes.data;
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        pricing_mode: product.pricing_mode,
        custom_markup_pct: product.custom_markup_pct,
        unit_cost_brl: costRes.data?.unit_cost_brl ?? 0,
        sale_price_brl: costRes.data?.sale_price_brl ?? null,
        bom: bomData.bom.map((b) => ({
          bom_item_id: b.id,
          component_id: b.component_id,
          component_name: b.component_name,
          quantity_per_product: b.quantity,
          value_unit_brl: b.target_price_brl,
        })),
      };
    }

    case 'list_components': {
      const { data, error } = await supabase
        .from('components')
        .select('id, name')
        .order('name');
      if (error) throw new Error(error.message);
      return { components: data };
    }

    case 'find_component_by_name': {
      const search = String(args.name ?? '').trim();
      if (!search) throw new Error('name é obrigatório');
      const { data, error } = await supabase
        .from('components')
        .select('id, name')
        .ilike('name', `%${search}%`)
        .limit(10);
      if (error) throw new Error(error.message);
      return { components: data };
    }

    case 'list_suppliers': {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name, email, default_currency')
        .order('name');
      if (error) throw new Error(error.message);
      return { suppliers: data };
    }

    case 'list_quotations': {
      const limit = Number(args.limit ?? 20);
      let q = supabase
        .from('quotations')
        .select(
          'id, title, status, deadline, created_at, product:products(name), invites:quotation_invites(id, status)'
        )
        .order('created_at', { ascending: false })
        .limit(limit);
      if (args.status) q = q.eq('status', String(args.status));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return {
        quotations: (data ?? []).map((row: any) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          deadline: row.deadline,
          expired: row.deadline ? new Date(row.deadline).getTime() < Date.now() : false,
          created_at: row.created_at,
          product_name: row.product?.name ?? null,
          invites_count: row.invites?.length ?? 0,
          responded_count: (row.invites ?? []).filter((i: any) => i.status === 'responded').length,
        })),
      };
    }

    case 'get_quotation_details': {
      const id = String(args.quotation_id ?? '');
      if (!id) throw new Error('quotation_id é obrigatório');
      const [qRes, itRes, invRes] = await Promise.all([
        supabase
          .from('quotations')
          .select(
            'id, title, status, payment_terms, deadline, public_token, created_at, usd_brl_rate, product:products(name)'
          )
          .eq('id', id)
          .single(),
        supabase
          .from('quotation_items')
          .select('id, quantity, target_price_brl, position, component:components(name)')
          .eq('quotation_id', id)
          .order('position'),
        supabase
          .from('quotation_invites')
          .select('id, token, status, supplier:suppliers(name, email)')
          .eq('quotation_id', id),
      ]);
      if (qRes.error) throw new Error(qRes.error.message);
      const q: any = qRes.data;
      return {
        id: q.id,
        title: q.title,
        status: q.status,
        payment_terms: q.payment_terms,
        deadline: q.deadline,
        expired: q.deadline ? new Date(q.deadline).getTime() < Date.now() : false,
        product_name: q.product?.name ?? null,
        created_at: q.created_at,
        public_url: buildPublicQuoteUrl(q.public_token),
        items: (itRes.data ?? []).map((it: any) => ({
          component_name: it.component?.name ?? '',
          quantity: Number(it.quantity),
          target_price_brl: it.target_price_brl != null ? Number(it.target_price_brl) : null,
        })),
        nominal_invites: (invRes.data ?? []).map((inv: any) => ({
          supplier_name: inv.supplier?.name ?? '—',
          email: inv.supplier?.email ?? '—',
          status: inv.status,
          url: buildPublicQuoteUrl(inv.token),
        })),
      };
    }

    // ---------- ESCRITAS — COMPONENTES ----------
    case 'create_component': {
      const cname = String(args.name ?? '').trim();
      if (!cname) throw new Error('name é obrigatório');
      const { data, error } = await supabase
        .from('components')
        .insert({ name: cname })
        .select('id, name')
        .single();
      if (error) throw new Error(error.message);
      return { created: data };
    }

    case 'bulk_create_components': {
      const names: string[] = Array.isArray(args.names)
        ? args.names.map((s: any) => String(s).trim()).filter(Boolean)
        : [];
      if (names.length === 0) throw new Error('names deve ter pelo menos 1 item');
      const { data, error } = await supabase
        .from('components')
        .insert(names.map((name) => ({ name })))
        .select('id, name');
      if (error) throw new Error(error.message);
      return { created_count: data?.length ?? 0, components: data };
    }

    case 'update_component': {
      const id = String(args.component_id ?? '');
      const cname = String(args.name ?? '').trim();
      if (!id || !cname) throw new Error('component_id e name são obrigatórios');
      const { error } = await supabase.from('components').update({ name: cname }).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, id, name: cname };
    }

    case 'delete_component': {
      const id = String(args.component_id ?? '');
      if (!id) throw new Error('component_id é obrigatório');
      const { error } = await supabase.from('components').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, id };
    }

    // ---------- ESCRITAS — PRODUTOS ----------
    case 'create_product': {
      const pname = String(args.name ?? '').trim();
      if (!pname) throw new Error('name é obrigatório');
      const payload: any = { name: pname };
      if (args.description) payload.description = String(args.description).trim();
      if (args.product_type) payload.product_type = String(args.product_type).trim();
      const { data, error } = await supabase
        .from('products')
        .insert(payload)
        .select('id, name')
        .single();
      if (error) throw new Error(error.message);
      return { created: data };
    }

    case 'update_product': {
      const id = String(args.product_id ?? '');
      if (!id) throw new Error('product_id é obrigatório');
      const payload: any = {};
      if (args.name) payload.name = String(args.name).trim();
      if (args.description !== undefined)
        payload.description = args.description ? String(args.description).trim() : null;
      if (args.pricing_mode) {
        const allowed = ['markup_30', 'markup_50', 'ponto_7', 'custom'];
        if (!allowed.includes(args.pricing_mode)) {
          throw new Error(`pricing_mode inválido (use ${allowed.join(', ')})`);
        }
        payload.pricing_mode = args.pricing_mode;
      }
      if (args.custom_markup_pct !== undefined) {
        payload.custom_markup_pct = args.custom_markup_pct;
      }
      if (Object.keys(payload).length === 0) throw new Error('Nada a atualizar');
      const { error } = await supabase.from('products').update(payload).eq('id', id);
      if (error) throw new Error(error.message);

      // Recalcula sale_price quando muda markup (sem chamar nada — o usuário em
      // Produtos faz isso clicando salvar; aqui replico a regra rapidamente).
      if (payload.pricing_mode !== undefined || payload.custom_markup_pct !== undefined) {
        const { data: cost } = await supabase
          .from('products_with_cost')
          .select('unit_cost_brl, pricing_mode, custom_markup_pct')
          .eq('id', id)
          .single();
        if (cost) {
          const c: any = cost;
          const cu = Number(c.unit_cost_brl);
          let sp: number | null = null;
          if (cu > 0) {
            switch (c.pricing_mode) {
              case 'markup_30': sp = cu * 1.30; break;
              case 'markup_50': sp = cu * 1.50; break;
              case 'ponto_7':   sp = cu / 0.7;  break;
              case 'custom':
                if (c.custom_markup_pct != null) sp = cu * (1 + Number(c.custom_markup_pct) / 100);
                break;
            }
          }
          await supabase
            .from('products')
            .update({ sale_price_brl: sp != null ? Number(sp.toFixed(2)) : null })
            .eq('id', id);
        }
      }

      return { updated: true, id, changes: payload };
    }

    case 'delete_product': {
      const id = String(args.product_id ?? '');
      if (!id) throw new Error('product_id é obrigatório');
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, id };
    }

    // ---------- ESCRITAS — BOM ----------
    case 'add_bom_item': {
      const productId = String(args.product_id ?? '');
      if (!productId) throw new Error('product_id é obrigatório');
      const qty = Number(args.quantity ?? 0);
      if (!(qty > 0)) throw new Error('quantity precisa ser > 0');
      let componentId = args.component_id ? String(args.component_id) : '';
      if (!componentId && args.component_name) {
        const found = await findComponentByName(String(args.component_name));
        if (!found) {
          throw new Error(`Componente "${args.component_name}" não encontrado. Crie antes com create_component.`);
        }
        componentId = found.id;
      }
      if (!componentId) throw new Error('Forneça component_id ou component_name.');

      // Verifica se já existe esse componente na BOM. Se sim, atualiza
      // qty/valor em vez de duplicar (a constraint UNIQUE em
      // (product_id, component_id) bloqueia duplicatas).
      const { data: existing, error: lookupErr } = await supabase
        .from('bom_items')
        .select('id, quantity, target_price_brl')
        .eq('product_id', productId)
        .eq('component_id', componentId)
        .maybeSingle();
      if (lookupErr) throw new Error(lookupErr.message);

      if (existing) {
        const updatePayload: any = { quantity: qty };
        if (args.value_unit !== undefined) {
          updatePayload.target_price_brl = Number(args.value_unit);
        }
        const { error: upErr } = await supabase
          .from('bom_items')
          .update(updatePayload)
          .eq('id', (existing as any).id);
        if (upErr) throw new Error(upErr.message);
        return {
          action: 'updated_existing',
          bom_item_id: (existing as any).id,
          note: `Esse componente já estava na BOM — atualizei qty pra ${qty}${
            args.value_unit !== undefined ? ` e valor pra ${args.value_unit}` : ''
          }.`,
        };
      }

      const payload: any = {
        product_id: productId,
        component_id: componentId,
        quantity: qty,
      };
      if (args.value_unit !== undefined) payload.target_price_brl = Number(args.value_unit);
      const { data, error } = await supabase
        .from('bom_items')
        .insert(payload)
        .select('id, component_id, quantity, target_price_brl')
        .single();
      if (error) throw new Error(error.message);
      return { action: 'created', bom_item: data };
    }

    case 'update_bom_item': {
      const id = await resolveBomItemId(args);
      if (typeof id !== 'string') return id; // ambiguous response
      const payload: any = {};
      if (args.quantity !== undefined) payload.quantity = Number(args.quantity);
      if (args.value_unit !== undefined) payload.target_price_brl = Number(args.value_unit);
      if (Object.keys(payload).length === 0) throw new Error('Nada a atualizar');
      const { error } = await supabase.from('bom_items').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, id, changes: payload };
    }

    case 'remove_bom_item': {
      const id = await resolveBomItemId(args);
      if (typeof id !== 'string') return id; // ambiguous response
      const { error } = await supabase.from('bom_items').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, id };
    }

    // ---------- ESCRITAS — FORNECEDORES ----------
    case 'create_supplier': {
      const sname = String(args.name ?? '').trim();
      const email = String(args.email ?? '').trim().toLowerCase();
      if (!sname) throw new Error('name é obrigatório');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('email inválido');
      const currency = args.default_currency === 'USD' ? 'USD' : 'BRL';
      const { data, error } = await supabase
        .from('suppliers')
        .insert({ name: sname, email, default_currency: currency })
        .select('id, name, email, default_currency')
        .single();
      if (error) throw new Error(error.message);
      return { created: data };
    }

    case 'update_supplier': {
      const id = String(args.supplier_id ?? '');
      if (!id) throw new Error('supplier_id é obrigatório');
      const payload: any = {};
      if (args.name) payload.name = String(args.name).trim();
      if (args.email) {
        const e = String(args.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('email inválido');
        payload.email = e;
      }
      if (args.default_currency) {
        payload.default_currency = args.default_currency === 'USD' ? 'USD' : 'BRL';
      }
      if (Object.keys(payload).length === 0) throw new Error('Nada a atualizar');
      const { error } = await supabase.from('suppliers').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, id, changes: payload };
    }

    case 'delete_supplier': {
      const id = String(args.supplier_id ?? '');
      if (!id) throw new Error('supplier_id é obrigatório');
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, id };
    }

    // ---------- ESCRITAS — COTAÇÕES ----------
    case 'create_quotation': {
      const productId = String(args.product_id ?? '');
      if (!productId) throw new Error('product_id é obrigatório');
      const units = Math.max(1, Number(args.units_to_manufacture ?? 1));
      const excludeNames: string[] = Array.isArray(args.exclude_component_names)
        ? args.exclude_component_names.map((s: any) => String(s).toLowerCase())
        : [];
      const paymentTerms = args.payment_terms ? String(args.payment_terms) : null;
      const deadline = resolveQuotationDeadline(args);
      const supplierEmails: string[] = Array.isArray(args.supplier_emails)
        ? args.supplier_emails.map((s: any) => String(s).toLowerCase().trim()).filter(Boolean)
        : [];
      const title = args.title
        ? String(args.title)
        : `Cotação ${new Date().toLocaleDateString('pt-BR')} via assistente`;

      const { product, bom } = await getProductWithBom(productId);
      const filtered = bom.filter((b) => {
        const lower = b.component_name.toLowerCase();
        return !excludeNames.some((ex) => lower.includes(ex));
      });
      if (filtered.length === 0) {
        throw new Error('Nenhum componente sobrou após exclusão. Cotação não criada.');
      }
      const excludedComponents = bom
        .filter((b) => !filtered.some((f) => f.id === b.id))
        .map((b) => b.component_name);

      let usdRate: number | null = null;
      try { const fx = await fetchUsdBrl(); usdRate = fx.rate; } catch {}

      const { data: q, error: qErr } = await supabase
        .from('quotations')
        .insert({
          product_id: productId,
          title,
          status: 'sent',
          usd_brl_rate: usdRate,
          payment_terms: paymentTerms,
          deadline,
        })
        .select('id, public_token')
        .single();
      if (qErr || !q) throw new Error(qErr?.message ?? 'Falha ao criar cotação');
      const quotationId = q.id as string;
      const publicToken = (q as any).public_token as string;

      const itemsPayload = filtered.map((b, idx) => ({
        quotation_id: quotationId,
        component_id: b.component_id,
        quantity: b.quantity * units,
        target_price_brl: b.target_price_brl,
        position: idx,
      }));
      const { error: itErr } = await supabase.from('quotation_items').insert(itemsPayload);
      if (itErr) throw new Error(`Itens: ${itErr.message}`);

      const invites: Array<{ supplier_name: string; email: string; url: string }> = [];
      const unmatchedEmails: string[] = [];
      if (supplierEmails.length > 0) {
        const { data: matched } = await supabase
          .from('suppliers')
          .select('id, name, email')
          .in('email', supplierEmails);
        const matchedSet = new Set((matched ?? []).map((s: any) => s.email.toLowerCase()));
        for (const e of supplierEmails) if (!matchedSet.has(e)) unmatchedEmails.push(e);
        if ((matched ?? []).length > 0) {
          const invitePayload = (matched ?? []).map((s: any) => ({
            quotation_id: quotationId,
            supplier_id: s.id,
            status: 'sent',
            sent_at: new Date().toISOString(),
          }));
          const { data: createdInvites, error: invErr } = await supabase
            .from('quotation_invites')
            .insert(invitePayload)
            .select('id, token, supplier:suppliers(name, email)');
          if (invErr) throw new Error(`Convites: ${invErr.message}`);
          for (const inv of (createdInvites ?? []) as any[]) {
            invites.push({
              supplier_name: inv.supplier?.name ?? '—',
              email: inv.supplier?.email ?? '—',
              url: buildPublicQuoteUrl(inv.token),
            });
          }
        }
      }

      return {
        success: true,
        quotation_id: quotationId,
        title,
        product_name: (product as any).name,
        units_to_manufacture: units,
        excluded_components: excludedComponents,
        items_count: filtered.length,
        public_url: buildPublicQuoteUrl(publicToken),
        expires_at: deadline,
        nominal_invites: invites,
        emails_not_in_supplier_list: unmatchedEmails,
      };
    }

    case 'update_quotation': {
      const id = String(args.quotation_id ?? '');
      if (!id) throw new Error('quotation_id é obrigatório');
      const payload: any = {};
      if (args.title) payload.title = String(args.title).trim();
      if (args.payment_terms !== undefined)
        payload.payment_terms = args.payment_terms ? String(args.payment_terms) : null;
      if (args.expires_in_hours !== undefined) {
        payload.deadline = addHoursFromNow(Number(args.expires_in_hours));
      } else if (args.deadline !== undefined) {
        payload.deadline = args.deadline ? String(args.deadline) : null;
      }
      if (Object.keys(payload).length === 0) throw new Error('Nada a atualizar');
      const { error } = await supabase.from('quotations').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, id, changes: payload };
    }

    case 'delete_quotation': {
      const id = String(args.quotation_id ?? '');
      if (!id) throw new Error('quotation_id é obrigatório');
      const { error } = await supabase.from('quotations').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, id };
    }

    // ---------- LEITURAS EXTRA ----------
    case 'summarize_catalog': {
      const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [prods, comps, sups, allQ, recentQ, draftQ] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('components').select('id', { count: 'exact', head: true }),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }),
        supabase.from('quotations').select('id', { count: 'exact', head: true }),
        supabase
          .from('quotations')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', sevenAgo),
        supabase
          .from('quotations')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'sent'),
      ]);
      return {
        products_count: prods.count ?? 0,
        components_count: comps.count ?? 0,
        suppliers_count: sups.count ?? 0,
        quotations_total: allQ.count ?? 0,
        quotations_last_7d: recentQ.count ?? 0,
        quotations_open: draftQ.count ?? 0,
      };
    }

    case 'find_products_using_component': {
      let componentId = args.component_id ? String(args.component_id) : '';
      if (!componentId && args.component_name) {
        const found = await findComponentByName(String(args.component_name));
        if (!found) throw new Error(`Componente "${args.component_name}" não encontrado.`);
        componentId = found.id;
      }
      if (!componentId) throw new Error('component_id ou component_name obrigatório');
      const { data, error } = await supabase
        .from('bom_items')
        .select('quantity, target_price_brl, product:products(id, name)')
        .eq('component_id', componentId);
      if (error) throw new Error(error.message);
      return {
        component_id: componentId,
        usage_count: data?.length ?? 0,
        products: (data ?? []).map((b: any) => ({
          product_id: b.product?.id,
          product_name: b.product?.name,
          quantity_per_product: Number(b.quantity),
          value_unit_brl: b.target_price_brl != null ? Number(b.target_price_brl) : null,
        })),
      };
    }

    case 'find_supplier_by_email': {
      const email = String(args.email ?? '').trim().toLowerCase();
      if (!email) throw new Error('email é obrigatório');
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name, email, default_currency')
        .eq('email', email)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { found: true, supplier: data } : { found: false };
    }

    case 'list_quotation_responses': {
      const id = String(args.quotation_id ?? '');
      if (!id) throw new Error('quotation_id é obrigatório');
      const { data: invites } = await supabase
        .from('quotation_invites')
        .select('id')
        .eq('quotation_id', id);
      const inviteIds = ((invites ?? []) as { id: string }[]).map((i) => i.id);
      if (inviteIds.length === 0) return { responses: [] };
      const { data, error } = await supabase
        .from('quotation_responses')
        .select(
          `id, currency, usd_brl_rate_used, supplier_name, supplier_cnpj, supplier_email, seller_name, payment_response, notes, submitted_at,
           items:quotation_response_items(
             unit_price, ipi_pct, st_pct,
             quotation_item:quotation_items(quantity, component:components(name))
           )`
        )
        .in('invite_id', inviteIds)
        .order('submitted_at', { ascending: false });
      if (error) throw new Error(error.message);
      return {
        responses: (data ?? []).map((r: any) => ({
          response_id: r.id,
          supplier_name: r.supplier_name,
          supplier_cnpj: r.supplier_cnpj,
          seller_name: r.seller_name,
          supplier_email: r.supplier_email,
          currency: r.currency,
          usd_brl_rate_used: r.usd_brl_rate_used,
          payment_response: r.payment_response,
          notes: r.notes,
          submitted_at: r.submitted_at,
          items: (r.items ?? []).map((it: any) => ({
            component_name: it.quotation_item?.component?.name,
            quantity: it.quotation_item?.quantity,
            unit_price: it.unit_price,
            ipi_pct: it.ipi_pct,
            st_pct: it.st_pct,
          })),
        })),
      };
    }

    case 'bulk_update_bom_targets': {
      const productId = String(args.product_id ?? '');
      if (!productId) throw new Error('product_id é obrigatório');
      const items: Array<{ component_name: string; value_unit: number }> = Array.isArray(args.items)
        ? args.items
        : [];
      if (items.length === 0) throw new Error('items é obrigatório');
      const { data: bomData, error: bomErr } = await supabase
        .from('bom_items')
        .select('id, component:components(name)')
        .eq('product_id', productId);
      if (bomErr) throw new Error(bomErr.message);
      const updated: any[] = [];
      const errors: any[] = [];
      for (const it of items) {
        const lower = String(it.component_name ?? '').toLowerCase();
        const matches = ((bomData ?? []) as any[]).filter((b) =>
          (b.component?.name ?? '').toLowerCase().includes(lower)
        );
        if (matches.length === 0) {
          errors.push({ component_name: it.component_name, error: 'não encontrado na BOM' });
          continue;
        }
        if (matches.length > 1) {
          errors.push({
            component_name: it.component_name,
            error: `match ambíguo (${matches.length} candidatos) — seja mais específico`,
          });
          continue;
        }
        const { error: upErr } = await supabase
          .from('bom_items')
          .update({ target_price_brl: Number(it.value_unit) })
          .eq('id', matches[0].id);
        if (upErr) {
          errors.push({ component_name: it.component_name, error: upErr.message });
          continue;
        }
        updated.push({
          component_name: matches[0].component?.name,
          value_unit: Number(it.value_unit),
        });
      }
      return { updated_count: updated.length, updated, errors };
    }

    // ---------- PROCEDURES ----------
    case 'define_procedure': {
      const pname = String(args.name ?? '').trim();
      const steps = String(args.steps ?? '').trim();
      if (!pname || !steps) throw new Error('name e steps são obrigatórios');
      const description = args.description ? String(args.description).trim() : null;
      // upsert por nome
      const { data: existing } = await supabase
        .from('agent_procedures')
        .select('id')
        .eq('name', pname)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from('agent_procedures')
          .update({ description, steps, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) throw new Error(error.message);
        return { updated: true, name: pname };
      }
      const { data, error } = await supabase
        .from('agent_procedures')
        .insert({ name: pname, description, steps })
        .select('id, name, description')
        .single();
      if (error) throw new Error(error.message);
      return { defined: data };
    }

    case 'list_procedures': {
      const { data, error } = await supabase
        .from('agent_procedures')
        .select('id, name, description, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return { procedures: data };
    }

    case 'run_procedure': {
      const pname = String(args.name ?? '').trim();
      if (!pname) throw new Error('name é obrigatório');
      const { data, error } = await supabase
        .from('agent_procedures')
        .select('name, description, steps')
        .ilike('name', pname)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`Procedimento "${pname}" não encontrado.`);
      return {
        name: (data as any).name,
        description: (data as any).description,
        steps: (data as any).steps,
        instruction:
          'Estes são os passos do procedimento. Execute-os agora chamando as tools necessárias na ordem certa. Confirme com o usuário antes de ações destrutivas.',
      };
    }

    case 'update_procedure': {
      const pname = String(args.name ?? '').trim();
      if (!pname) throw new Error('name é obrigatório');
      const payload: any = { updated_at: new Date().toISOString() };
      if (args.new_name) payload.name = String(args.new_name).trim();
      if (args.description !== undefined)
        payload.description = args.description ? String(args.description).trim() : null;
      if (args.steps) payload.steps = String(args.steps).trim();
      if (Object.keys(payload).length === 1) throw new Error('Nada a atualizar');
      const { error } = await supabase
        .from('agent_procedures')
        .update(payload)
        .eq('name', pname);
      if (error) throw new Error(error.message);
      return { updated: true, name: pname, changes: payload };
    }

    case 'forget_procedure': {
      const pname = String(args.name ?? '').trim();
      if (!pname) throw new Error('name é obrigatório');
      const { error } = await supabase.from('agent_procedures').delete().eq('name', pname);
      if (error) throw new Error(error.message);
      return { forgotten: true, name: pname };
    }

    // ---------- MEMÓRIAS ----------
    case 'remember': {
      const content = String(args.content ?? '').trim();
      if (!content) throw new Error('content é obrigatório');
      const { data, error } = await supabase
        .from('agent_memories')
        .insert({ content })
        .select('id, content')
        .single();
      if (error) throw new Error(error.message);
      return { remembered: data };
    }

    case 'list_memories': {
      const { data, error } = await supabase
        .from('agent_memories')
        .select('id, content, created_at, updated_at')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return { memories: data };
    }

    case 'update_memory': {
      const id = String(args.memory_id ?? '');
      const content = String(args.content ?? '').trim();
      if (!id || !content) throw new Error('memory_id e content são obrigatórios');
      const { error } = await supabase
        .from('agent_memories')
        .update({ content, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, id, content };
    }

    case 'forget_memory': {
      const id = String(args.memory_id ?? '');
      if (!id) throw new Error('memory_id é obrigatório');
      const { error } = await supabase.from('agent_memories').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { forgotten: true, id };
    }

    case 'setup_product_bom': {
      const productName = String(args.product_name ?? '').trim();
      const components = (args.components ?? []) as Array<{ name: string; sku?: string; quantity: number; unit?: string }>;
      if (!components.length) throw new Error('Informe pelo menos um componente.');

      // 1. Localiza ou cria o produto
      let productId: string;
      const { data: existingProds } = await supabase
        .from('products')
        .select('id, name')
        .ilike('name', `%${productName}%`)
        .limit(1);
      const productType = args.product_type ? String(args.product_type).trim() : 'fabricacao';
      const existing = (existingProds as any[])?.[0];
      if (existing) {
        productId = existing.id;
        // Atualiza o tipo se informado
        if (args.product_type) {
          await supabase.from('products').update({ product_type: productType }).eq('id', productId);
        }
      } else {
        const { data: created, error: createErr } = await supabase
          .from('products')
          .insert({ name: productName, product_type: productType })
          .select('id')
          .single();
        if (createErr) throw new Error(createErr.message);
        productId = created!.id;
      }

      // 2. Se replace_existing, apaga o BOM atual
      if (args.replace_existing) {
        await supabase.from('bom_items').delete().eq('product_id', productId);
      }

      // 3. Para cada componente: busca ou cria, depois upsert na BOM
      const results: any[] = [];
      for (const comp of components) {
        let componentId: string;

        // Busca por SKU exato primeiro, depois fuzzy por nome
        let compRow: any = null;
        if (comp.sku) {
          const { data } = await supabase.from('components').select('id, name').ilike('sku', comp.sku).maybeSingle();
          compRow = data;
        }
        if (!compRow) {
          const { data } = await supabase.from('components').select('id, name').ilike('name', `%${comp.name}%`).limit(1);
          compRow = (data as any[])?.[0] ?? null;
        }

        if (compRow) {
          componentId = compRow.id;
        } else {
          // Cria componente automaticamente
          const { data: newComp, error: compErr } = await supabase
            .from('components')
            .insert({
              name: comp.name.trim(),
              sku: comp.sku?.trim() ?? null,
              unit: comp.unit ?? 'un',
            })
            .select('id')
            .single();
          if (compErr) throw new Error(`Erro ao criar componente "${comp.name}": ${compErr.message}`);
          componentId = newComp!.id;
        }

        // Upsert na BOM (atualiza se já existir, insere se não)
        const { data: existingBom } = await supabase
          .from('bom_items')
          .select('id')
          .eq('product_id', productId)
          .eq('component_id', componentId)
          .maybeSingle();

        if (existingBom) {
          await supabase.from('bom_items').update({ quantity: comp.quantity }).eq('id', existingBom.id);
          results.push({ component: comp.name, action: 'atualizado', quantity: comp.quantity });
        } else {
          await supabase.from('bom_items').insert({ product_id: productId, component_id: componentId, quantity: comp.quantity });
          results.push({ component: comp.name, action: 'adicionado', quantity: comp.quantity });
        }
      }

      return {
        product: productName,
        product_id: productId,
        created_product: !existing,
        components_processed: results.length,
        bom: results,
      };
    }

    case 'duplicate_product': {
      const sourceId = String(args.source_product_id ?? '');
      const newName = String(args.new_name ?? '').trim();
      if (!sourceId || !newName) throw new Error('source_product_id e new_name obrigatórios');
      const { product, bom } = await getProductWithBom(sourceId);
      const src: any = product;
      const { data: created, error } = await supabase
        .from('products')
        .insert({
          name: newName,
          description: src.description,
          pricing_mode: src.pricing_mode,
          custom_markup_pct: src.custom_markup_pct,
        })
        .select('id, name')
        .single();
      if (error || !created) throw new Error(error?.message ?? 'Falha ao duplicar');
      const newId = created.id as string;
      if (bom.length > 0) {
        const { error: bomErr } = await supabase.from('bom_items').insert(
          bom.map((b) => ({
            product_id: newId,
            component_id: b.component_id,
            quantity: b.quantity,
            target_price_brl: b.target_price_brl,
          }))
        );
        if (bomErr) throw new Error(`BOM: ${bomErr.message}`);
      }
      return {
        created: { id: newId, name: newName, items_copied: bom.length },
      };
    }

    // ---------- SAÍDAS / PEDIDOS ----------
    case 'create_shipment': {
      const clientName = String(args.client_name ?? '').trim();
      if (!clientName) throw new Error('client_name é obrigatório');
      const payload: Record<string, unknown> = {
        client_name:         clientName,
        numero_nfe:          args.numero_nfe          ? String(args.numero_nfe).trim()        : null,
        numero_venda:        args.numero_venda        ? String(args.numero_venda).trim()      : null,
        data_venda:          args.data_venda          ? String(args.data_venda)               : null,
        data_prevista:       args.data_prevista       ? String(args.data_prevista)            : null,
        client_cnpj:         args.client_cnpj         ? String(args.client_cnpj).trim()       : null,
        client_phone:        args.client_phone        ? String(args.client_phone).trim()      : null,
        client_email:        args.client_email        ? String(args.client_email).trim()      : null,
        client_address:      args.client_address      ? String(args.client_address).trim()    : null,
        frete_tipo:          args.frete_tipo          ? String(args.frete_tipo).trim()        : null,
        frete_valor:         args.frete_valor != null  ? Number(args.frete_valor)              : null,
        total_produtos:      args.total_produtos != null ? Number(args.total_produtos)         : null,
        valor_total:         args.valor_total != null   ? Number(args.valor_total)             : null,
        forma_pagamento:     args.forma_pagamento     ? String(args.forma_pagamento).trim()   : null,
        condicao_pagamento:  args.condicao_pagamento  ? String(args.condicao_pagamento).trim(): null,
        chave_acesso:        args.chave_acesso        ? String(args.chave_acesso).replace(/\D/g,'').slice(0,44) || null : null,
        notes:               args.notes               ? String(args.notes).trim()             : null,
      };
      const { data: created, error } = await supabase
        .from('shipments')
        .insert(payload)
        .select('id, client_name, numero_venda, numero_nfe, status')
        .single();
      if (error || !created) throw new Error(error?.message ?? 'Falha ao criar pedido');
      const shipmentId = (created as any).id as string;

      const itemsInput: Array<{
        product_name?: string; product_id?: string;
        item_code?: string; item_name?: string; unit_price?: number; quantity: number;
      }> = Array.isArray(args.items) ? args.items : [];
      const itemsAdded: any[] = [];
      const itemsFailed: any[] = [];
      for (const it of itemsInput) {
        let productId = it.product_id ? String(it.product_id) : '';
        if (!productId && it.product_name) {
          const found = await findProductByName(String(it.product_name));
          if (found) productId = found.id;
        }
        const qty = Number(it.quantity);
        if (!(qty > 0)) {
          itemsFailed.push({ item_name: it.item_name ?? it.product_name, error: 'quantity inválido' });
          continue;
        }
        const itemPayload: Record<string, unknown> = {
          shipment_id: shipmentId,
          product_id:  productId || null,
          item_code:   it.item_code  ? String(it.item_code).trim()  : null,
          item_name:   it.item_name  ? String(it.item_name).trim()  : null,
          unit_price:  it.unit_price != null ? Number(it.unit_price) : null,
          quantity:    qty,
        };
        const { error: insErr } = await supabase.from('shipment_items').insert(itemPayload);
        if (insErr) {
          itemsFailed.push({ item_name: it.item_name ?? it.product_name, error: insErr.message });
        } else {
          itemsAdded.push({ product_id: productId || null, item_code: it.item_code, item_name: it.item_name ?? it.product_name, quantity: qty });
        }
      }
      return { created, items_added: itemsAdded, items_failed: itemsFailed };
    }

    case 'list_shipments': {
      const limit = Number(args.limit ?? 50);
      let q = supabase
        .from('shipments')
        .select(
          `id, client_name, numero_nfe, numero_venda, data_venda, status, data_prevista, data_saida, data_retorno,
           valor_total, forma_pagamento, condicao_pagamento, created_at`
        )
        .order('created_at', { ascending: false })
        .limit(limit);
      if (args.status) q = q.eq('status', String(args.status));
      if (args.client_name) q = q.ilike('client_name', `%${String(args.client_name)}%`);
      if (args.nfe) q = q.ilike('numero_nfe', `%${String(args.nfe)}%`);
      if (args.numero_venda) q = q.ilike('numero_venda', `%${String(args.numero_venda)}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { shipments: data ?? [] };
    }

    case 'get_shipment_details': {
      const resolved = await resolveShipmentId(args);
      if (typeof resolved !== 'string') return resolved;
      const id = resolved;
      const [shipRes, itemsRes, obsRes] = await Promise.all([
        supabase.from('shipments').select('*').eq('id', id).single(),
        supabase
          .from('shipment_items')
          .select('id, quantity, item_code, item_name, unit_price, product:products(id, name)')
          .eq('shipment_id', id),
        supabase
          .from('shipment_observations')
          .select('id, content, created_at')
          .eq('shipment_id', id)
          .order('created_at', { ascending: false }),
      ]);
      if (shipRes.error) throw new Error(shipRes.error.message);
      const ship: any = shipRes.data;
      return {
        shipment: ship,
        items: (itemsRes.data ?? []).map((it: any) => ({
          item_id: it.id,
          product_id: it.product?.id,
          product_name: it.product?.name,
          item_code: it.item_code,
          item_name: it.item_name,
          unit_price: it.unit_price != null ? Number(it.unit_price) : null,
          quantity: Number(it.quantity),
        })),
        observations: obsRes.data ?? [],
      };
    }

    case 'mark_shipment_status': {
      const newStatus = String(args.new_status ?? '');
      const allowed = ['pending', 'shipped', 'returned', 'cancelled'];
      if (!allowed.includes(newStatus)) {
        throw new Error(`new_status inválido (use ${allowed.join(', ')})`);
      }
      const resolved = await resolveShipmentId(args);
      if (typeof resolved !== 'string') return resolved;
      const id = resolved;

      // Verifica se o pedido já está no status pedido — avisa quem marcou antes
      const { data: current } = await supabase
        .from('shipments')
        .select('status, updated_by, updated_at, client_name, numero_nfe, numero_venda')
        .eq('id', id)
        .single();

      if (current && current.status === newStatus) {
        const who = current.updated_by ? `por ${current.updated_by}` : '';
        const when = current.updated_at
          ? `em ${new Date(current.updated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
          : '';
        const statusLabel: Record<string, string> = { shipped: 'saiu', returned: 'voltou', cancelled: 'cancelado', pending: 'pendente' };
        return {
          already_done: true,
          message: `O pedido de ${current.client_name} (${current.numero_nfe ?? current.numero_venda ?? id.slice(0, 8)}) já foi marcado como "${statusLabel[newStatus] ?? newStatus}" ${who} ${when}.`.trim(),
        };
      }

      const payload: any = {
        status: newStatus,
        updated_at: new Date().toISOString(),
        updated_by: args.author ?? null,
      };
      if (newStatus === 'shipped') payload.data_saida = new Date().toISOString();
      if (newStatus === 'returned') payload.data_retorno = new Date().toISOString();
      const { error } = await supabase.from('shipments').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, shipment_id: id, new_status: newStatus };
    }

    case 'update_shipment': {
      const id = String(args.shipment_id ?? '');
      if (!id) throw new Error('shipment_id é obrigatório');
      const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const str = (v: unknown) => (v ? String(v).trim() : null);
      if (args.client_name       !== undefined) payload.client_name        = str(args.client_name);
      if (args.numero_nfe        !== undefined) payload.numero_nfe         = str(args.numero_nfe);
      if (args.numero_venda      !== undefined) payload.numero_venda       = str(args.numero_venda);
      if (args.data_venda        !== undefined) payload.data_venda         = str(args.data_venda);
      if (args.data_prevista     !== undefined) payload.data_prevista      = str(args.data_prevista);
      if (args.client_cnpj       !== undefined) payload.client_cnpj        = str(args.client_cnpj);
      if (args.client_phone      !== undefined) payload.client_phone       = str(args.client_phone);
      if (args.client_email      !== undefined) payload.client_email       = str(args.client_email);
      if (args.client_address    !== undefined) payload.client_address     = str(args.client_address);
      if (args.frete_tipo        !== undefined) payload.frete_tipo         = str(args.frete_tipo);
      if (args.frete_valor       !== undefined) payload.frete_valor        = args.frete_valor != null ? Number(args.frete_valor) : null;
      if (args.total_produtos    !== undefined) payload.total_produtos     = args.total_produtos != null ? Number(args.total_produtos) : null;
      if (args.valor_total       !== undefined) payload.valor_total        = args.valor_total != null ? Number(args.valor_total) : null;
      if (args.forma_pagamento   !== undefined) payload.forma_pagamento    = str(args.forma_pagamento);
      if (args.condicao_pagamento !== undefined) payload.condicao_pagamento = str(args.condicao_pagamento);
      if (args.notes             !== undefined) payload.notes              = str(args.notes);
      if (Object.keys(payload).length === 1) throw new Error('Nada a atualizar');
      const { error } = await supabase.from('shipments').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, shipment_id: id, changes: payload };
    }

    case 'delete_shipment': {
      const id = String(args.shipment_id ?? '');
      if (!id) throw new Error('shipment_id é obrigatório');
      const { error } = await supabase.from('shipments').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, shipment_id: id };
    }

    case 'add_shipment_observation': {
      const content = String(args.content ?? '').trim();
      if (!content) throw new Error('content é obrigatório');
      const resolved = await resolveShipmentId(args);
      if (typeof resolved !== 'string') return resolved;
      const id = resolved;
      const { data, error } = await supabase
        .from('shipment_observations')
        .insert({ shipment_id: id, content })
        .select('id, content, created_at')
        .single();
      if (error) throw new Error(error.message);
      // Atualiza updated_at do shipment pra refletir atividade recente
      await supabase
        .from('shipments')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id);
      return { observation: data, shipment_id: id };
    }

    case 'list_late_shipments': {
      const today = new Date().toISOString().slice(0, 10);
      const { data: lateShips, error: lateErr } = await supabase
        .from('shipments')
        .select('id, client_name, numero_nfe, numero_venda, data_prevista, valor_total, status')
        .eq('status', 'pending')
        .lt('data_prevista', today)
        .not('data_prevista', 'is', null)
        .order('data_prevista', { ascending: true });
      if (lateErr) throw new Error(lateErr.message);
      const ships = (lateShips ?? []) as any[];
      if (!args.include_items || ships.length === 0) {
        return { late_count: ships.length, shipments: ships };
      }
      // Carrega itens de todos os pedidos atrasados em paralelo
      const withItems = await Promise.all(
        ships.map(async (s: any) => {
          const { data: items } = await supabase
            .from('shipment_items')
            .select('item_code, item_name, quantity, unit_price, product:products(name)')
            .eq('shipment_id', s.id);
          return {
            ...s,
            items: (items ?? []).map((it: any) => ({
              item_code: it.item_code,
              item_name: it.item_name ?? it.product?.name,
              quantity: Number(it.quantity),
              unit_price: it.unit_price != null ? Number(it.unit_price) : null,
            })),
          };
        })
      );
      return { late_count: ships.length, shipments: withItems };
    }

    case 'find_shipments_with_observations': {
      const contains = args.contains ? String(args.contains).trim() : null;
      let obsQuery = supabase
        .from('shipment_observations')
        .select('id, content, created_at, shipment:shipments(id, client_name, numero_nfe, status)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (contains) obsQuery = obsQuery.ilike('content', `%${contains}%`);
      const { data, error } = await obsQuery;
      if (error) throw new Error(error.message);
      // Agrupa por shipment
      const map = new Map<
        string,
        { shipment_id: string; client_name: string; numero_nfe: string | null; status: string; observations: any[] }
      >();
      for (const row of (data ?? []) as any[]) {
        const ship = row.shipment;
        if (!ship) continue;
        if (!map.has(ship.id)) {
          map.set(ship.id, {
            shipment_id: ship.id,
            client_name: ship.client_name,
            numero_nfe: ship.numero_nfe,
            status: ship.status,
            observations: [],
          });
        }
        map.get(ship.id)!.observations.push({
          id: row.id,
          content: row.content,
          created_at: row.created_at,
        });
      }
      return { shipments: Array.from(map.values()) };
    }

    // ── Falta Comprar ────────────────────────────────────────────────────────
    case 'register_purchase_need': {
      const shipId = await resolveShipmentId(args);
      const resolvedId = typeof shipId === 'string' ? shipId : null;
      const items = (args.items ?? []) as Array<{ item_name: string; item_code?: string; quantity?: number; unit?: string }>;
      if (!items.length) throw new Error('Informe pelo menos um item.');
      const inserted: any[] = [];
      for (const it of items) {
        const payload: Record<string, unknown> = {
          item_name:   it.item_name.trim(),
          item_code:   it.item_code?.trim() ?? null,
          quantity:    it.quantity ?? null,
          unit:        it.unit?.trim() ?? null,
          shipment_id: resolvedId,
        };
        const { data, error } = await supabase.from('purchase_needs').insert(payload).select('id, item_name').single();
        if (error) throw new Error(error.message);
        inserted.push(data);
        if (args.note && data?.id) {
          await supabase.from('purchase_need_notes').insert({
            need_id: data.id,
            content: String(args.note).trim(),
            author:  null,
          });
        }
      }
      return { registered: inserted.length, items: inserted };
    }

    case 'list_purchase_needs': {
      // Resolve shipment_id opcional
      let shipId: string | null = null;
      if (args.shipment_id || args.numero_venda || args.client_name) {
        const r = await resolveShipmentId(args);
        if (typeof r === 'string') shipId = r;
      }
      const statusFilter = args.status ? String(args.status) : null;
      let q = supabase
        .from('purchase_needs')
        .select(`id, item_name, item_code, quantity, unit, status, updated_at,
                 expected_arrival, carrier, ordered_at, ordered_quantity,
                 shipment:shipments(id, client_name, numero_venda, numero_nfe),
                 notes:purchase_need_notes(id, content, author, created_at)`)
        .order('updated_at', { ascending: false })
        .limit(100);
      if (shipId) q = q.eq('shipment_id', shipId);
      if (args.item_name) q = q.ilike('item_name', `%${String(args.item_name)}%`);
      if (statusFilter) {
        q = q.eq('status', statusFilter);
      } else {
        q = q.in('status', ['pendente', 'pedido']);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: (data ?? []).length, needs: data ?? [] };
    }

    case 'update_purchase_need_status': {
      const newStatus = String(args.new_status ?? '').trim();
      if (!newStatus) throw new Error('new_status é obrigatório.');
      let needId = args.need_id ? String(args.need_id) : null;
      if (!needId) {
        // Resolve por item_name + pedido
        let q = supabase.from('purchase_needs').select('id').limit(1);
        if (args.item_name) q = q.ilike('item_name', `%${String(args.item_name)}%`);
        if (args.shipment_id) q = q.eq('shipment_id', String(args.shipment_id));
        else if (args.numero_venda || args.client_name) {
          const r = await resolveShipmentId(args);
          if (typeof r === 'string') q = q.eq('shipment_id', r);
        }
        const { data } = await q;
        needId = (data?.[0] as any)?.id ?? null;
      }
      if (!needId) {
        // Item não existe ainda — cria direto com o status informado
        // (caso comum: usuário diz "já temos X" sem ter registrado antes)
        const itemName = args.item_name ? String(args.item_name).trim() : null;
        if (!itemName) return { updated: false, message: 'Item não encontrado e item_name não informado para criar.' };
        let shipId: string | null = null;
        if (args.shipment_id) shipId = String(args.shipment_id);
        else if (args.numero_venda || args.client_name) {
          const r = await resolveShipmentId(args);
          if (typeof r === 'string') shipId = r;
        }
        const { data: created, error: createErr } = await supabase
          .from('purchase_needs')
          .insert({ item_name: itemName, shipment_id: shipId, status: newStatus })
          .select('id').single();
        if (createErr) throw new Error(createErr.message);
        return { updated: true, created: true, need_id: created?.id, new_status: newStatus };
      }
      const { error } = await supabase
        .from('purchase_needs')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', needId);
      if (error) throw new Error(error.message);
      return { updated: true, need_id: needId, new_status: newStatus };
    }

    case 'add_purchase_need_note': {
      let needId = args.need_id ? String(args.need_id) : null;
      if (!needId) {
        let q = supabase.from('purchase_needs').select('id').limit(1);
        if (args.item_name) q = q.ilike('item_name', `%${String(args.item_name)}%`);
        if (args.shipment_id) q = q.eq('shipment_id', String(args.shipment_id));
        else if (args.numero_venda || args.client_name) {
          const r = await resolveShipmentId(args);
          if (typeof r === 'string') q = q.eq('shipment_id', r);
        }
        const { data } = await q;
        needId = (data?.[0] as any)?.id ?? null;
      }
      if (!needId) return { added: false, message: 'Item não encontrado.' };
      const { data, error } = await supabase
        .from('purchase_need_notes')
        .insert({ need_id: needId, content: String(args.content).trim(), author: args.author ? String(args.author) : null })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { added: true, note_id: data?.id };
    }

    // ── Estoque ──────────────────────────────────────────────────────────────
    case 'register_stock_entry': {
      const items = (args.items ?? []) as Array<{
        item_code?: string; item_name: string; quantity: number; unit?: string;
      }>;
      if (!items.length) throw new Error('Informe pelo menos um item.');
      const notes = args.notes ? String(args.notes) : null;
      const createdBy = args.author ? String(args.author) : null;
      const results: any[] = [];

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      for (const it of items) {
        const code = (it.item_code ?? it.item_name).trim().toUpperCase().replace(/\s+/g, '_');
        const qty = Number(it.quantity);
        const unit = it.unit ?? 'un';

        // Verifica se houve entrada semelhante nas últimas 2h pelo mesmo usuário (possível duplicata)
        let recentQuery = supabase
          .from('stock_movements')
          .select('quantity, created_at, created_by')
          .ilike('item_code', code)
          .eq('type', 'entrada')
          .gte('created_at', twoHoursAgo)
          .order('created_at', { ascending: false })
          .limit(5);
        const { data: recentMovements } = await recentQuery;

        // Dedup cross-user: qualquer usuário que registrou qtd similar nas últimas 2h
        const recentSimilar = (recentMovements ?? []).find((m: any) => {
          const similarQty = Math.abs(Number(m.quantity) - qty) / qty < 0.1;
          return similarQty;
        });

        // Tenta achar componente pelo SKU para linkar
        const { data: compMatch } = await supabase
          .from('components')
          .select('id, sku')
          .ilike('sku', code)
          .maybeSingle();
        const componentId = compMatch?.id ?? null;

        // Upsert no stock_items — cria ou soma ao saldo
        const { data: existing } = await supabase
          .from('stock_items')
          .select('id, quantity')
          .ilike('item_code', code)
          .maybeSingle();

        const previousQty = existing ? Number(existing.quantity) : 0;
        let itemId: string;
        if (existing) {
          const newQty = previousQty + qty;
          await supabase.from('stock_items')
            .update({ quantity: newQty, item_name: it.item_name, unit,
                      component_id: componentId ?? undefined,
                      updated_at: new Date().toISOString() })
            .eq('id', existing.id);
          itemId = existing.id;
        } else {
          const { data: created } = await supabase.from('stock_items')
            .insert({ item_code: code, item_name: it.item_name, quantity: qty, unit, component_id: componentId })
            .select('id').single();
          itemId = created?.id;
        }

        // Registra movimento com autor
        await supabase.from('stock_movements').insert({
          stock_item_id: itemId,
          item_code: code,
          item_name: it.item_name,
          quantity: qty,
          type: 'entrada',
          notes,
          created_by: createdBy,
        });

        results.push({
          item_code: code,
          item_name: it.item_name,
          quantity_added: qty,
          previous_balance: previousQty,
          new_balance: previousQty + qty,
          // Alerta de possível duplicata para a IA informar o usuário
          possible_duplicate: recentSimilar
            ? `Atenção: ${recentSimilar.created_by && recentSimilar.created_by !== createdBy ? `${recentSimilar.created_by} já registrou` : 'já foi registrada'} uma entrada de ${recentSimilar.quantity} unidades desse item às ${new Date(recentSimilar.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Confirma que é uma segunda entrada real?`
            : null,
        });
      }

      return { registered: results.length, items: results };
    }

    case 'get_stock_report': {
      let q = supabase.from('stock_items')
        .select('id, item_code, item_name, quantity, unit, min_quantity')
        .order('item_name');
      if (args.item_code) q = q.ilike('item_code', `%${String(args.item_code)}%`);
      if (args.item_name) q = q.ilike('item_name', `%${String(args.item_name)}%`);
      const { data: stock, error } = await q;
      if (error) throw new Error(error.message);

      if (!args.include_needs) {
        return { stock: stock ?? [] };
      }

      // Cruza com itens dos pedidos pendentes (status = pending)
      const { data: pendingItems } = await supabase
        .from('shipment_items')
        .select('item_code, item_name, quantity, shipment:shipments!inner(id, client_name, numero_venda, status)')
        .eq('shipments.status', 'pending');

      // Agrupa necessidade por item_code
      const needs: Record<string, { item_name: string; needed: number; shipments: string[] }> = {};
      for (const it of (pendingItems ?? []) as any[]) {
        const code = (it.item_code ?? it.item_name ?? '').toUpperCase();
        if (!needs[code]) needs[code] = { item_name: it.item_name ?? it.item_code, needed: 0, shipments: [] };
        needs[code].needed += Number(it.quantity ?? 1);
        const label = it.shipment?.numero_venda ? `#${it.shipment.numero_venda}` : it.shipment?.client_name ?? '?';
        if (!needs[code].shipments.includes(label)) needs[code].shipments.push(label);
      }

      const stockMap: Record<string, number> = {};
      for (const s of (stock ?? []) as any[]) stockMap[s.item_code] = Number(s.quantity);

      const report = Object.entries(needs).map(([code, n]) => {
        const available = stockMap[code] ?? 0;
        const to_buy = Math.max(0, n.needed - available);
        return { item_code: code, item_name: n.item_name, needed: n.needed, available, to_buy, shipments: n.shipments };
      }).sort((a, b) => b.to_buy - a.to_buy);

      const filtered = args.only_shortages ? report.filter((r) => r.to_buy > 0) : report;
      return { report: filtered, items_to_buy: filtered.filter((r) => r.to_buy > 0).length };
    }

    case 'adjust_stock': {
      const newQty = Number(args.new_quantity);
      let item: any = null;
      if (args.item_code) {
        const { data } = await supabase.from('stock_items').select('*').ilike('item_code', String(args.item_code)).maybeSingle();
        item = data;
      } else if (args.item_name) {
        const { data } = await supabase.from('stock_items').select('*').ilike('item_name', `%${String(args.item_name)}%`).limit(1);
        item = (data as any)?.[0];
      }
      if (!item) throw new Error('Item não encontrado no estoque.');
      const diff = newQty - Number(item.quantity);
      await supabase.from('stock_items').update({ quantity: newQty, updated_at: new Date().toISOString() }).eq('id', item.id);
      await supabase.from('stock_movements').insert({
        stock_item_id: item.id, item_code: item.item_code, item_name: item.item_name,
        quantity: diff, type: 'ajuste', notes: args.notes ? String(args.notes) : null,
        created_by: args.author ?? null,
      });
      return { adjusted: true, item_code: item.item_code, old_quantity: item.quantity, new_quantity: newQty };
    }

    case 'deduct_stock_for_shipment': {
      const resolved = await resolveShipmentId(args);
      if (typeof resolved !== 'string') return resolved;
      const shipmentId = resolved;

      const { data: items } = await supabase
        .from('shipment_items')
        .select('item_code, item_name, quantity')
        .eq('shipment_id', shipmentId);

      // Sem itens cadastrados: ok, pedido saiu mesmo assim
      if (!items?.length) return { deducted: 0, ok: true };

      let deducted = 0;
      for (const it of items as any[]) {
        const code = (it.item_code ?? it.item_name ?? '').toUpperCase();
        const qty = Number(it.quantity ?? 1);
        const { data: stockItem } = await supabase
          .from('stock_items')
          .select('id, quantity, reserved_quantity')
          .ilike('item_code', code)
          .maybeSingle();

        if (stockItem) {
          const newQty = Number(stockItem.quantity) - qty;
          const newReserved = Math.max(0, Number(stockItem.reserved_quantity) - qty);
          await supabase.from('stock_items')
            .update({ quantity: newQty, reserved_quantity: newReserved, updated_at: new Date().toISOString() })
            .eq('id', stockItem.id);
          await supabase.from('stock_movements').insert({
            stock_item_id: stockItem.id, item_code: code, item_name: it.item_name,
            quantity: -qty, type: 'saida', shipment_id: shipmentId,
            created_by: args.author ?? null,
          });
          deducted++;
        }
        // Item não encontrado no estoque: ignora silenciosamente.
        // O pedido saiu — o desencontro de cadastro não deve bloquear nem aparecer pro usuário.
      }
      return { ok: true, deducted };
    }

    // ── Ordens de Produção ────────────────────────────────────────────────────
    case 'create_production_order': {
      const productName = String(args.product_name ?? '').trim();
      const qty = Number(args.quantity);
      const sentAt = args.sent_at ? String(args.sent_at) : new Date().toISOString().slice(0, 10);

      // Localiza produto
      const { data: prods } = await supabase.from('products').select('id, name').ilike('name', `%${productName}%`).limit(1);
      const product = (prods as any[])?.[0];
      if (!product) throw new Error(`Produto "${productName}" não encontrado.`);

      // Busca BOM
      const { data: bom } = await supabase
        .from('bom_items')
        .select('quantity, component:components(id, name, sku, unit)')
        .eq('product_id', product.id);
      if (!bom?.length) throw new Error(`${product.name} não tem BOM cadastrado.`);

      // Cria a ordem
      const { data: order, error: orderErr } = await supabase
        .from('production_orders')
        .insert({
          product_id: product.id, product_name: product.name,
          quantity_ordered: qty, status: 'enviado',
          assembler_name: args.assembler_name ? String(args.assembler_name) : null,
          sent_at: sentAt,
          notes: args.notes ? String(args.notes) : null,
        })
        .select('id').single();
      if (orderErr) throw new Error(orderErr.message);
      const orderId = order!.id;

      // Monta overrides de itens faltantes
      const missingMap: Record<string, { qty_sent: number; notes: string }> = {};
      for (const m of (args.missing_items ?? []) as any[]) {
        missingMap[m.component_name.toLowerCase()] = { qty_sent: Number(m.quantity_sent ?? 0), notes: m.notes ?? '' };
      }

      // Processa cada componente do BOM
      const components: any[] = [];
      for (const item of bom as any[]) {
        const comp = item.component;
        const qtyPerUnit = Number(item.quantity);
        const totalNeeded = qtyPerUnit * qty;
        const override = missingMap[comp.name.toLowerCase()];
        const qtySent = override ? override.qty_sent : totalNeeded;
        const itemNotes = override ? override.notes : null;
        const qtyAtAssembler = qtySent; // começa tudo com a montadora

        // Insere componente na ordem
        await supabase.from('production_order_components').insert({
          production_order_id: orderId,
          component_id: comp.id,
          component_name: comp.name,
          component_sku: comp.sku,
          quantity_sent: qtySent,
          quantity_at_assembler: qtyAtAssembler,
          notes: itemNotes,
        });

        // Desconta do estoque local e marca como em poder da montadora
        let stockRow: any = null;
        if (comp.id) {
          const { data } = await supabase.from('stock_items').select('id, quantity, quantity_at_assembler').eq('component_id', comp.id).maybeSingle();
          stockRow = data;
        }
        if (!stockRow && comp.sku) {
          const { data } = await supabase.from('stock_items').select('id, quantity, quantity_at_assembler').ilike('item_code', comp.sku).maybeSingle();
          stockRow = data;
        }
        if (stockRow) {
          await supabase.from('stock_items').update({
            quantity: Number(stockRow.quantity) - qtySent,
            quantity_at_assembler: Number(stockRow.quantity_at_assembler) + qtyAtAssembler,
            updated_at: new Date().toISOString(),
          }).eq('id', stockRow.id);
          await supabase.from('stock_movements').insert({
            stock_item_id: stockRow.id, item_code: comp.sku ?? comp.name, item_name: comp.name,
            quantity: -qtySent, type: 'saida', notes: `Produção #${orderId.slice(0, 8)} — ${product.name} ×${qty}`,
          });
        }
        components.push({ component: comp.name, quantity_sent: qtySent, ok: !override });
      }

      return { created: true, order_id: orderId, product: product.name, quantity: qty, components_sent: components.length, components };
    }

    case 'list_production_orders': {
      let q = supabase
        .from('production_orders')
        .select('id, product_name, quantity_ordered, quantity_returned, status, assembler_name, sent_at, returned_at, notes, created_at')
        .order('created_at', { ascending: false })
        .limit(Number(args.limit ?? 50));
      if (args.status) q = q.eq('status', String(args.status));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { orders: data ?? [] };
    }

    case 'get_production_order_details': {
      let orderId = args.order_id ? String(args.order_id) : null;
      if (!orderId && args.product_name) {
        const { data } = await supabase
          .from('production_orders')
          .select('id')
          .ilike('product_name', `%${String(args.product_name)}%`)
          .in('status', ['enviado', 'em_montagem'])
          .order('created_at', { ascending: false })
          .limit(1);
        orderId = (data as any[])?.[0]?.id ?? null;
      }
      if (!orderId) return { found: false, message: 'Ordem não encontrada.' };

      const [orderRes, compsRes, notesRes] = await Promise.all([
        supabase.from('production_orders').select('*').eq('id', orderId).single(),
        supabase.from('production_order_components').select('*').eq('production_order_id', orderId),
        supabase.from('production_order_notes').select('*').eq('production_order_id', orderId).order('created_at'),
      ]);
      return {
        order: orderRes.data,
        components: compsRes.data ?? [],
        notes: notesRes.data ?? [],
      };
    }

    case 'finish_production_order': {
      let orderId = args.order_id ? String(args.order_id) : null;
      if (!orderId && args.product_name) {
        const { data } = await supabase
          .from('production_orders')
          .select('id, product_id, product_name')
          .ilike('product_name', `%${String(args.product_name)}%`)
          .in('status', ['enviado', 'em_montagem'])
          .order('created_at', { ascending: false })
          .limit(1);
        orderId = (data as any[])?.[0]?.id ?? null;
      }
      if (!orderId) return { finished: false, message: 'Ordem não encontrada.' };

      const qtyReturned = Number(args.quantity_returned);
      const returnedAt = args.returned_at ? String(args.returned_at) : new Date().toISOString().slice(0, 10);

      // Atualiza ordem
      await supabase.from('production_orders').update({
        status: 'concluido', quantity_returned: qtyReturned, returned_at: returnedAt,
        notes: args.notes ? String(args.notes) : undefined,
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);

      // Busca componentes da ordem
      const { data: comps } = await supabase
        .from('production_order_components')
        .select('*')
        .eq('production_order_id', orderId);

      // Mapa de retornos informados
      const returnMap: Record<string, number> = {};
      for (const r of (args.component_returns ?? []) as any[]) {
        returnMap[r.component_name.toLowerCase()] = Number(r.quantity_returned);
      }

      // Processa cada componente
      for (const comp of (comps ?? []) as any[]) {
        const qtyBack = returnMap[comp.component_name.toLowerCase()] ?? 0;
        const qtyStillAtAssembler = Math.max(0, comp.quantity_at_assembler - qtyBack);

        await supabase.from('production_order_components').update({
          quantity_returned: qtyBack,
          quantity_at_assembler: qtyStillAtAssembler,
        }).eq('id', comp.id);

        if (qtyBack > 0) {
          // Devolve ao nosso estoque
          let stockRow: any = null;
          if (comp.component_id) {
            const { data } = await supabase.from('stock_items').select('id, quantity, quantity_at_assembler').eq('component_id', comp.component_id).maybeSingle();
            stockRow = data;
          }
          if (!stockRow && comp.component_sku) {
            const { data } = await supabase.from('stock_items').select('id, quantity, quantity_at_assembler').ilike('item_code', comp.component_sku).maybeSingle();
            stockRow = data;
          }
          if (stockRow) {
            await supabase.from('stock_items').update({
              quantity: Number(stockRow.quantity) + qtyBack,
              quantity_at_assembler: Math.max(0, Number(stockRow.quantity_at_assembler) - qtyBack),
              updated_at: new Date().toISOString(),
            }).eq('id', stockRow.id);
            await supabase.from('stock_movements').insert({
              stock_item_id: stockRow.id, item_code: comp.component_sku ?? comp.component_name, item_name: comp.component_name,
              quantity: qtyBack, type: 'entrada', notes: `Retorno montagem #${orderId.slice(0, 8)}`,
            });
          }
        }
      }

      // Adiciona produto montado ao estoque (como produto acabado)
      const { data: orderRow } = await supabase.from('production_orders').select('product_name, product_id').eq('id', orderId).single();
      if (orderRow && qtyReturned > 0) {
        const productCode = (orderRow as any).product_name.toUpperCase().replace(/\s+/g, '_');
        const { data: existing } = await supabase.from('stock_items').select('id, quantity').ilike('item_code', productCode).maybeSingle();
        if (existing) {
          await supabase.from('stock_items').update({ quantity: Number(existing.quantity) + qtyReturned, updated_at: new Date().toISOString() }).eq('id', existing.id);
        } else {
          await supabase.from('stock_items').insert({ item_code: productCode, item_name: (orderRow as any).product_name, quantity: qtyReturned, unit: 'un' });
        }
      }

      if (args.notes) {
        await supabase.from('production_order_notes').insert({ production_order_id: orderId, content: String(args.notes) });
      }

      return { finished: true, order_id: orderId, quantity_returned: qtyReturned, returned_at: returnedAt };
    }

    case 'add_production_note': {
      let orderId = args.order_id ? String(args.order_id) : null;
      if (!orderId && args.product_name) {
        const { data } = await supabase.from('production_orders').select('id')
          .ilike('product_name', `%${String(args.product_name)}%`)
          .order('created_at', { ascending: false }).limit(1);
        orderId = (data as any[])?.[0]?.id ?? null;
      }
      if (!orderId) return { added: false, message: 'Ordem não encontrada.' };
      await supabase.from('production_order_notes').insert({
        production_order_id: orderId,
        content: String(args.content),
        author: args.author ? String(args.author) : null,
      });
      return { added: true };
    }

    // ── Produção / BOM ────────────────────────────────────────────────────────
    case 'check_production_feasibility':
    case 'get_max_producible': {
      const productName = String(args.product_name ?? '').trim();
      const unitsWanted = args.quantity ? Number(args.quantity) : null;

      // Busca produto pelo nome (fuzzy)
      const { data: products } = await supabase
        .from('products')
        .select('id, name, sku')
        .ilike('name', `%${productName}%`)
        .limit(1);
      const product = (products as any[])?.[0];
      if (!product) return { feasible: false, message: `Produto "${productName}" não encontrado no catálogo.` };

      // Busca BOM completo do produto
      const { data: bom } = await supabase
        .from('bom_items')
        .select('quantity, component:components(id, name, sku, unit)')
        .eq('product_id', product.id);

      if (!bom?.length) return { feasible: false, message: `${product.name} não tem BOM cadastrado. Cadastre os componentes primeiro.` };

      // Para cada componente do BOM, busca estoque disponível
      const analysis: any[] = [];
      for (const item of bom as any[]) {
        const comp = item.component;
        const qtyPerUnit = Number(item.quantity);

        // Busca stock pelo component_id (link direto) ou pelo SKU
        let stockRow: any = null;
        if (comp.id) {
          const { data } = await supabase.from('stock_items')
            .select('quantity, reserved_quantity, unit')
            .eq('component_id', comp.id)
            .maybeSingle();
          stockRow = data;
        }
        if (!stockRow && comp.sku) {
          const { data } = await supabase.from('stock_items')
            .select('quantity, reserved_quantity, unit')
            .ilike('item_code', comp.sku)
            .maybeSingle();
          stockRow = data;
        }

        const available = stockRow
          ? Number(stockRow.quantity) - Number(stockRow.reserved_quantity)
          : 0;

        const maxFromThis = qtyPerUnit > 0 ? Math.floor(available / qtyPerUnit) : Infinity;

        if (unitsWanted !== null) {
          const needed = qtyPerUnit * unitsWanted;
          analysis.push({
            component: comp.name,
            sku: comp.sku,
            unit: comp.unit,
            qty_per_unit: qtyPerUnit,
            needed,
            available,
            missing: Math.max(0, needed - available),
            ok: available >= needed,
          });
        } else {
          analysis.push({
            component: comp.name,
            sku: comp.sku,
            qty_per_unit: qtyPerUnit,
            available,
            max_from_this: maxFromThis,
          });
        }
      }

      if (args.name === 'get_max_producible' || unitsWanted === null) {
        const maxProducible = analysis.reduce((min: number, a: any) => Math.min(min, a.max_from_this ?? Infinity), Infinity);
        const limitingComponents = analysis.filter((a: any) => a.max_from_this === maxProducible);
        return {
          product: product.name,
          max_producible: isFinite(maxProducible) ? maxProducible : 0,
          limiting_components: limitingComponents,
          bom: analysis,
        };
      }

      const missing = analysis.filter((a: any) => !a.ok);
      return {
        product: product.name,
        quantity_requested: unitsWanted,
        feasible: missing.length === 0,
        components_ok: analysis.filter((a: any) => a.ok).length,
        components_missing: missing.length,
        missing,
        all_components: analysis,
      };
    }

    case 'deduct_components_for_production': {
      const productName = String(args.product_name ?? '').trim();
      const units = Number(args.quantity ?? 1);
      const notes = args.notes ? String(args.notes) : `Produção: ${units}x ${productName}`;

      const { data: products } = await supabase
        .from('products')
        .select('id, name')
        .ilike('name', `%${productName}%`)
        .limit(1);
      const product = (products as any[])?.[0];
      if (!product) throw new Error(`Produto "${productName}" não encontrado.`);

      const { data: bom } = await supabase
        .from('bom_items')
        .select('quantity, component:components(id, name, sku, unit)')
        .eq('product_id', product.id);

      if (!bom?.length) throw new Error(`${product.name} não tem BOM cadastrado.`);

      const results: any[] = [];
      for (const item of bom as any[]) {
        const comp = item.component;
        const totalQty = Number(item.quantity) * units;

        let stockRow: any = null;
        if (comp.id) {
          const { data } = await supabase.from('stock_items').select('id, quantity, reserved_quantity').eq('component_id', comp.id).maybeSingle();
          stockRow = data;
        }
        if (!stockRow && comp.sku) {
          const { data } = await supabase.from('stock_items').select('id, quantity, reserved_quantity').ilike('item_code', comp.sku).maybeSingle();
          stockRow = data;
        }

        if (stockRow) {
          const newQty = Number(stockRow.quantity) - totalQty;
          await supabase.from('stock_items')
            .update({ quantity: newQty, updated_at: new Date().toISOString() })
            .eq('id', stockRow.id);
          await supabase.from('stock_movements').insert({
            stock_item_id: stockRow.id,
            item_code: comp.sku ?? comp.name,
            item_name: comp.name,
            quantity: -totalQty,
            type: 'saida',
            notes,
          });
          results.push({ component: comp.name, deducted: totalQty, new_balance: newQty });
        } else {
          results.push({ component: comp.name, deducted: 0, note: 'Não encontrado no estoque' });
        }
      }

      return {
        product: product.name,
        units_produced: units,
        components_deducted: results.filter((r: any) => r.deducted > 0).length,
        items: results,
      };
    }

    // ── Prazos e chegada de materiais ─────────────────────────────────────────
    case 'set_component_lead_time': {
      const compName = String(args.component_name ?? '').trim();
      const days = Number(args.lead_time_days);
      if (!days || days < 0) throw new Error('lead_time_days deve ser um número positivo.');
      const { data: comps } = await supabase.from('components').select('id, name').ilike('name', `%${compName}%`).limit(1);
      const comp = (comps as any[])?.[0];
      if (!comp) throw new Error(`Componente "${compName}" não encontrado.`);
      await supabase.from('components').update({ lead_time_days: days }).eq('id', comp.id);
      return { updated: true, component: comp.name, lead_time_days: days };
    }

    case 'register_incoming_material': {
      const itemName = String(args.item_name ?? '').trim();
      const expectedArrival = String(args.expected_arrival);
      const orderedAt = args.ordered_at ? String(args.ordered_at) : new Date().toISOString().slice(0, 10);

      // Resolve pedido vinculado se informado
      let shipId: string | null = null;
      if (args.shipment_id || args.numero_venda) {
        const r = await resolveShipmentId(args);
        if (typeof r === 'string') shipId = r;
      }

      // Tenta encontrar um purchase_need existente para esse item (status pedido/pendente)
      let needId: string | null = null;
      {
        let q = supabase.from('purchase_needs').select('id').ilike('item_name', `%${itemName}%`).in('status', ['pendente', 'pedido']).limit(1);
        if (shipId) q = q.eq('shipment_id', shipId);
        const { data } = await q;
        needId = (data as any[])?.[0]?.id ?? null;
      }

      if (needId) {
        // Atualiza o registro existente
        await supabase.from('purchase_needs').update({
          status: 'pedido',
          expected_arrival: expectedArrival,
          carrier: args.carrier ? String(args.carrier) : null,
          ordered_at: orderedAt,
          ordered_quantity: args.ordered_quantity ? Number(args.ordered_quantity) : null,
          updated_at: new Date().toISOString(),
        }).eq('id', needId);
        if (args.notes) {
          await supabase.from('purchase_need_notes').insert({ need_id: needId, content: String(args.notes) });
        }
        return { registered: true, action: 'updated', need_id: needId, item_name: itemName, expected_arrival: expectedArrival };
      } else {
        // Cria novo registro de incoming
        const { data: created } = await supabase.from('purchase_needs').insert({
          item_name: itemName,
          shipment_id: shipId,
          status: 'pedido',
          expected_arrival: expectedArrival,
          carrier: args.carrier ? String(args.carrier) : null,
          ordered_at: orderedAt,
          ordered_quantity: args.ordered_quantity ? Number(args.ordered_quantity) : null,
        }).select('id').single();
        if (args.notes && created?.id) {
          await supabase.from('purchase_need_notes').insert({ need_id: created.id, content: String(args.notes) });
        }
        return { registered: true, action: 'created', need_id: created?.id, item_name: itemName, expected_arrival: expectedArrival };
      }
    }

    case 'list_incoming_materials': {
      let q = supabase
        .from('purchase_needs')
        .select(`id, item_name, ordered_quantity, expected_arrival, carrier, ordered_at, status,
                 notes:purchase_need_notes(content, created_at),
                 shipment:shipments(client_name, numero_venda)`)
        .in('status', ['pedido'])
        .not('expected_arrival', 'is', null)
        .order('expected_arrival', { ascending: true });
      if (args.item_name) q = q.ilike('item_name', `%${String(args.item_name)}%`);
      if (args.due_before) q = q.lte('expected_arrival', String(args.due_before));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: (data ?? []).length, incoming: data ?? [] };
    }

    case 'get_procurement_alerts': {
      const horizonDays = Number(args.horizon_days ?? 30);
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);

      // Busca todos os componentes com lead_time configurado
      const { data: comps } = await supabase
        .from('components')
        .select('id, name, sku, lead_time_days')
        .not('lead_time_days', 'is', null);

      // Busca estoque atual + chegando
      const { data: stockItems } = await supabase.from('stock_items').select('component_id, item_code, quantity, reserved_quantity');
      const { data: incoming } = await supabase
        .from('purchase_needs')
        .select('item_name, ordered_quantity, expected_arrival, carrier')
        .eq('status', 'pedido')
        .not('expected_arrival', 'is', null);

      // Busca necessidades dos pedidos pendentes (dentro do horizonte)
      const { data: pendingItems } = await supabase
        .from('shipment_items')
        .select(`item_code, item_name, quantity,
                 shipment:shipments!inner(status, data_prevista, client_name, numero_venda)`)
        .eq('shipments.status', 'pending');

      // Monta mapa de necessidades por componente SKU
      const needsMap: Record<string, { needed: number; shipments: string[] }> = {};
      for (const it of (pendingItems ?? []) as any[]) {
        const code = (it.item_code ?? '').toUpperCase();
        if (!needsMap[code]) needsMap[code] = { needed: 0, shipments: [] };
        needsMap[code].needed += Number(it.quantity ?? 1);
        const label = it.shipment?.numero_venda ? `#${it.shipment.numero_venda}` : it.shipment?.client_name ?? '?';
        if (!needsMap[code].shipments.includes(label)) needsMap[code].shipments.push(label);
      }

      const alerts: any[] = [];

      for (const comp of (comps ?? []) as any[]) {
        const leadDays = Number(comp.lead_time_days);
        // Data limite para pedir: hoje + lead_time é "último dia para comprar"
        const lastOrderDate = new Date(today.getTime() + leadDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // Estoque disponível
        const stockRow = (stockItems ?? []).find((s: any) =>
          (comp.id && s.component_id === comp.id) ||
          (comp.sku && s.item_code?.toUpperCase() === comp.sku?.toUpperCase())
        ) as any;
        const available = stockRow ? Number(stockRow.quantity) - Number(stockRow.reserved_quantity) : 0;

        // Quantidade chegando
        const incomingQty = (incoming ?? [])
          .filter((i: any) => i.item_name?.toLowerCase().includes(comp.name.toLowerCase()))
          .reduce((s: number, i: any) => s + Number(i.ordered_quantity ?? 0), 0);
        const incomingDetails = (incoming ?? [])
          .filter((i: any) => i.item_name?.toLowerCase().includes(comp.name.toLowerCase()));

        // Necessidade
        const need = needsMap[comp.sku?.toUpperCase() ?? ''] ?? { needed: 0, shipments: [] };
        const totalAvailable = available + incomingQty;
        const gap = need.needed - totalAvailable;

        // Urgência: se o lead time já passou a janela de análise, ou se o gap > 0
        const urgency = leadDays >= horizonDays ? 'critico' : gap > 0 ? 'alto' : available <= 0 ? 'medio' : null;
        if (!urgency && gap <= 0) continue; // Tudo ok, sem alerta

        alerts.push({
          component: comp.name,
          sku: comp.sku,
          lead_time_days: leadDays,
          available_stock: available,
          incoming_qty: incomingQty,
          incoming_details: incomingDetails.map((i: any) => ({ arrival: i.expected_arrival, carrier: i.carrier, qty: i.ordered_quantity })),
          needed_for_orders: need.needed,
          gap: Math.max(0, gap),
          urgency,
          must_order_by: lastOrderDate,
          already_late: lastOrderDate < todayStr,
          shipments_affected: need.shipments,
        });
      }

      alerts.sort((a, b) => (a.already_late ? -1 : 1) - (b.already_late ? -1 : 1) || b.gap - a.gap);
      return { alerts_count: alerts.length, horizon_days: horizonDays, alerts };
    }

    case 'set_product_type': {
      const productName = String(args.product_name ?? '').trim();
      const productType = String(args.product_type ?? '').trim().toLowerCase();
      if (!['revenda', 'fabricacao'].includes(productType)) {
        throw new Error('product_type deve ser "revenda" ou "fabricacao".');
      }
      const { data: prods } = await supabase
        .from('products')
        .select('id, name, product_type')
        .ilike('name', `%${productName}%`)
        .limit(1);
      const product = (prods as any[])?.[0];
      if (!product) throw new Error(`Produto "${productName}" não encontrado.`);
      await supabase.from('products').update({ product_type: productType }).eq('id', product.id);
      return { updated: true, product: product.name, product_type: productType };
    }

    case 'check_order_fulfillment': {
      // Resolve quais pedidos analisar
      let shipmentIds: string[] = [];
      if (args.all_pending) {
        const { data } = await supabase
          .from('shipments')
          .select('id, client_name, numero_venda')
          .eq('status', 'pending');
        shipmentIds = (data ?? []).map((s: any) => s.id);
      } else {
        const resolved = await resolveShipmentId(args);
        if (typeof resolved === 'string') shipmentIds = [resolved];
        else return resolved;
      }

      if (!shipmentIds.length) return { message: 'Nenhum pedido pendente encontrado.' };

      const shipmentResults: any[] = [];

      for (const shipId of shipmentIds) {
        const [shipRes, itemsRes] = await Promise.all([
          supabase.from('shipments').select('id, client_name, numero_venda, numero_nfe').eq('id', shipId).single(),
          supabase.from('shipment_items').select('item_code, item_name, quantity, product:products(id, name, product_type)').eq('shipment_id', shipId),
        ]);

        const ship: any = shipRes.data;
        const itemAnalysis: any[] = [];
        let shipmentFullyFulfillable = true;

        for (const si of (itemsRes.data ?? []) as any[]) {
          const qty = Number(si.quantity ?? 1);
          const prod: any = si.product;
          const itemCode = si.item_code?.toUpperCase() ?? si.item_name?.toUpperCase().replace(/\s+/g, '_');

          if (!prod) {
            // Item sem produto vinculado — trata como revenda, checa estoque pelo item_code
            const { data: stock } = await supabase.from('stock_items').select('quantity, reserved_quantity, unit').ilike('item_code', itemCode ?? '').maybeSingle();
            const available = stock ? Number(stock.quantity) - Number(stock.reserved_quantity) : 0;
            const canFulfill = available >= qty;
            if (!canFulfill) shipmentFullyFulfillable = false;
            itemAnalysis.push({ item: si.item_name, type: 'revenda', needed: qty, available, can_fulfill: canFulfill, missing: Math.max(0, qty - available) });
            continue;
          }

          const type = prod.product_type ?? 'revenda';

          if (type === 'revenda') {
            // Checa estoque do produto acabado diretamente
            const productCode = prod.name.toUpperCase().replace(/\s+/g, '_');
            let stock: any = null;
            // Tenta pelo item_code do shipment_item primeiro
            if (itemCode) {
              const { data } = await supabase.from('stock_items').select('quantity, reserved_quantity, unit').ilike('item_code', itemCode).maybeSingle();
              stock = data;
            }
            if (!stock) {
              const { data } = await supabase.from('stock_items').select('quantity, reserved_quantity, unit').ilike('item_code', productCode).maybeSingle();
              stock = data;
            }
            const available = stock ? Number(stock.quantity) - Number(stock.reserved_quantity) : 0;
            const canFulfill = available >= qty;
            if (!canFulfill) shipmentFullyFulfillable = false;
            itemAnalysis.push({ item: prod.name, type: 'revenda', needed: qty, available, can_fulfill: canFulfill, missing: Math.max(0, qty - available) });

          } else {
            // Fabricação — cruza BOM × estoque de componentes
            const { data: bom } = await supabase
              .from('bom_items')
              .select('quantity, component:components(id, name, sku)')
              .eq('product_id', prod.id);

            if (!bom?.length) {
              itemAnalysis.push({ item: prod.name, type: 'fabricacao', needed: qty, can_fulfill: false, note: 'BOM não cadastrado' });
              shipmentFullyFulfillable = false;
              continue;
            }

            const componentAnalysis: any[] = [];
            let maxProducible = Infinity;
            for (const bi of bom as any[]) {
              const comp = bi.component;
              const totalNeeded = Number(bi.quantity) * qty;
              let stock: any = null;
              if (comp.id) {
                const { data } = await supabase.from('stock_items').select('quantity, reserved_quantity').eq('component_id', comp.id).maybeSingle();
                stock = data;
              }
              if (!stock && comp.sku) {
                const { data } = await supabase.from('stock_items').select('quantity, reserved_quantity').ilike('item_code', comp.sku).maybeSingle();
                stock = data;
              }
              const available = stock ? Number(stock.quantity) - Number(stock.reserved_quantity) : 0;
              const maxFromThis = Number(bi.quantity) > 0 ? Math.floor(available / Number(bi.quantity)) : Infinity;
              if (isFinite(maxFromThis)) maxProducible = Math.min(maxProducible, maxFromThis);
              if (totalNeeded > available) {
                componentAnalysis.push({ component: comp.name, needed: totalNeeded, available, missing: totalNeeded - available });
              }
            }
            const canFulfill = componentAnalysis.length === 0;
            const maxProd = isFinite(maxProducible) ? maxProducible : 0;
            if (!canFulfill) shipmentFullyFulfillable = false;
            itemAnalysis.push({
              item: prod.name, type: 'fabricacao', needed: qty,
              max_producible: maxProd, can_fulfill: canFulfill,
              missing_components: componentAnalysis,
            });
          }
        }

        shipmentResults.push({
          shipment_id: shipId,
          client: ship?.client_name,
          numero_venda: ship?.numero_venda,
          can_fulfill: shipmentFullyFulfillable,
          items: itemAnalysis,
        });
      }

      const canFulfillAll = shipmentResults.filter((s: any) => s.can_fulfill).length;
      return {
        total_shipments: shipmentResults.length,
        can_fulfill_count: canFulfillAll,
        shipments: shipmentResults,
      };
    }

    case 'set_stock_minimum': {
      const minQty = Number(args.min_quantity);
      if (minQty < 0) throw new Error('min_quantity deve ser >= 0.');
      let item: any = null;
      if (args.item_code) {
        const { data } = await supabase.from('stock_items').select('id, item_name').ilike('item_code', String(args.item_code)).maybeSingle();
        item = data;
      } else if (args.item_name) {
        const { data } = await supabase.from('stock_items').select('id, item_name').ilike('item_name', `%${String(args.item_name)}%`).limit(1);
        item = (data as any)?.[0];
      }
      if (!item) throw new Error('Item não encontrado no estoque. Registre uma entrada primeiro.');
      await supabase.from('stock_items').update({ min_quantity: minQty, updated_at: new Date().toISOString() }).eq('id', item.id);
      return { updated: true, item_name: item.item_name, min_quantity: minQty };
    }

    case 'get_low_stock_alerts': {
      const includeZero = args.include_zero !== false;
      const { data, error } = await supabase
        .from('stock_items')
        .select('item_code, item_name, quantity, reserved_quantity, min_quantity, unit')
        .order('quantity');
      if (error) throw new Error(error.message);

      const alerts = (data ?? []).filter((s: any) => {
        const qty = Number(s.quantity);
        const min = Number(s.min_quantity);
        const avail = qty - Number(s.reserved_quantity);
        if (qty < 0) return true;
        if (includeZero && qty === 0) return true;
        if (min > 0 && avail < min) return true;
        return false;
      }).map((s: any) => ({
        item_code: s.item_code,
        item_name: s.item_name,
        quantity: Number(s.quantity),
        reserved: Number(s.reserved_quantity),
        available: Number(s.quantity) - Number(s.reserved_quantity),
        min_quantity: Number(s.min_quantity),
        unit: s.unit,
        severity: Number(s.quantity) < 0 ? 'negativo' : Number(s.quantity) === 0 ? 'zerado' : 'abaixo_do_minimo',
      }));

      return { alerts, count: alerts.length };
    }

    case 'get_stock_history': {
      const days = Number(args.days ?? 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from('stock_movements')
        .select('id, quantity, type, notes, created_at, shipment:shipments(client_name, numero_venda)')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50);
      if (args.item_code) q = q.ilike('item_code', `%${String(args.item_code)}%`);
      else if (args.item_name) q = q.ilike('item_name', `%${String(args.item_name)}%`);
      else throw new Error('Informe item_code ou item_name.');
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const totalIn  = (data ?? []).filter((m: any) => Number(m.quantity) > 0).reduce((s: number, m: any) => s + Number(m.quantity), 0);
      const totalOut = (data ?? []).filter((m: any) => Number(m.quantity) < 0).reduce((s: number, m: any) => s + Math.abs(Number(m.quantity)), 0);
      return { period_days: days, total_in: totalIn, total_out: totalOut, movements: data ?? [] };
    }

    case 'generate_purchase_list': {
      const { data: stockItems } = await supabase
        .from('stock_items')
        .select('item_code, item_name, quantity, reserved_quantity, unit');
      const { data: pendingItems } = await supabase
        .from('shipment_items')
        .select('item_code, item_name, quantity, shipment:shipments!inner(client_name, numero_venda, status)')
        .eq('shipments.status', 'pending');

      const needsMap: Record<string, { item_name: string; needed: number; shipments: string[] }> = {};
      for (const it of (pendingItems ?? []) as any[]) {
        const code = (it.item_code ?? it.item_name ?? '').toUpperCase();
        if (!needsMap[code]) needsMap[code] = { item_name: it.item_name ?? code, needed: 0, shipments: [] };
        needsMap[code].needed += Number(it.quantity ?? 1);
        const lbl = it.shipment?.numero_venda ? `#${it.shipment.numero_venda}` : it.shipment?.client_name ?? '?';
        if (!needsMap[code].shipments.includes(lbl)) needsMap[code].shipments.push(lbl);
      }

      const stockMap: Record<string, { qty: number; reserved: number; unit: string }> = {};
      for (const s of (stockItems ?? []) as any[]) {
        stockMap[s.item_code] = { qty: Number(s.quantity), reserved: Number(s.reserved_quantity), unit: s.unit };
      }

      const lines: string[] = [];
      const toBuy: Array<{ code: string; name: string; qty: number; unit: string; shipments: string[] }> = [];

      for (const [code, n] of Object.entries(needsMap)) {
        const stock = stockMap[code];
        const available = stock ? stock.qty - stock.reserved : 0;
        const needed = Math.max(0, n.needed - available);
        if (needed > 0 || args.include_all) {
          toBuy.push({ code, name: n.item_name, qty: needed || n.needed, unit: stock?.unit ?? 'un', shipments: n.shipments });
        }
      }

      if (!toBuy.length) return { list: 'Estoque suficiente para todos os pedidos pendentes. Nada a comprar.', count: 0 };

      const date = new Date().toLocaleDateString('pt-BR');
      lines.push(`**Lista de Compras — ${date}**\n`);
      for (const item of toBuy.sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`- **${item.qty} ${item.unit}** — ${item.name} \`${item.code}\` _(pedidos: ${item.shipments.join(', ')})_`);
      }
      lines.push(`\n_${toBuy.length} item${toBuy.length !== 1 ? 's' : ''} — gerado pelo EGP_`);

      return { list: lines.join('\n'), count: toBuy.length, items: toBuy };
    }

    case 'reserve_stock': {
      const resolved = await resolveShipmentId(args);
      if (typeof resolved !== 'string') return resolved;
      const shipmentId = resolved;

      const { data: items } = await supabase
        .from('shipment_items')
        .select('item_code, item_name, quantity')
        .eq('shipment_id', shipmentId);

      if (!items?.length) return { reserved: 0, message: 'Pedido sem itens.' };

      const results: any[] = [];
      for (const it of items as any[]) {
        const code = (it.item_code ?? it.item_name ?? '').toUpperCase();
        const qty = Number(it.quantity ?? 1);
        const { data: s } = await supabase.from('stock_items').select('id, quantity, reserved_quantity').ilike('item_code', code).maybeSingle();
        if (s) {
          const newReserved = Number(s.reserved_quantity) + qty;
          await supabase.from('stock_items').update({ reserved_quantity: newReserved, updated_at: new Date().toISOString() }).eq('id', s.id);
          results.push({ item_code: code, reserved: qty, available_after: Number(s.quantity) - newReserved });
        } else {
          results.push({ item_code: code, reserved: 0, note: 'Não encontrado no estoque' });
        }
      }
      return { reserved: results.filter((r) => r.reserved > 0).length, items: results };
    }

    case 'release_stock_reservation': {
      const resolved = await resolveShipmentId(args);
      if (typeof resolved !== 'string') return resolved;
      const shipmentId = resolved;

      const { data: items } = await supabase
        .from('shipment_items')
        .select('item_code, item_name, quantity')
        .eq('shipment_id', shipmentId);

      if (!items?.length) return { released: 0, message: 'Pedido sem itens.' };

      const results: any[] = [];
      for (const it of items as any[]) {
        const code = (it.item_code ?? it.item_name ?? '').toUpperCase();
        const qty = Number(it.quantity ?? 1);
        const { data: s } = await supabase.from('stock_items').select('id, quantity, reserved_quantity').ilike('item_code', code).maybeSingle();
        if (s) {
          const newReserved = Math.max(0, Number(s.reserved_quantity) - qty);
          await supabase.from('stock_items').update({ reserved_quantity: newReserved, updated_at: new Date().toISOString() }).eq('id', s.id);
          results.push({ item_code: code, released: qty });
        }
      }
      return { released: results.length, items: results };
    }

    case 'add_shipment_items': {
      const id = String(args.shipment_id ?? '');
      if (!id) throw new Error('shipment_id é obrigatório');
      const itemsInput: Array<{
        product_name?: string; product_id?: string;
        item_code?: string; item_name?: string; unit_price?: number; quantity: number;
      }> = Array.isArray(args.items) ? args.items : [];
      if (itemsInput.length === 0) throw new Error('items é obrigatório');
      const added: any[] = [];
      const failed: any[] = [];
      for (const it of itemsInput) {
        let productId = it.product_id ? String(it.product_id) : '';
        if (!productId && it.product_name) {
          const found = await findProductByName(String(it.product_name));
          if (found) productId = found.id;
        }
        const qty = Number(it.quantity);
        if (!(qty > 0)) {
          failed.push({ item_name: it.item_name ?? it.product_name, error: 'quantity inválido' });
          continue;
        }
        const itemPayload: Record<string, unknown> = {
          shipment_id: id,
          product_id:  productId || null,
          item_code:   it.item_code  ? String(it.item_code).trim()  : null,
          item_name:   it.item_name  ? String(it.item_name).trim()  : null,
          unit_price:  it.unit_price != null ? Number(it.unit_price) : null,
          quantity:    qty,
        };
        // Idempotência por product_id (quando vinculado ao catálogo)
        if (productId) {
          const { data: existing } = await supabase
            .from('shipment_items')
            .select('id')
            .eq('shipment_id', id)
            .eq('product_id', productId)
            .maybeSingle();
          if (existing) {
            const { error: upErr } = await supabase
              .from('shipment_items')
              .update({ quantity: qty, unit_price: itemPayload.unit_price })
              .eq('id', (existing as any).id);
            if (upErr) failed.push({ item_name: it.item_name ?? it.product_name, error: upErr.message });
            else added.push({ action: 'updated', product_id: productId, item_name: it.item_name ?? it.product_name, quantity: qty });
            continue;
          }
        }
        const { error: insErr } = await supabase.from('shipment_items').insert(itemPayload);
        if (insErr) failed.push({ item_name: it.item_name ?? it.product_name, error: insErr.message });
        else added.push({ action: 'created', product_id: productId, item_name: it.item_name ?? it.product_name, quantity: qty });
      }
      return { items_processed: added, items_failed: failed };
    }

    // -------- TAREFAS AGENDADAS --------

    case 'create_scheduled_task': {
      const name        = String(args.name ?? '').trim();
      const instruction = String(args.instruction ?? '').trim();
      const schedTime   = String(args.schedule_time ?? '').trim();
      if (!name || !instruction || !schedTime) throw new Error('name, instruction e schedule_time são obrigatórios');
      if (!/^\d{2}:\d{2}$/.test(schedTime)) throw new Error('schedule_time deve ser HH:MM');
      const days = Array.isArray(args.days_of_week) ? args.days_of_week.map(Number) : null;
      const { data, error } = await supabase
        .from('scheduled_tasks')
        .insert({ name, instruction, schedule_time: schedTime, days_of_week: days })
        .select('id, name, schedule_time, days_of_week, enabled')
        .single();
      if (error) throw new Error(error.message);
      const DAYS = ['dom','seg','ter','qua','qui','sex','sáb'];
      const daysLabel = days ? days.map((d: number) => DAYS[d]).join(', ') : 'todo dia';
      return { created: data, schedule: `${schedTime} BRT — ${daysLabel}` };
    }

    case 'list_scheduled_tasks': {
      const { data, error } = await supabase
        .from('scheduled_tasks')
        .select('id, name, instruction, schedule_time, days_of_week, enabled, last_run_at, last_status')
        .order('schedule_time');
      if (error) throw new Error(error.message);
      return { tasks: data ?? [] };
    }

    case 'toggle_scheduled_task': {
      const enabled = Boolean(args.enabled);
      let id = args.task_id ? String(args.task_id) : null;
      if (!id && args.name) {
        const { data: rows } = await supabase.from('scheduled_tasks').select('id').ilike('name', `%${String(args.name)}%`).limit(1);
        id = (rows?.[0] as any)?.id ?? null;
      }
      if (!id) throw new Error('Tarefa não encontrada. Informe task_id ou name.');
      const { error } = await supabase.from('scheduled_tasks').update({ enabled, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, task_id: id, enabled };
    }

    case 'delete_scheduled_task': {
      let id = args.task_id ? String(args.task_id) : null;
      if (!id && args.name) {
        const { data: rows } = await supabase.from('scheduled_tasks').select('id').ilike('name', `%${String(args.name)}%`).limit(1);
        id = (rows?.[0] as any)?.id ?? null;
      }
      if (!id) throw new Error('Tarefa não encontrada.');
      const { error } = await supabase.from('scheduled_tasks').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, task_id: id };
    }

    // -------- TOOLS EXTRAS --------

    case 'financial_summary': {
      const period = String(args.period ?? 'this_month');
      const now = new Date();
      let since: string;
      if (period === 'today') since = now.toISOString().slice(0, 10);
      else if (period === 'this_week') {
        const d = new Date(now); d.setDate(d.getDate() - d.getDay()); since = d.toISOString().slice(0, 10);
      } else if (period === 'last_30_days') {
        const d = new Date(now); d.setDate(d.getDate() - 30); since = d.toISOString().slice(0, 10);
      } else {
        since = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      }
      const [shipmentsRes, titulosRes] = await Promise.all([
        supabase.from('shipments').select('id, client_name, valor_total, status, created_at').gte('created_at', since),
        supabase.from('titulos').select('valor, status, vencimento'),
      ]);
      const shipments = (shipmentsRes.data ?? []) as any[];
      const titulos = (titulosRes.data ?? []) as any[];
      const today = now.toISOString().slice(0, 10);
      const totalSaidas = shipments.reduce((s, x) => s + (Number(x.valor_total) || 0), 0);
      const emAberto = titulos.filter((t: any) => t.status === 'aberto').reduce((s: number, t: any) => s + Number(t.valor), 0);
      const vencidos  = titulos.filter((t: any) => t.status === 'aberto' && t.vencimento && t.vencimento < today).reduce((s: number, t: any) => s + Number(t.valor), 0);
      return {
        period: `desde ${since}`,
        pedidos_criados: shipments.length,
        total_saidas: totalSaidas,
        titulos_em_aberto: emAberto,
        titulos_vencidos: vencidos,
        pedidos_pendentes: shipments.filter((s: any) => s.status === 'pending').length,
        pedidos_saidos: shipments.filter((s: any) => s.status === 'shipped').length,
      };
    }

    case 'client_history': {
      const q = String(args.client_name ?? '').trim();
      if (!q) throw new Error('client_name é obrigatório');
      const [shipmentsRes, titulosRes] = await Promise.all([
        supabase.from('shipments').select('id, client_name, numero_nfe, numero_venda, status, valor_total, data_prevista, data_saida, created_at')
          .ilike('client_name', `%${q}%`).order('created_at', { ascending: false }).limit(50),
        supabase.from('titulos').select('client_name, valor, status, vencimento, financeira:financeiras(nome)')
          .ilike('client_name', `%${q}%`).order('created_at', { ascending: false }).limit(50),
      ]);
      const shipments = (shipmentsRes.data ?? []) as any[];
      const titulos = (titulosRes.data ?? []) as any[];
      const totalFaturado = shipments.reduce((s, x) => s + (Number(x.valor_total) || 0), 0);
      const emAberto = titulos.filter((t: any) => t.status === 'aberto').reduce((s: number, t: any) => s + Number(t.valor), 0);
      return { shipments, titulos, total_faturado: totalFaturado, total_em_aberto: emAberto };
    }

    case 'list_overdue_titles': {
      const today = new Date().toISOString().slice(0, 10);
      let q = supabase.from('titulos')
        .select('id, client_name, valor, vencimento, numero_titulo, financeira:financeiras(nome)')
        .eq('status', 'aberto').lt('vencimento', today).order('vencimento');
      if (args.financeira_name) {
        const { data: fr } = await supabase.from('financeiras').select('id').ilike('nome', `%${String(args.financeira_name)}%`).limit(1);
        const fid = (fr?.[0] as any)?.id;
        if (fid) q = q.eq('financeira_id', fid);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const titulos = (data ?? []) as any[];
      const total = titulos.reduce((s, t) => s + Number(t.valor), 0);
      return { overdue_titles: titulos, total_vencido: total, count: titulos.length };
    }

    case 'duplicate_shipment': {
      let srcId = args.shipment_id ? String(args.shipment_id) : null;
      if (!srcId && args.client_name) {
        const { data: rows } = await supabase.from('shipments').select('id').ilike('client_name', `%${String(args.client_name)}%`).order('created_at', { ascending: false }).limit(1);
        srcId = (rows?.[0] as any)?.id ?? null;
      }
      if (!srcId) throw new Error('Pedido não encontrado. Informe shipment_id ou client_name.');
      const [shipRes, itemsRes] = await Promise.all([
        supabase.from('shipments').select('*').eq('id', srcId).single(),
        supabase.from('shipment_items').select('product_id, item_code, item_name, unit_price, quantity').eq('shipment_id', srcId),
      ]);
      if (shipRes.error || !shipRes.data) throw new Error('Pedido não encontrado');
      const src = shipRes.data as any;
      const { data: newShip, error: insErr } = await supabase.from('shipments')
        .insert({
          client_name: src.client_name, client_cnpj: src.client_cnpj, client_phone: src.client_phone,
          client_email: src.client_email, client_address: src.client_address,
          frete_tipo: src.frete_tipo, frete_valor: src.frete_valor, total_produtos: src.total_produtos,
          valor_total: src.valor_total, forma_pagamento: src.forma_pagamento, condicao_pagamento: src.condicao_pagamento,
          data_prevista: args.data_prevista ? String(args.data_prevista) : null,
          notes: src.notes,
        })
        .select('id, client_name, status').single();
      if (insErr || !newShip) throw new Error(insErr?.message ?? 'Falha ao clonar pedido');
      if (itemsRes.data?.length) {
        await supabase.from('shipment_items').insert(
          (itemsRes.data as any[]).map((it) => ({ ...it, shipment_id: (newShip as any).id }))
        );
      }
      return { cloned: newShip, items_copied: itemsRes.data?.length ?? 0, source_id: srcId };
    }

    case 'bulk_mark_shipped': {
      const ids: string[] = [];
      if (Array.isArray(args.shipment_ids)) ids.push(...args.shipment_ids.map(String));
      if (Array.isArray(args.numero_nfes)) {
        for (const nfe of args.numero_nfes) {
          const { data } = await supabase.from('shipments').select('id').ilike('numero_nfe', `%${nfe}%`).limit(1);
          if ((data?.[0] as any)?.id) ids.push((data![0] as any).id);
        }
      }
      if (Array.isArray(args.client_names)) {
        for (const cn of args.client_names) {
          const { data } = await supabase.from('shipments').select('id').ilike('client_name', `%${cn}%`).eq('status', 'pending').limit(1);
          if ((data?.[0] as any)?.id) ids.push((data![0] as any).id);
        }
      }
      if (!ids.length) throw new Error('Nenhum pedido identificado.');
      const now = new Date().toISOString();
      const { error } = await supabase.from('shipments').update({ status: 'shipped', data_saida: now, updated_at: now }).in('id', ids);
      if (error) throw new Error(error.message);
      return { marked_shipped: ids.length, shipment_ids: ids };
    }

    case 'search_all': {
      const q = String(args.query ?? '').trim();
      if (!q) throw new Error('query é obrigatório');
      const pattern = `%${q}%`;
      const [ships, comps, suppls, quots] = await Promise.all([
        supabase.from('shipments').select('id, client_name, numero_nfe, numero_venda, status').ilike('client_name', pattern).limit(5),
        supabase.from('components').select('id, name').ilike('name', pattern).limit(5),
        supabase.from('suppliers').select('id, name').ilike('name', pattern).limit(5),
        supabase.from('quotations').select('id, title, status').ilike('title', pattern).limit(5),
      ]);
      return {
        pedidos:      (ships.data ?? []),
        componentes:  (comps.data ?? []),
        fornecedores: (suppls.data ?? []),
        cotacoes:     (quots.data ?? []),
        total_results: (ships.data?.length ?? 0) + (comps.data?.length ?? 0) + (suppls.data?.length ?? 0) + (quots.data?.length ?? 0),
      };
    }

    case 'component_cost_alert': {
      const { data, error } = await supabase
        .from('bom_items')
        .select('target_price_brl, quantity, component:components(id, name), product:products(id, name)')
        .not('target_price_brl', 'is', null);
      if (error) throw new Error(error.message);
      const alerts: any[] = [];
      for (const row of (data ?? []) as any[]) {
        const comp = row.component;
        if (!comp) continue;
        // Busca custo atual do componente via quotation_responses (último preço pago)
        const { data: respItems } = await supabase
          .from('quotation_response_items')
          .select('unit_price, response:quotation_responses(submitted_at)')
          .eq('quotation_item_id', comp.id)
          .order('created_at', { ascending: false })
          .limit(1);
        const lastPrice = (respItems?.[0] as any)?.unit_price;
        if (lastPrice && Number(lastPrice) > Number(row.target_price_brl)) {
          alerts.push({
            component: comp.name, product: row.product?.name,
            target: Number(row.target_price_brl), last_price: Number(lastPrice),
            overage_pct: Math.round(((Number(lastPrice) - Number(row.target_price_brl)) / Number(row.target_price_brl)) * 100),
          });
        }
      }
      return { alerts, count: alerts.length };
    }

    case 'generate_shipment_report': {
      const period = String(args.period ?? 'this_month');
      const status = String(args.status ?? 'all');
      const now = new Date();
      let since: string;
      if (period === 'today') since = now.toISOString().slice(0, 10);
      else if (period === 'this_week') { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); since = d.toISOString().slice(0, 10); }
      else { since = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; }
      let q = supabase.from('shipments').select('client_name, numero_nfe, numero_venda, status, valor_total, data_prevista, data_saida').gte('created_at', since).order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const STATUS_PT: Record<string, string> = { pending: 'Pendente', shipped: 'Saiu', returned: 'Voltou', cancelled: 'Cancelado' };
      const lines = rows.map((r) => {
        const nf = r.numero_nfe ? `NF ${r.numero_nfe}` : r.numero_venda ? `Venda #${r.numero_venda}` : '—';
        const val = r.valor_total ? `R$${Number(r.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '';
        return `• ${r.client_name} | ${nf} | ${STATUS_PT[r.status] ?? r.status} ${val}`;
      }).join('\n');
      const total = rows.reduce((s, r) => s + (Number(r.valor_total) || 0), 0);
      return {
        report: `Relatório de pedidos — ${since} até hoje\n\n${lines || '(nenhum pedido no período)'}\n\nTotal: R$${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | ${rows.length} pedido(s)`,
      };
    }

    // -------- FINANCEIRA --------

    case 'find_financeira_by_name': {
      const q = String(args.name ?? '').trim();
      if (!q) throw new Error('name é obrigatório');
      const { data, error } = await supabase
        .from('financeiras')
        .select('id, nome, contato, notes')
        .ilike('nome', `%${q}%`)
        .limit(5);
      if (error) throw new Error(error.message);
      const results = data ?? [];
      if (results.length === 0) {
        return { found: false, message: `Nenhuma financeira com nome parecido com "${q}". Use create_financeira para cadastrar.` };
      }
      return { found: true, financeiras: results };
    }

    case 'list_financeiras': {
      const { data, error } = await supabase
        .from('financeiras')
        .select('id, nome, contato')
        .order('nome');
      if (error) throw new Error(error.message);
      return { financeiras: data ?? [] };
    }

    case 'create_financeira': {
      const nome = String(args.nome ?? '').trim();
      if (!nome) throw new Error('nome é obrigatório');
      const { data, error } = await supabase
        .from('financeiras')
        .insert({
          nome,
          contato: args.contato ? String(args.contato).trim() : null,
          notes:   args.notes   ? String(args.notes).trim()   : null,
        })
        .select('id, nome, contato')
        .single();
      if (error) throw new Error(error.message);
      return { created: data };
    }

    case 'register_titulo': {
      const clientName     = String(args.client_name ?? '').trim();
      const valor          = Number(args.valor ?? 0);
      if (!clientName) throw new Error('client_name é obrigatório');
      if (!(valor > 0))  throw new Error('valor deve ser > 0');

      // Resolve financeira por nome fuzzy
      const finName = String(args.financeira_name ?? '').trim();
      if (!finName) throw new Error('financeira_name é obrigatório');
      const { data: finRows } = await supabase
        .from('financeiras')
        .select('id, nome')
        .ilike('nome', `%${finName}%`)
        .limit(1);
      const financeira = finRows?.[0] as any;
      if (!financeira) {
        return {
          registered: false,
          message: `Financeira "${finName}" não encontrada. Cadastre com create_financeira primeiro.`,
        };
      }

      // Resolve shipment_id opcional por numero_nfe / numero_venda
      let shipmentId: string | null = args.shipment_id ? String(args.shipment_id) : null;
      if (!shipmentId && (args.numero_nfe || args.numero_venda)) {
        let sq = supabase.from('shipments').select('id').limit(1);
        if (args.numero_nfe)   sq = sq.ilike('numero_nfe',   `%${args.numero_nfe}%`);
        if (args.numero_venda) sq = sq.ilike('numero_venda', `%${args.numero_venda}%`);
        const { data: shipRows } = await sq;
        shipmentId = (shipRows?.[0] as any)?.id ?? null;
      }

      const payload: Record<string, unknown> = {
        financeira_id:  financeira.id,
        client_name:    clientName,
        valor,
        shipment_id:    shipmentId,
        numero_titulo:  args.numero_titulo  ? String(args.numero_titulo).trim()  : null,
        numero_nfe:     args.numero_nfe     ? String(args.numero_nfe).trim()     : null,
        numero_venda:   args.numero_venda   ? String(args.numero_venda).trim()   : null,
        vencimento:     args.vencimento     ? String(args.vencimento)            : null,
        data_entrada:   args.data_entrada   ? String(args.data_entrada)          : null,
        notes:          args.notes          ? String(args.notes).trim()          : null,
      };
      const { data, error } = await supabase
        .from('titulos')
        .insert(payload)
        .select('id, financeira_id, client_name, valor, vencimento, status')
        .single();
      if (error) throw new Error(error.message);
      return { registered: true, titulo: data, financeira: financeira.nome };
    }

    case 'list_titulos': {
      const limit = Number(args.limit ?? 100);
      let q = supabase
        .from('titulos')
        .select('id, client_name, valor, vencimento, status, data_entrada, data_pagamento, numero_titulo, numero_nfe, numero_venda, financeira:financeiras(id,nome)')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (args.status)        q = q.eq('status', String(args.status));
      if (args.client_name)   q = q.ilike('client_name', `%${String(args.client_name)}%`);
      if (args.vencimento_ate) q = q.lte('vencimento', String(args.vencimento_ate));
      if (args.financeira_name) {
        const { data: finRows } = await supabase
          .from('financeiras').select('id').ilike('nome', `%${String(args.financeira_name)}%`).limit(1);
        const finId = (finRows?.[0] as any)?.id;
        if (finId) q = q.eq('financeira_id', finId);
        else return { titulos: [], message: `Financeira "${args.financeira_name}" não encontrada.` };
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { titulos: data ?? [] };
    }

    case 'mark_titulo_status': {
      const newStatus = String(args.new_status ?? '');
      const allowed = ['aberto', 'pago', 'devolvido', 'protestado'];
      if (!allowed.includes(newStatus)) throw new Error(`new_status inválido (${allowed.join(', ')})`);

      let id = args.titulo_id ? String(args.titulo_id) : null;
      if (!id && args.numero_titulo) {
        let sq = supabase.from('titulos').select('id').eq('numero_titulo', String(args.numero_titulo));
        if (args.financeira_name) {
          const { data: fr } = await supabase.from('financeiras').select('id')
            .ilike('nome', `%${String(args.financeira_name)}%`).limit(1);
          if ((fr?.[0] as any)?.id) sq = sq.eq('financeira_id', (fr![0] as any).id);
        }
        const { data: rows } = await sq.limit(1);
        id = (rows?.[0] as any)?.id ?? null;
      }
      if (!id) throw new Error('Título não encontrado. Informe titulo_id ou numero_titulo.');

      const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
      if (newStatus === 'pago') {
        patch.data_pagamento = args.data_pagamento ? String(args.data_pagamento) : new Date().toISOString().slice(0, 10);
      }
      const { error } = await supabase.from('titulos').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, titulo_id: id, new_status: newStatus };
    }

    case 'get_financeira_summary': {
      let q = supabase
        .from('titulos')
        .select('financeira_id, valor, status, vencimento, financeira:financeiras(nome)');
      if (args.financeira_name) {
        const { data: fr } = await supabase.from('financeiras').select('id')
          .ilike('nome', `%${String(args.financeira_name)}%`).limit(1);
        const fid = (fr?.[0] as any)?.id;
        if (!fid) return { summary: [], message: `Financeira "${args.financeira_name}" não encontrada.` };
        q = q.eq('financeira_id', fid);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const map = new Map<string, { financeira: string; em_aberto: number; total_aberto: number; vencidos: number; total_geral: number }>();
      const hoje = new Date().toISOString().slice(0, 10);
      for (const row of (data ?? []) as any[]) {
        const fname = row.financeira?.nome ?? row.financeira_id;
        if (!map.has(fname)) map.set(fname, { financeira: fname, em_aberto: 0, total_aberto: 0, vencidos: 0, total_geral: 0 });
        const entry = map.get(fname)!;
        entry.total_geral += Number(row.valor);
        if (row.status === 'aberto') {
          entry.em_aberto++;
          entry.total_aberto += Number(row.valor);
          if (row.vencimento && row.vencimento < hoje) entry.vencidos++;
        }
      }
      return { summary: Array.from(map.values()) };
    }

    case 'delete_titulo': {
      const id = String(args.titulo_id ?? '');
      if (!id) throw new Error('titulo_id é obrigatório');
      const { error } = await supabase.from('titulos').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, titulo_id: id };
    }

    default:
      throw new Error(`Tool desconhecida: ${name}`);
  }
}
