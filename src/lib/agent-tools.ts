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
    description: 'Cria um novo produto (sem BOM ainda — adicione com add_bom_item depois).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name: { type: 'STRING' as Type },
        description: { type: 'STRING' as Type },
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
      'Cria um pedido de saída (controle paralelo ao Conta Azul). Use quando o usuário disser "adiciona pedido X pra sair", "registra a saída de X", "cadastra pedido Y do cliente Z". Pode incluir produtos com qtd e número da NFe.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        client_name: { type: 'STRING' as Type, description: 'Nome do cliente.' },
        numero_nfe: { type: 'STRING' as Type, description: 'Número da NFe (opcional).' },
        data_prevista: {
          type: 'STRING' as Type,
          description: 'Data prevista pra sair, formato ISO YYYY-MM-DD (opcional).',
        },
        notes: { type: 'STRING' as Type, description: 'Observação geral (opcional).' },
        items: {
          type: 'ARRAY' as Type,
          description: 'Itens do pedido. Cada item tem product_name (fuzzy match) ou product_id, e quantity.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              product_name: { type: 'STRING' as Type },
              product_id: { type: 'STRING' as Type },
              quantity: { type: 'NUMBER' as Type },
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
      'Edita campos de um pedido (notes, data_prevista, numero_nfe, client_name). Pra mudar status, prefira mark_shipment_status.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id: { type: 'STRING' as Type },
        client_name: { type: 'STRING' as Type },
        numero_nfe: { type: 'STRING' as Type },
        data_prevista: { type: 'STRING' as Type },
        notes: { type: 'STRING' as Type },
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
        client_name: { type: 'STRING' as Type },
        content: { type: 'STRING' as Type },
      },
      required: ['content'],
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
  {
    name: 'add_shipment_items',
    description:
      'Adiciona itens (produto + qtd) a um pedido existente. Use product_name (fuzzy) ou product_id. Se o produto já estiver no pedido, atualiza a quantidade.',
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
              product_id: { type: 'STRING' as Type },
              quantity: { type: 'NUMBER' as Type },
            },
            required: ['quantity'],
          },
        },
      },
      required: ['shipment_id', 'items'],
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
 * Resolve um shipment_id a partir dos args (id direto, nfe ou client_name fuzzy).
 * Retorna string com o id quando há resolução única, ou objeto ambiguous com candidatos.
 */
async function resolveShipmentId(
  args: any
): Promise<
  | string
  | {
      ambiguous: true;
      message: string;
      candidates: { shipment_id: string; client_name: string; numero_nfe: string | null; status: string }[];
    }
> {
  if (args.shipment_id) return String(args.shipment_id);

  let query = supabase
    .from('shipments')
    .select('id, client_name, numero_nfe, status')
    .order('created_at', { ascending: false })
    .limit(20);
  if (args.numero_nfe) query = query.ilike('numero_nfe', `%${String(args.numero_nfe)}%`);
  if (args.client_name) query = query.ilike('client_name', `%${String(args.client_name)}%`);
  if (!args.numero_nfe && !args.client_name) {
    throw new Error('Forneça shipment_id OU numero_nfe OU client_name');
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const matches = (data ?? []) as any[];
  if (matches.length === 0) {
    throw new Error(
      `Nenhum pedido encontrado com${args.numero_nfe ? ` NFe "${args.numero_nfe}"` : ''}${
        args.client_name ? ` cliente "${args.client_name}"` : ''
      }.`
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
          'id, title, status, created_at, product:products(name), invites:quotation_invites(id, status)'
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
            'id, title, status, payment_terms, public_token, created_at, usd_brl_rate, product:products(name)'
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
      const payload: any = {
        client_name: clientName,
        numero_nfe: args.numero_nfe ? String(args.numero_nfe).trim() : null,
        data_prevista: args.data_prevista ? String(args.data_prevista) : null,
        notes: args.notes ? String(args.notes).trim() : null,
      };
      const { data: created, error } = await supabase
        .from('shipments')
        .insert(payload)
        .select('id, client_name, numero_nfe, status')
        .single();
      if (error || !created) throw new Error(error?.message ?? 'Falha ao criar pedido');
      const shipmentId = (created as any).id as string;

      const itemsInput: Array<{ product_name?: string; product_id?: string; quantity: number }> =
        Array.isArray(args.items) ? args.items : [];
      const itemsAdded: any[] = [];
      const itemsFailed: any[] = [];
      for (const it of itemsInput) {
        let productId = it.product_id ? String(it.product_id) : '';
        if (!productId && it.product_name) {
          const found = await findProductByName(String(it.product_name));
          if (!found) {
            itemsFailed.push({ product_name: it.product_name, error: 'Produto não encontrado' });
            continue;
          }
          productId = found.id;
        }
        if (!productId) {
          itemsFailed.push({ error: 'item sem product_id nem product_name' });
          continue;
        }
        const qty = Number(it.quantity);
        if (!(qty > 0)) {
          itemsFailed.push({ product_name: it.product_name, error: 'quantity inválido' });
          continue;
        }
        const { error: insErr } = await supabase
          .from('shipment_items')
          .insert({ shipment_id: shipmentId, product_id: productId, quantity: qty });
        if (insErr) {
          itemsFailed.push({ product_name: it.product_name, error: insErr.message });
        } else {
          itemsAdded.push({ product_id: productId, product_name: it.product_name, quantity: qty });
        }
      }
      return { created, items_added: itemsAdded, items_failed: itemsFailed };
    }

    case 'list_shipments': {
      const limit = Number(args.limit ?? 50);
      let q = supabase
        .from('shipments')
        .select('id, client_name, numero_nfe, status, data_prevista, data_saida, data_retorno, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (args.status) q = q.eq('status', String(args.status));
      if (args.client_name) q = q.ilike('client_name', `%${String(args.client_name)}%`);
      if (args.nfe) q = q.ilike('numero_nfe', `%${String(args.nfe)}%`);
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
          .select('id, quantity, product:products(id, name)')
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
      const payload: any = { status: newStatus, updated_at: new Date().toISOString() };
      if (newStatus === 'shipped') payload.data_saida = new Date().toISOString();
      if (newStatus === 'returned') payload.data_retorno = new Date().toISOString();
      const { error } = await supabase.from('shipments').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, shipment_id: id, new_status: newStatus };
    }

    case 'update_shipment': {
      const id = String(args.shipment_id ?? '');
      if (!id) throw new Error('shipment_id é obrigatório');
      const payload: any = { updated_at: new Date().toISOString() };
      if (args.client_name) payload.client_name = String(args.client_name).trim();
      if (args.numero_nfe !== undefined) {
        payload.numero_nfe = args.numero_nfe ? String(args.numero_nfe).trim() : null;
      }
      if (args.data_prevista !== undefined) {
        payload.data_prevista = args.data_prevista ? String(args.data_prevista) : null;
      }
      if (args.notes !== undefined) {
        payload.notes = args.notes ? String(args.notes).trim() : null;
      }
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

    case 'add_shipment_items': {
      const id = String(args.shipment_id ?? '');
      if (!id) throw new Error('shipment_id é obrigatório');
      const itemsInput: Array<{ product_name?: string; product_id?: string; quantity: number }> =
        Array.isArray(args.items) ? args.items : [];
      if (itemsInput.length === 0) throw new Error('items é obrigatório');
      const added: any[] = [];
      const failed: any[] = [];
      for (const it of itemsInput) {
        let productId = it.product_id ? String(it.product_id) : '';
        if (!productId && it.product_name) {
          const found = await findProductByName(String(it.product_name));
          if (!found) {
            failed.push({ product_name: it.product_name, error: 'Produto não encontrado' });
            continue;
          }
          productId = found.id;
        }
        if (!productId) {
          failed.push({ error: 'item sem product_id nem product_name' });
          continue;
        }
        const qty = Number(it.quantity);
        if (!(qty > 0)) {
          failed.push({ product_name: it.product_name, error: 'quantity inválido' });
          continue;
        }
        // Verifica se produto já está no pedido — se sim, atualiza (idempotente)
        const { data: existing } = await supabase
          .from('shipment_items')
          .select('id')
          .eq('shipment_id', id)
          .eq('product_id', productId)
          .maybeSingle();
        if (existing) {
          const { error: upErr } = await supabase
            .from('shipment_items')
            .update({ quantity: qty })
            .eq('id', (existing as any).id);
          if (upErr) failed.push({ product_name: it.product_name, error: upErr.message });
          else
            added.push({
              action: 'updated',
              product_id: productId,
              product_name: it.product_name,
              quantity: qty,
            });
        } else {
          const { error: insErr } = await supabase
            .from('shipment_items')
            .insert({ shipment_id: id, product_id: productId, quantity: qty });
          if (insErr) failed.push({ product_name: it.product_name, error: insErr.message });
          else
            added.push({
              action: 'created',
              product_id: productId,
              product_name: it.product_name,
              quantity: qty,
            });
        }
      }
      return { items_processed: added, items_failed: failed };
    }

    default:
      throw new Error(`Tool desconhecida: ${name}`);
  }
}
