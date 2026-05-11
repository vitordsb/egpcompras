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
import { todayBR } from '@/lib/dates';
import type { Type } from '@google/genai';
import {
  exportComponentsByProduct,
  exportComponentsGeneral,
  type ExportBomLink,
} from '@/routes/admin/components-pdf';
import type { Component } from '@/types/db';


// ===== Schemas (declarations) =============================================

export const toolDeclarations = [
  // ---------- LEITURAS ----------
  {
    name: 'list_products',
    description:
      'Lista produtos cadastrados (id, nome, custo unitário total, custo de fabricação, custo de acervo, preço de venda, product_type). Cada produto tem 2 subtotais: fabricacao_cost_brl (componentes da placa) + acervo_cost_brl (embalagem/etiqueta/caixa/manual). Soma = unit_cost_brl total.',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'find_product_by_name',
    description:
      'Busca produto por nome aproximado. Retorna o melhor match com BOM completa (componentes, qtd, valor unit, tipo=fabricacao|acervo) + outros matches. Use o campo `tipo` em cada item para distinguir componentes da placa (fabricacao) de embalagem/etiqueta (acervo).',
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
      'Retorna dados completos de um produto pelo id: nome, descrição, modo de markup, custo total (unit_cost_brl), custo separado de fabricação (fabricacao_cost_brl) e acervo (acervo_cost_brl), preço de venda, BOM detalhada com `tipo` em cada item. Use sempre que precisar comparar custo de fabricação vs acervo, ou quando o usuário perguntar "quanto custa a embalagem do X" / "qual o custo total da placa do X".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { product_id: { type: 'STRING' as Type } },
      required: ['product_id'],
    },
  },
  {
    name: 'set_product_kit',
    description:
      'Cria ou atualiza a composição de um kit de produto. ' +
      'O kit_product_name deve ser um produto já existente. ' +
      'component_products é a lista de produtos que compõem o kit, cada um com nome e quantidade. ' +
      'Use para "cria o kit EGP Plug In com a 20V (1 un) e o módulo WiFi (1 un)".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        kit_product_name: { type: 'STRING' as Type, description: 'Nome do produto que será o kit.' },
        component_products: {
          type: 'ARRAY' as Type,
          description: 'Produtos que compõem o kit.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              product_name: { type: 'STRING' as Type, description: 'Nome do produto componente.' },
              quantity:     { type: 'NUMBER' as Type, description: 'Quantidade deste componente no kit (default 1).' },
            },
            required: ['product_name'],
          },
        },
      },
      required: ['kit_product_name', 'component_products'],
    },
  },
  {
    name: 'get_kit_components',
    description: 'Lista os produtos que compõem um kit e o custo total calculado.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        kit_product_name: { type: 'STRING' as Type },
      },
      required: ['kit_product_name'],
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

  // ---------- META — AUTO-VALIDAÇÃO ----------
  {
    name: 'verify_records_exist',
    description:
      'Valida que registros que VOCÊ acabou de criar/atualizar realmente existem no banco. ' +
      'Use SEMPRE depois de operações em lote (criou 5 pedidos, registrou 3 títulos) ou em ações isoladas críticas (financeira, RMA com valor, deleção) ANTES de confirmar sucesso ao usuário. ' +
      'Você passa uma lista de "claims" (afirmações que pretende fazer) e a tool verifica cada uma. ' +
      'Resposta: { all_verified: bool, results: [{claim, exists, found_data, error}] }. Se all_verified=false, NÃO afirme sucesso — reporte o que falhou.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        claims: {
          type: 'ARRAY' as Type,
          description: 'Lista de afirmações a validar.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              entity: {
                type: 'STRING' as Type,
                description: 'Tipo: shipment, rma, titulo, production_order, component, product, bom_item, stock_item, financeira',
              },
              by_id: {
                type: 'STRING' as Type,
                description: 'UUID do registro (preferido quando disponível).',
              },
              by_field: {
                type: 'STRING' as Type,
                description: 'Nome do campo de busca (ex: "numero_venda", "numero_nfe", "numero", "name", "client_name").',
              },
              by_value: {
                type: 'STRING' as Type,
                description: 'Valor do campo (ex: "5807" para numero_venda, "Eletrificador 12V" para name).',
              },
            },
            required: ['entity'],
          },
        },
      },
      required: ['claims'],
    },
  },

  // ---------- AÇÕES — RELATÓRIOS ----------
  {
    name: 'export_components_pdf',
    description:
      'Gera e baixa o relatório PDF de componentes (dispara download no navegador do usuário). ' +
      'Sem product_name: catálogo geral com todos os componentes. ' +
      'Com product_name: composição de um produto específico, em 2 tabelas (placa eletrônica + placa+acervo). ' +
      'O parâmetro exclude_items permite remover componentes pelo nome aproximado antes de gerar — útil pra "manda relatório do 12V sem o gabinete e sem os custos fixos". ' +
      'A exclusão É PERSISTIDA (desmarca o checkbox "PDF" daquele item no banco), ou seja, da próxima vez também não vai aparecer até que o usuário re-marque.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_name: {
          type: 'STRING' as Type,
          description: 'Nome do produto (fuzzy). Omitir gera o catálogo geral de componentes.',
        },
        exclude_items: {
          type: 'ARRAY' as Type,
          items: { type: 'STRING' as Type },
          description: 'Lista de nomes/keywords de componentes a OMITIR do PDF. Ex: ["gabinete","custos fixos"]. Match aproximado por substring no nome do componente daquele produto. Só funciona com product_name informado.',
        },
        reset_visibility: {
          type: 'BOOLEAN' as Type,
          description: 'Default false. Se true, marca TODOS os itens do produto como visíveis antes de aplicar exclude_items. Use só se o usuário pedir explicitamente "manda completo, mas sem X" e você não tem certeza do estado atual.',
        },
      },
    },
  },

  // ---------- ESCRITAS — COMPONENTES ----------
  {
    name: 'create_component',
    description: 'Cria UM componente no catálogo. Pra criar vários de uma vez, prefira bulk_create_components. Detecte automaticamente mount_type pelo nome: "SMD" no texto → "SMD"; "PTH" no texto → "PTH". Pacotes 0402/0603/0805/1206 são quase sempre SMD.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name: { type: 'STRING' as Type },
        mount_type: { type: 'STRING' as Type, description: '"SMD" (superfície) ou "PTH" (furo passante). Opcional. Detecte do nome do componente sempre que possível.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'bulk_create_components',
    description:
      'Cria VÁRIOS componentes em uma única chamada (mais eficiente). Use sempre que o usuário pedir pra cadastrar mais de um. Para cada item, detecte mount_type pelo nome (SMD, PTH, 0402/0603/0805/1206 = SMD).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        components: {
          type: 'ARRAY' as Type,
          description: 'Lista de componentes a criar. Cada um pode ter mount_type opcional.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              name: { type: 'STRING' as Type },
              mount_type: { type: 'STRING' as Type, description: '"SMD" ou "PTH" (opcional).' },
            },
            required: ['name'],
          },
        },
        names: {
          type: 'ARRAY' as Type,
          items: { type: 'STRING' as Type },
          description: 'Forma legada — apenas nomes. Use `components` quando precisar passar mount_type.',
        },
      },
    },
  },
  {
    name: 'update_component',
    description: 'Atualiza nome e/ou mount_type (SMD/PTH) de um componente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        component_id: { type: 'STRING' as Type },
        name: { type: 'STRING' as Type },
        mount_type: { type: 'STRING' as Type, description: '"SMD", "PTH" ou null/string vazia para limpar.' },
      },
      required: ['component_id'],
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
    description:
      'Cria um novo produto. ' +
      'Para fabricação (tem BOM): product_type="fabricacao" — use setup_product_bom para criar com BOM completa. ' +
      'Para revenda (sem BOM): product_type="revenda", informe direct_cost_brl e unit (kg, rolo, metro, un, cx...).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name:            { type: 'STRING' as Type },
        description:     { type: 'STRING' as Type, description: 'Informações complementares (revenda) ou descrição comercial (fabricação).' },
        product_type:    { type: 'STRING' as Type, description: '"fabricacao" ou "revenda".' },
        unit:            { type: 'STRING' as Type, description: 'Unidade de medida para revenda. Ex: kg, rolo, metro, caixa, un.' },
        direct_cost_brl: { type: 'NUMBER' as Type,  description: 'Custo direto em R$ para produtos de revenda (sem BOM).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_product',
    description:
      'Atualiza dados de um produto. Use pricing_mode pra mudar markup (markup_30, markup_50, ponto_7, custom). ' +
      'Para revenda: pode atualizar direct_cost_brl e unit.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_id:      { type: 'STRING' as Type },
        name:            { type: 'STRING' as Type },
        description:     { type: 'STRING' as Type },
        pricing_mode:    { type: 'STRING' as Type, description: '"markup_30" | "markup_50" | "ponto_7" | "custom"' },
        custom_markup_pct: { type: 'NUMBER' as Type },
        unit:            { type: 'STRING' as Type, description: 'Unidade de medida (revenda).' },
        direct_cost_brl: { type: 'NUMBER' as Type,  description: 'Custo direto (revenda).' },
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
      'Adiciona um componente à BOM de um produto. Pode usar component_id OU component_name (faz fuzzy match). Use tipo="acervo" para itens de embalagem/etiqueta/caixa/manual; default "fabricacao" (componente da placa).',
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
        tipo: {
          type: 'STRING' as Type,
          description: '"fabricacao" (default — componente da placa, eletrônico) ou "acervo" (embalagem, etiqueta, caixa, manual, gabinete).',
        },
      },
      required: ['product_id', 'quantity'],
    },
  },
  {
    name: 'update_bom_item',
    description:
      'Atualiza qty, valor unit ou tipo (fabricacao/acervo) de uma linha da BOM. Use bom_item_id (preferido, vem de get_product_details/find_product_by_name) OU passe product_id + component_name pra fuzzy match. Se houver ambiguidade no nome, retorna a lista de candidatos.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        bom_item_id: { type: 'STRING' as Type },
        product_id: { type: 'STRING' as Type, description: 'Use junto com component_name quando não tiver bom_item_id.' },
        component_name: { type: 'STRING' as Type, description: 'Match aproximado por substring no nome do componente.' },
        quantity: { type: 'NUMBER' as Type },
        value_unit: { type: 'NUMBER' as Type },
        tipo: {
          type: 'STRING' as Type,
          description: '"fabricacao" (componente da placa) ou "acervo" (embalagem, etiqueta, caixa, manual, gabinete).',
        },
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
      'Define ou redefine a BOM completa de um produto de uma vez. Cria o produto se não existir. Para cada componente: busca no catálogo por nome/SKU (fuzzy); se não encontrar, cria automaticamente. Aceita preço-alvo (target_price_brl) por componente — usado no cálculo de custo do produto. Use quando o usuário disser "o produto X usa os componentes A, B, C" ou listar componentes com preços ao lado.',
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
          description: 'Lista completa de componentes do produto. Inclua target_price_brl se o usuário informou preços.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              name:     { type: 'STRING' as Type, description: 'Nome do componente.' },
              sku:      { type: 'STRING' as Type, description: 'SKU/código (opcional).' },
              quantity: { type: 'NUMBER' as Type, description: 'Quantidade por unidade do produto.' },
              unit:     { type: 'STRING' as Type, description: 'Unidade (opcional, default un).' },
              target_price_brl: { type: 'NUMBER' as Type, description: 'Preço-alvo unitário em BRL (opcional). Se o usuário disse "Resistor 10k R$ 0,12", passe 0.12 aqui.' },
              tipo:     { type: 'STRING' as Type, description: '"fabricacao" (componente da placa — default) ou "acervo" (embalagem, etiqueta, caixa, manual).' },
              mount_type: { type: 'STRING' as Type, description: '"SMD" ou "PTH" (opcional). Detecte do nome: "Resistor 1K 0603 SMD" → "SMD". Pacotes 0402/0603/0805/1206 indicam SMD.' },
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
    description: 'Cadastra um fornecedor. Nome é obrigatório; email, CNPJ, endereço e WhatsApp são opcionais.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name:             { type: 'STRING' as Type, description: 'Nome da empresa (obrigatório).' },
        email:            { type: 'STRING' as Type, description: 'Email comercial (opcional).' },
        cnpj:             { type: 'STRING' as Type, description: 'CNPJ (opcional).' },
        address:          { type: 'STRING' as Type, description: 'Endereço (opcional).' },
        default_currency: { type: 'STRING' as Type, description: '"BRL" ou "USD". Default BRL.' },
        whatsapp_phone:   { type: 'STRING' as Type, description: 'Número WhatsApp do contato comercial. Ex: "11 98765-4321".' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_supplier',
    description: 'Atualiza dados de um fornecedor.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        supplier_id:      { type: 'STRING' as Type },
        name:             { type: 'STRING' as Type },
        email:            { type: 'STRING' as Type },
        cnpj:             { type: 'STRING' as Type },
        address:          { type: 'STRING' as Type },
        default_currency: { type: 'STRING' as Type },
        whatsapp_phone:   { type: 'STRING' as Type, description: 'Número WhatsApp do contato comercial.' },
      },
      required: ['supplier_id'],
    },
  },
  {
    name: 'send_quote_request_whatsapp',
    description: 'Cria cotação no banco, gera link do fornecedor e envia via WhatsApp. Aceita supplier_id (de list_suppliers) OU phone direto. Para cotações, NUNCA use find_whatsapp_contact — use list_suppliers.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        supplier_id:   { type: 'STRING' as Type, description: 'ID do fornecedor em suppliers (use list_suppliers para encontrar). Obrigatório se phone não for passado.' },
        phone:         { type: 'STRING' as Type, description: 'Número WhatsApp direto (ex: "11 93957-2807"). Use quando o usuário fornecer o número na mensagem. A tool salva o número no fornecedor automaticamente.' },
        supplier_name: { type: 'STRING' as Type, description: 'Nome do fornecedor — obrigatório quando usar phone sem supplier_id.' },
        items: {
          type: 'ARRAY' as Type,
          description: 'Lista de itens para cotar.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              name:     { type: 'STRING' as Type, description: 'Nome do componente/material.' },
              quantity: { type: 'NUMBER' as Type, description: 'Quantidade necessária.' },
              unit:     { type: 'STRING' as Type, description: 'Unidade (ex: "un", "kg", "m"). Default "un".' },
            },
            required: ['name', 'quantity'],
          },
        },
        notes:          { type: 'STRING' as Type, description: 'Observações internas (prazo desejado, qualidade, etc.) — aparece na mensagem.' },
        deadline_days:  { type: 'NUMBER' as Type, description: 'Prazo em dias para resposta. Default 5.' },
        title:          { type: 'STRING' as Type, description: 'Título da cotação. Se omitido, gerado automaticamente.' },
        custom_message: { type: 'STRING' as Type, description: 'Texto personalizado da mensagem WhatsApp. Se fornecido, substitui o texto padrão formal.' },
      },
      required: ['items'],
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

  // ---------- RH — RESTRITO (vitor@grupoegp / joane@grupoegp) -----------
  {
    name: 'list_prestadores',
    description: '[RH EXCLUSIVO] Lista prestadores. status="PRESTADOR" (ativos, default) ou "FINALIZADO" ou "todos".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        status: { type: 'STRING' as Type, description: '"PRESTADOR" | "FINALIZADO" | "todos".' },
      },
    },
  },
  {
    name: 'get_prestador',
    description: '[RH EXCLUSIVO] Retorna dados completos de um prestador pelo nome (fuzzy).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name: { type: 'STRING' as Type, description: 'Nome ou parte do nome.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_prestador',
    description: '[RH EXCLUSIVO] Atualiza dados de um prestador (salário, transporte, banco, pix, status, etc.).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name:              { type: 'STRING' as Type, description: 'Nome (fuzzy match).' },
        valor_prestacao:   { type: 'NUMBER' as Type },
        conducao:          { type: 'NUMBER' as Type },
        carro:             { type: 'NUMBER' as Type },
        almoco_horario:    { type: 'STRING' as Type },
        status:            { type: 'STRING' as Type, description: '"PRESTADOR" ou "FINALIZADO".' },
        aniversario:       { type: 'STRING' as Type, description: 'YYYY-MM-DD.' },
        cpf:               { type: 'STRING' as Type },
        banco:             { type: 'STRING' as Type },
        agencia:           { type: 'STRING' as Type },
        conta:             { type: 'STRING' as Type },
        pix:               { type: 'STRING' as Type },
        observacoes:       { type: 'STRING' as Type },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_prestador',
    description: '[RH EXCLUSIVO] Cadastra um novo prestador.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        nome:            { type: 'STRING' as Type },
        valor_prestacao: { type: 'NUMBER' as Type },
        conducao:        { type: 'NUMBER' as Type },
        carro:           { type: 'NUMBER' as Type },
        almoco_horario:  { type: 'STRING' as Type },
        cpf:             { type: 'STRING' as Type },
        banco:           { type: 'STRING' as Type },
        agencia:         { type: 'STRING' as Type },
        conta:           { type: 'STRING' as Type },
        pix:             { type: 'STRING' as Type },
        observacoes:     { type: 'STRING' as Type },
      },
      required: ['nome'],
    },
  },

  // ---------- FORNECEDORES POR COMPONENTE --------------------------------
  {
    name: 'get_component_suppliers',
    description: 'Retorna todos os fornecedores vinculados a um componente, indicando qual é o preferido. Use ANTES de registrar necessidade de compra de componente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        component_name: { type: 'STRING' as Type, description: 'Nome ou parte do nome do componente.' },
      },
      required: ['component_name'],
    },
  },
  {
    name: 'set_component_supplier',
    description: 'Vincula fornecedor a componente. is_preferred=true = fornecedor padrão para esse componente (um por componente).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        component_name:  { type: 'STRING' as Type },
        supplier_name:   { type: 'STRING' as Type, description: 'Nome do fornecedor (fuzzy match).' },
        is_preferred:    { type: 'BOOLEAN' as Type, description: 'true = fornecedor preferido para este componente.' },
        notes:           { type: 'STRING' as Type, description: 'Observação opcional (ex: "prazo 7 dias", "só vende em lote de 100").' },
      },
      required: ['component_name', 'supplier_name'],
    },
  },
  {
    name: 'remove_component_supplier',
    description: 'Remove o vínculo entre um componente e um fornecedor.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        component_name: { type: 'STRING' as Type },
        supplier_name:  { type: 'STRING' as Type },
      },
      required: ['component_name', 'supplier_name'],
    },
  },

  // ---------- COTAÇÃO DE LISTA LIVRE -------------------------------------
  {
    name: 'create_quotation_from_list',
    description: 'Cotação de lista avulsa de componentes (falta comprar, lista livre). auto_invite_preferred=true convida o fornecedor preferido de cada item automaticamente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        items: {
          type: 'ARRAY' as Type,
          description: 'Lista de componentes para cotar.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              name:             { type: 'STRING' as Type, description: 'Nome do componente.' },
              quantity:         { type: 'NUMBER' as Type, description: 'Quantidade a cotar.' },
              target_price_brl: { type: 'NUMBER' as Type, description: 'Preço alvo em BRL (opcional).' },
            },
            required: ['name', 'quantity'],
          },
        },
        title:                    { type: 'STRING' as Type, description: 'Título da cotação (opcional).' },
        deadline_days:            { type: 'NUMBER' as Type, description: 'Prazo em dias a partir de hoje (default 5).' },
        auto_invite_preferred:    { type: 'BOOLEAN' as Type, description: 'true = convida automaticamente o fornecedor preferido de cada componente.' },
        additional_supplier_names: {
          type: 'ARRAY' as Type,
          items: { type: 'STRING' as Type },
          description: 'Nomes de fornecedores adicionais a convidar (além dos preferidos automáticos).',
        },
      },
      required: ['items'],
    },
  },

  // ---------- ANÁLISE DE COTAÇÕES ----------------------------------------
  {
    name: 'analyze_quotation_responses',
    description: 'Analisa respostas de cotação. mode="full" = todos fornecedores × itens. mode="best_price" = menor preço por item + segundo melhor.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        quotation_id: { type: 'STRING' as Type },
        mode:         { type: 'STRING' as Type, description: '"full" (default) ou "best_price".' },
      },
      required: ['quotation_id'],
    },
  },
  {
    name: 'get_component_price_history',
    description: 'Retorna histórico de preços de um componente através das cotações respondidas. Mostra variação % em relação à cotação anterior.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        component_name: { type: 'STRING' as Type },
        limit:          { type: 'NUMBER' as Type, description: 'Máximo de registros (default 10).' },
      },
      required: ['component_name'],
    },
  },
  {
    name: 'check_expired_quotations',
    description: 'Lista cotações vencidas sem resposta e cria notas de follow-up nos purchase_needs.',
    parameters: { type: 'OBJECT' as Type, properties: {} },
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
    name: 'search_memories',
    description:
      'Busca memórias persistentes que contenham uma palavra-chave. Use SEMPRE que uma busca no banco retornar vazio ou inconclusivo para um produto, material ou pedido específico — pode haver notas salvas na memória que complementam ou contradizem o resultado do banco.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        keyword: {
          type: 'STRING' as Type,
          description: 'Palavra-chave pra buscar. Ex: "Controle 2 Botões", "chapinha", "fornecedor X atraso".',
        },
      },
      required: ['keyword'],
    },
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

  // ---------- WHATSAPP (envio e consulta via agente interno) ----------
  {
    name: 'save_whatsapp_contact',
    description: 'Salva ou atualiza contato WhatsApp. Se já existir contato com o mesmo NÚMERO, atualiza o nome (caso "atualiza o contato do número X para Y"). Se já existir com mesmo NOME, atualiza o número. Senão cria novo. Use também para "atualiza o contato do número 11 93957-2807 para Felipe da Enbracon".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name:  { type: 'STRING' as Type, description: 'Nome ou apelido do contato. Ex: "Felipe Enbracon".' },
        phone: { type: 'STRING' as Type, description: 'Número de telefone. Ex: "11 93957-2807" ou "5511939572807".' },
        notes: { type: 'STRING' as Type, description: 'Observações opcionais (empresa, cargo, etc.).' },
      },
      required: ['name', 'phone'],
    },
  },
  {
    name: 'find_whatsapp_contact',
    description: 'Busca um contato WhatsApp pelo nome (busca aproximada). Chame ANTES de send_whatsapp_message quando o usuário mencionar um nome de pessoa em vez de número.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name: { type: 'STRING' as Type, description: 'Nome ou parte do nome. Ex: "Felipe", "enbracon".' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_whatsapp_contacts',
    description: 'Lista todos os contatos WhatsApp cadastrados.',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'send_whatsapp_message',
    description: 'Envia uma mensagem de texto pelo WhatsApp. Se o usuário mencionar um nome em vez de número, chame find_whatsapp_contact antes para resolver o número.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        phone:   { type: 'STRING' as Type, description: 'Número do destinatário. Pode ser com ou sem DDI — ex: "11 93957-2807" ou "5511939572807".' },
        message: { type: 'STRING' as Type, description: 'Texto da mensagem a enviar. Pode usar formatação WhatsApp (*negrito*, _itálico_).' },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'send_whatsapp_broadcast',
    description: 'Envia a MESMA mensagem livre para vários destinatários. Aceita nomes (busca em client_contacts e whatsapp_contacts) ou números diretos. ATENÇÃO: só funciona para destinatários que mandaram mensagem nas últimas 24h. Para promoções fora da janela use send_whatsapp_broadcast_template.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        recipients: {
          type: 'ARRAY' as Type,
          description: 'Lista de nomes (ex: "João", "Maria Silva") OU números (ex: "11939572807").',
          items: { type: 'STRING' as Type },
        },
        message: { type: 'STRING' as Type, description: 'Texto da mensagem (até 4096 chars). Pode usar formatação WhatsApp (*negrito*, _itálico_).' },
      },
      required: ['recipients', 'message'],
    },
  },
  {
    name: 'send_whatsapp_broadcast_template',
    description: 'Envia um TEMPLATE APROVADO pela Meta para vários destinatários. Funciona a qualquer hora, sem janela de 24h. Use para promoções, avisos em massa, comunicados.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        recipients: {
          type: 'ARRAY' as Type,
          description: 'Lista de nomes ou números. Nomes resolvidos via client_contacts/whatsapp_contacts.',
          items: { type: 'STRING' as Type },
        },
        template_name: { type: 'STRING' as Type, description: 'Nome do template aprovado na Meta (ex: "promo_geral").' },
        template_params: {
          type: 'ARRAY' as Type,
          description: 'Valores das variáveis do template em ordem ({{1}}, {{2}}, ...). Suporta placeholders {{name}} e {{first_name}} substituídos por destinatário.',
          items: { type: 'STRING' as Type },
        },
        template_lang: { type: 'STRING' as Type, description: 'Código do idioma. Default: pt_BR.' },
      },
      required: ['recipients', 'template_name'],
    },
  },
  {
    name: 'generate_holiday_flyer',
    description:
      'Cria um flyer comemorativo da EGP usando IA (Flux/dev — melhor renderização de texto). ' +
      'Use quando o usuário pedir imagem para datas comemorativas, parabenizações, posts temáticos. ' +
      'Diferente de generate_image: NÃO insere foto de produto; gera a cena temática completa (mãe com filho, papai noel, etc) com TEXTO DESENHADO PELA IA na própria imagem (ex: "Feliz Dia das Mães"). ' +
      'Logo EGP fica em pílula branca no canto inferior esquerdo, sem cobrir o design. ' +
      'Demora ~15-30s (vs 3-5s do schnell). Mostre o preview ao usuário e pergunte se quer salvar (save_marketing_asset) e/ou enviar (send_whatsapp_image).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        holiday: {
          type: 'STRING' as Type,
          description: 'Data/tema. Aceita: "maes", "pais", "namorados", "criancas", "professor", "natal", "ano_novo", "pascoa", "independencia", "consumidor", "consciencia_negra", "black_friday", "aniversario_empresa", "outro". Se "outro", explique no campo custom_theme.',
        },
        custom_theme: {
          type: 'STRING' as Type,
          description: 'Quando holiday="outro": descreva o tema/cena em PT-BR. Ex: "homenagem aos vendedores no dia do trabalho com pessoas trabalhando felizes". A tool traduz pra prompt em inglês.',
        },
        main_text: {
          type: 'STRING' as Type,
          description: 'Texto grande que a IA deve desenhar no flyer (ex: "Feliz Dia das Mães"). Mantenha CURTO (3-5 palavras). A IA do Flux escreve direto na imagem.',
        },
        secondary_text: {
          type: 'STRING' as Type,
          description: 'Texto menor opcional (ex: "12 de Maio" ou frase curta). Mantenha em 1 linha.',
        },
        style: {
          type: 'STRING' as Type,
          description: '"suave" (cores pastel, romântico, sereno) | "vibrante" (cores fortes, animado) | "elegante" (sóbrio, premium) | "festivo" (alegre, colorido). Default: "elegante".',
        },
        color_palette: {
          type: 'STRING' as Type,
          description: 'Paleta de cores predominante. Ex: "pink and rose gold" (dia das mães), "red and green" (natal), "blue and silver" (ano novo). Opcional — a tool sugere baseado em holiday se não passar.',
        },
        image_size: {
          type: 'STRING' as Type,
          description: '"square_hd" (Instagram post, default) | "portrait_4_3" (story) | "landscape_4_3" (banner).',
        },
        reference_image_url: {
          type: 'STRING' as Type,
          description: 'URL de uma imagem de referência (se o user mandou uma referência no chat e quer algo parecido). A tool usa Flux img2img — gera variação do estilo.',
        },
      },
      required: ['holiday', 'main_text'],
    },
  },
  {
    name: 'save_marketing_asset',
    description:
      'Salva uma imagem de marketing já gerada na galeria interna (marketing_assets) pra reutilizar depois. ' +
      'Use quando o usuário gostar de uma imagem que você gerou ("salva essa", "guarda essa pra mandar de novo no ano que vem"). Receba a URL de generate_image / generate_holiday_flyer e armazene com metadata.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        image_url: { type: 'STRING' as Type, description: 'URL retornada por generate_image ou generate_holiday_flyer.' },
        title:     { type: 'STRING' as Type, description: 'Título curto descritivo. Ex: "Dia das Mães 2026 — rosa elegante".' },
        holiday:   { type: 'STRING' as Type, description: 'Data/tema (maes, pais, natal, etc).' },
        tags:      { type: 'ARRAY' as Type, items: { type: 'STRING' as Type }, description: 'Tags livres. Ex: ["rosa", "elegante", "mae-e-filha"].' },
        notes:     { type: 'STRING' as Type, description: 'Observações livres.' },
        prompt_used: { type: 'STRING' as Type, description: 'Prompt usado pra gerar (passe se você lembra; ajuda a refazer variações).' },
        model_used:  { type: 'STRING' as Type, description: 'Modelo usado (vem no retorno de generate_*). Ex: "flux-dev".' },
      },
      required: ['image_url', 'title'],
    },
  },
  {
    name: 'list_marketing_assets',
    description: 'Lista imagens de marketing salvas. Filtros opcionais por holiday e tag.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        holiday: { type: 'STRING' as Type, description: 'Filtra por data (maes, pais, natal...).' },
        tag:     { type: 'STRING' as Type, description: 'Filtra por uma tag específica.' },
        limit:   { type: 'INTEGER' as Type, description: 'Default 30.' },
      },
    },
  },
  {
    name: 'delete_marketing_asset',
    description: 'Remove uma imagem da galeria de marketing.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: { asset_id: { type: 'STRING' as Type } },
      required: ['asset_id'],
    },
  },
  {
    name: 'generate_image',
    description: 'Gera uma imagem promocional com IA e retorna a URL para o usuário aprovar ANTES de enviar. SEMPRE chame esta tool primeiro e mostre o preview. Somente após aprovação chame send_whatsapp_image. A imagem já inclui automaticamente logo EGP e CNPJ. Se product_filename for informado, a foto real do produto aparece na imagem.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        template_id: {
          type: 'STRING' as Type,
          description: '"promocao_produto" | "lancamento" | "liquidacao" | "data_comemorativa" | "institucional" | "agradecimento"',
        },
        product_filename: {
          type: 'STRING' as Type,
          description: 'Nome do arquivo da foto do produto SEM extensão. Disponíveis: Controle2b, Controle2bComSuporte, Controle4bCopiador, Controle4BotoesCromado, Eletrificador12v, FiltroDeLinha, Fonte, moduloSas, moduloWifi, nobreak, nobreakpackdebateria, packbateria, PlacadeAdvertencia, ProtetorDeRede, Sensor Infravermelho, Sensor Magnetico, Sirene, Sirene Magnetica, Voltimetro. Se o usuário mencionar um produto, escolha o filename mais próximo.',
        },
        cor: {
          type: 'STRING' as Type,
          description: 'Cor dominante do fundo. Ex: "blue", "green", "orange", "purple", "red". Default: blue.',
        },
        image_size: {
          type: 'STRING' as Type,
          description: '"square_hd" | "landscape_4_3" | "landscape_16_9". Default: landscape_4_3.',
        },
      },
      required: ['template_id'],
    },
  },
  {
    name: 'send_whatsapp_image',
    description: 'Envia uma imagem já gerada (URL) via WhatsApp para um contato. Chame SOMENTE após o usuário aprovar o preview mostrado por generate_image.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        phone: { type: 'STRING' as Type, description: 'Número ou nome do contato.' },
        image_url: { type: 'STRING' as Type, description: 'URL da imagem gerada anteriormente por generate_image.' },
        caption: { type: 'STRING' as Type, description: 'Legenda que acompanha a imagem no WhatsApp.' },
      },
      required: ['phone', 'image_url', 'caption'],
    },
  },
  {
    name: 'send_marketing_template',
    description: 'Envia um template de marketing salvo para um ou mais contatos via WhatsApp. Se o template não existir, retorna a lista de templates disponíveis. Use quando o usuário pedir para enviar um template pelo nome.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        template_name: { type: 'STRING' as Type, description: 'Nome exato (ou aproximado) do template salvo.' },
        recipients: {
          type: 'ARRAY' as Type,
          description: 'Lista de nomes ou números dos destinatários. Nomes são resolvidos via whatsapp_contacts.',
          items: { type: 'STRING' as Type },
        },
        caption_override: {
          type: 'STRING' as Type,
          description: 'Legenda personalizada para substituir a legenda padrão do template (opcional).',
        },
      },
      required: ['template_name', 'recipients'],
    },
  },
  {
    name: 'list_marketing_templates',
    description: 'Lista todos os templates de marketing salvos. Use antes de send_marketing_template se não souber o nome exato.',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'list_whatsapp_conversations',
    description: 'Lista as conversas WhatsApp recentes com prévia da última mensagem. Use para ver quem entrou em contato ou antes de enviar uma mensagem.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        limit: { type: 'NUMBER' as Type, description: 'Máximo de conversas (padrão 10).' },
      },
    },
  },
  {
    name: 'get_whatsapp_conversation',
    description: 'Retorna o histórico completo de mensagens de um número específico.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        phone: { type: 'STRING' as Type, description: 'Número do contato.' },
        limit: { type: 'NUMBER' as Type, description: 'Últimas N mensagens (padrão 20).' },
      },
      required: ['phone'],
    },
  },

  // ---------- CLIENTES (CRM/Marketing) ----------
  {
    name: 'list_client_contacts',
    description: 'Lista clientes cadastrados com filtros opcionais. Use para "quem são meus clientes inativos?", "clientes que aceitam promo", etc.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        filter:        { type: 'STRING' as Type, description: '"all" (default), "active" (≤60d), "inactive" (>60d), "no_whatsapp", "opt_in_promo", "opt_in_catalog".' },
        tag:           { type: 'STRING' as Type, description: 'Filtra por tag específica.' },
        limit:         { type: 'NUMBER' as Type, description: 'Máximo de resultados (default 50).' },
      },
    },
  },
  {
    name: 'find_client_contact',
    description: 'Busca um cliente por nome, CNPJ ou WhatsApp (fuzzy). Retorna o melhor match e candidatos.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        query: { type: 'STRING' as Type, description: 'Nome, CNPJ ou WhatsApp do cliente.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_client_contact',
    description: 'Cadastra um cliente novo. Para atualizar existente, use update_client_contact.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name:           { type: 'STRING' as Type, description: 'Razão social (obrigatório).' },
        trade_name:     { type: 'STRING' as Type, description: 'Nome fantasia.' },
        cnpj:           { type: 'STRING' as Type },
        whatsapp_phone: { type: 'STRING' as Type, description: 'Número WhatsApp (com ou sem DDI).' },
        phone:          { type: 'STRING' as Type, description: 'Telefone fixo / contato geral.' },
        email:          { type: 'STRING' as Type },
        address:        { type: 'STRING' as Type },
        notes:          { type: 'STRING' as Type, description: 'Observações internas.' },
        tags:           { type: 'ARRAY' as Type, items: { type: 'STRING' as Type }, description: 'Lista de tags (vip, varejo, etc).' },
        opt_in_promo:   { type: 'BOOLEAN' as Type, description: 'Aceita receber promoções.' },
        opt_in_catalog: { type: 'BOOLEAN' as Type, description: 'Aceita receber catálogo.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_client_contact',
    description: 'Atualiza dados de um cliente existente. Identifique pelo client_id (preferido) ou query (nome/CNPJ/WhatsApp).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        client_id:      { type: 'STRING' as Type, description: 'ID do cliente (use find_client_contact para obter).' },
        query:          { type: 'STRING' as Type, description: 'Alternativa ao client_id: nome, CNPJ ou WhatsApp.' },
        name:           { type: 'STRING' as Type },
        trade_name:     { type: 'STRING' as Type },
        cnpj:           { type: 'STRING' as Type },
        whatsapp_phone: { type: 'STRING' as Type },
        phone:          { type: 'STRING' as Type },
        email:          { type: 'STRING' as Type },
        address:        { type: 'STRING' as Type },
        notes:          { type: 'STRING' as Type },
        opt_in_promo:   { type: 'BOOLEAN' as Type },
        opt_in_catalog: { type: 'BOOLEAN' as Type },
      },
    },
  },
  {
    name: 'tag_client_contact',
    description: 'Adiciona ou remove tags de um cliente. Use para segmentação ("marca como VIP", "remove tag inativo").',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        query:      { type: 'STRING' as Type, description: 'Nome, CNPJ ou WhatsApp do cliente.' },
        client_id:  { type: 'STRING' as Type, description: 'Alternativa ao query.' },
        add_tags:   { type: 'ARRAY' as Type, items: { type: 'STRING' as Type }, description: 'Tags a adicionar.' },
        remove_tags:{ type: 'ARRAY' as Type, items: { type: 'STRING' as Type }, description: 'Tags a remover.' },
      },
    },
  },
  {
    name: 'delete_client_contact',
    description: 'Remove um cliente da lista de contatos. Histórico de pedidos é mantido.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        client_id: { type: 'STRING' as Type },
        query:     { type: 'STRING' as Type, description: 'Alternativa ao client_id.' },
      },
    },
  },

  // ---------- MARCAS PRÓPRIAS (CLICHÊS) ----------
  {
    name: 'list_client_brands',
    description: 'Lista todas as marcas próprias (clichês) cadastradas. Chame ANTES de importar qualquer PDF de pedido para cruzar com os detalhes dos itens.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        active_only: { type: 'BOOLEAN' as Type, description: 'true = só ativas (default true).' },
      },
    },
  },
  {
    name: 'register_client_brand',
    description: 'Cadastra uma marca própria (clichê) de cliente. Use quando o usuário disser "cadastra a marca X do cliente Y" ou "adiciona o clichê HIKTEK".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        brand_name:  { type: 'STRING' as Type, description: 'Nome da marca/clichê. Ex: "HIKTEK", "SUPRASEG". Será usado para detecção automática nos PDFs.' },
        client_name: { type: 'STRING' as Type, description: 'Razão social do cliente (opcional, para referência).' },
        notes:       { type: 'STRING' as Type, description: 'Observações: cores padrão, embalagem especial, etc.' },
      },
      required: ['brand_name'],
    },
  },
  {
    name: 'delete_client_brand',
    description: 'Remove ou desativa uma marca própria cadastrada.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        brand_name: { type: 'STRING' as Type, description: 'Nome da marca a remover.' },
      },
      required: ['brand_name'],
    },
  },
  {
    name: 'get_private_label_orders',
    description: 'Lista pedidos de controles com marca própria (clichê), agrupados por cliente/marca/modelo. Filtro por status (default: pending).',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        status:      { type: 'STRING' as Type, description: 'Filtrar por status do pedido: pending, shipped, etc. Omitir = pending.' },
        client_name: { type: 'STRING' as Type, description: 'Filtrar por cliente específico.' },
        brand_name:  { type: 'STRING' as Type, description: 'Filtrar por marca específica.' },
      },
    },
  },

  // ---------- SAÍDAS / PEDIDOS ----------
  {
    name: 'find_partial_shipment',
    description:
      'Busca pedidos existentes que estejam "incompletos" — NF-e sem número de venda vinculado, ou venda sem NF-e. Use SEMPRE antes de criar um novo pedido quando tiver CNPJ ou nome do cliente: pode ser que já exista metade do registro. Retorna candidatos para o usuário confirmar se é o mesmo pedido.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        client_cnpj:     { type: 'STRING' as Type, description: 'CNPJ do cliente (preferido — mais preciso).' },
        client_name:     { type: 'STRING' as Type, description: 'Nome do cliente (fuzzy match, usado se não tiver CNPJ).' },
        document_type:   { type: 'STRING' as Type, description: '"nfe" — busca vendas sem NF-e | "venda" — busca NF-es sem número de venda.' },
        days_back:       { type: 'NUMBER' as Type, description: 'Quantos dias pra trás buscar (default 90).' },
      },
      required: ['document_type'],
    },
  },
  {
    name: 'link_document_to_shipment',
    description:
      'Vincula uma NF-e a uma venda existente (ou vice-versa) sem criar registro duplicado. Use quando o usuário confirmar que o documento importado corresponde a um pedido já cadastrado.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id:   { type: 'STRING' as Type, description: 'ID do pedido existente a atualizar.' },
        numero_nfe:    { type: 'STRING' as Type, description: 'Número da NF-e a vincular (se for NF-e chegando para uma venda).' },
        numero_venda:  { type: 'STRING' as Type, description: 'Número da venda a vincular (se for venda chegando para uma NF-e).' },
        chave_acesso:  { type: 'STRING' as Type, description: 'Chave de acesso da NF-e (44 dígitos).' },
        data_venda:    { type: 'STRING' as Type, description: 'Data da venda (YYYY-MM-DD), se faltar no registro.' },
        data_prevista: { type: 'STRING' as Type, description: 'Data prevista de saída, se faltar no registro.' },
        valor_total:   { type: 'NUMBER' as Type },
        notes:         { type: 'STRING' as Type },
      },
      required: ['shipment_id'],
    },
  },
  {
    name: 'create_shipment',
    description:
      'Cria um pedido de saída (controle paralelo ao Conta Azul). Use quando o usuário disser "adiciona pedido X pra sair", "registra a saída de X", "cadastra pedido Y do cliente Z", ou ao importar um PDF de venda. Pode incluir produtos com qtd e todos os dados do Conta Azul. ' +
      'CRÍTICO ao importar PDF: extraia TODOS os itens da tabela de produtos do documento. Antes de chamar, conte quantas linhas de produto o PDF tem e passe expected_items_count. A tool valida que items.length === expected_items_count — se não bater, ela falha e o pedido é descartado. Isso impede a perda silenciosa de produtos quando o PDF tem muitos itens.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        client_name:          { type: 'STRING' as Type, description: 'Razão social do cliente (xNome da NF-e).' },
        client_trade_name:    { type: 'STRING' as Type, description: 'Nome fantasia (xFant da NF-e). Preencher quando diferente da razão social.' },
        tipo_nota:            { type: 'STRING' as Type, description: 'Tipo da nota: venda (default) | retorno_conserto | retorno_garantia | remessa_demonstracao | remessa_conserto | remessa_industrializacao | rma | outro.' },
        natureza_operacao:    { type: 'STRING' as Type, description: 'Natureza da operação (ex: "Retorno de conserto", "Venda").' },
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
        expected_items_count: {
          type: 'INTEGER' as Type,
          description: 'OBRIGATÓRIO ao importar PDF: número de linhas de produto que VOCÊ contou no documento. A tool valida que items.length === este valor; se não bater, falha e descarta o pedido. Pra criação manual sem PDF, omita.',
        },
        expected_total: {
          type: 'NUMBER' as Type,
          description: 'OPCIONAL: total esperado do pedido (do PDF). A tool compara contra a soma de quantity*unit_price dos items inseridos. Se diferir mais de 5%, retorna um aviso (não bloqueia).',
        },
        update_if_exists: {
          type: 'BOOLEAN' as Type,
          description: 'Default false. Se true e o pedido já existe (mesma NF-e ou venda+cliente): apaga itens antigos, atualiza cabeçalho e re-insere itens com os dados novos. Use quando o user disser explicitamente "atualiza", "sobrescreve" ou quando o pedido existente está incompleto/errado e o PDF traz dados completos. Se false e duplicata detectada, retorna a comparação old vs new pra você mostrar e perguntar antes de atualizar.',
        },
        items: {
          type: 'ARRAY' as Type,
          description: 'Itens do pedido. Cada item pode ter product_name (fuzzy match), item_code, item_name, unit_price e quantity. OBRIGATÓRIO em vendas (tipo_nota="venda"): pelo menos 1 item.',
          items: {
            type: 'OBJECT' as Type,
            properties: {
              product_name: { type: 'STRING' as Type, description: 'Nome pra fuzzy match no catálogo.' },
              product_id:   { type: 'STRING' as Type, description: 'UUID do produto se já conhecido.' },
              item_code:        { type: 'STRING' as Type, description: 'Código do item no Conta Azul (ex: cod17, EGPADV1).' },
              item_name:        { type: 'STRING' as Type, description: 'Descrição livre do item.' },
              unit_price:       { type: 'NUMBER' as Type, description: 'Valor unitário em R$.' },
              quantity:         { type: 'NUMBER' as Type },
              is_private_label: { type: 'BOOLEAN' as Type, description: 'true se o item for controle com marca própria/clichê detectado.' },
              brand_name:       { type: 'STRING' as Type, description: 'Nome da marca detectada (ex: "HIKTEK"). Preencher quando is_private_label=true.' },
              item_color:       { type: 'STRING' as Type, description: 'Cor do controle extraída do nome (ex: "cinza", "rosa", "preto", "cinza com preto").' },
              item_detail:      { type: 'STRING' as Type, description: 'Texto do campo "Detalhe do item" do PDF (preservar integralmente).' },
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
      'Registra itens que precisam ser comprados. Para itens de pedido de venda: passe shipment_id/numero_venda/client_name. Para componentes de produção (sem pedido de venda vinculado): omita todos os campos de pedido — o registro fica como necessidade de produção geral.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        shipment_id:   { type: 'STRING' as Type, description: 'Opcional — só passar se o item falta para um pedido específico.' },
        numero_venda:  { type: 'STRING' as Type, description: 'Opcional — alternativa ao shipment_id.' },
        client_name:   { type: 'STRING' as Type, description: 'Opcional — alternativa ao shipment_id.' },
        items: {
          type: 'ARRAY' as Type,
          description: 'Lista de itens a comprar.',
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
        note: { type: 'STRING' as Type, description: 'Observação inicial opcional.' },
      },
      required: ['items'],
    },
  },
  {
    name: 'check_component_stock_for_production',
    description:
      'Verifica se o estoque de um componente é suficiente para produzir um produto acabado em relação aos pedidos em aberto. Retorna: estoque atual do componente, quantidade necessária total (somando pedidos pendentes × qtd na BOM), quantos produtos dá pra fazer com o estoque atual, e quanto falta comprar. Use antes de registrar necessidade de compra de componente de produção.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        component_name: { type: 'STRING' as Type, description: 'Nome do componente. Ex: "chapinha", "terminal de bateria".' },
        finished_product_name: { type: 'STRING' as Type, description: 'Produto acabado que usa esse componente. Ex: "Controle 2 Botões".' },
      },
      required: ['component_name', 'finished_product_name'],
    },
  },
  // ---------- ALIASES DE NOMES ----------------------------------------
  {
    name: 'find_similar_stock_items',
    description:
      'Busca itens no estoque com nomes parecidos ao termo informado. Use SEMPRE antes de verificar quantidade de estoque para um item específico — se retornar múltiplos candidatos, pergunte ao usuário quais são o mesmo produto antes de prosseguir.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        name: { type: 'STRING' as Type, description: 'Nome ou parte do nome do item. Ex: "controle 2 botões".' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_item_alias',
    description:
      'Registra um nome alternativo (alias) para um item de estoque. Use quando o usuário confirmar que dois nomes se referem ao mesmo produto. Após registrar, buscas pelo alias vão encontrar o item canônico automaticamente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        canonical_item_name: { type: 'STRING' as Type, description: 'Nome canônico do item no estoque (como está cadastrado).' },
        alias:               { type: 'STRING' as Type, description: 'Nome alternativo a registrar. Ex: "Controle 2 Botões Clichê".' },
      },
      required: ['canonical_item_name', 'alias'],
    },
  },
  {
    name: 'list_item_aliases',
    description: 'Lista todos os aliases cadastrados. Útil para gerenciar ou verificar equivalências de nomes.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        item_name: { type: 'STRING' as Type, description: 'Filtrar por nome do item canônico (opcional).' },
      },
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
    name: 'get_bom_stock_status',
    description:
      'Retorna a BOM completa de um produto com o estoque atual de cada componente — em UMA única chamada eficiente. Use SEMPRE que o usuário perguntar "quais componentes temos em estoque para o produto X", "lista os componentes da 12v com estoque", "situação do estoque da BOM do produto Y". NÃO use get_stock_report em loop para isso.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        product_name: { type: 'STRING' as Type, description: 'Nome ou parte do nome do produto (fuzzy).' },
      },
      required: ['product_name'],
    },
  },
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
    description: 'Define estoque mínimo de um item. Abaixo desse valor o item aparece como crítico.',
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
    description: 'Lista itens com saldo negativo, zerado ou abaixo do mínimo. Use para "o que está em falta?" ou monitoramento.',
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
    description: 'Gera lista de compras cruzando estoque + reservas + pedidos pendentes. Retorna texto pronto para enviar ao fornecedor.',
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
  // ---------- SINÔNIMOS DE BUSCA ----------
  {
    name: 'add_item_synonym',
    description:
      'Cadastra um sinônimo customizado da empresa pra busca por itens. ' +
      'Use quando notar que o usuário busca um termo X mas os itens reais usam termo Y (ex: "fonte" ↔ "carregador"). ' +
      'A busca find_shipments_by_item usa esses sinônimos automaticamente — quem buscar "fonte" também acha "carregador".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        canonical: {
          type: 'STRING' as Type,
          description: 'Termo principal (ex: "fonte"). Será normalizado (lower + sem acentos) antes de salvar.',
        },
        variants: {
          type: 'ARRAY' as Type,
          items: { type: 'STRING' as Type },
          description: 'Lista de sinônimos equivalentes. Ex: ["carregador","alimentador","fontinha"].',
        },
        notes: {
          type: 'STRING' as Type,
          description: 'Contexto/motivo do cadastro (opcional).',
        },
      },
      required: ['canonical', 'variants'],
    },
  },
  {
    name: 'list_item_synonyms',
    description: 'Lista todos os sinônimos cadastrados pra busca de itens.',
    parameters: { type: 'OBJECT' as Type, properties: {} },
  },
  {
    name: 'remove_item_synonym',
    description: 'Remove um sinônimo cadastrado. Use o id (de list_item_synonyms) ou o canonical.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        synonym_id: { type: 'STRING' as Type, description: 'UUID do sinônimo (preferido).' },
        canonical:  { type: 'STRING' as Type, description: 'Termo principal — alternativa ao id.' },
      },
    },
  },

  {
    name: 'find_shipments_by_item',
    description:
      'Busca pedidos que contêm um item específico (cabo, sapata, controle, etc). Faz match por substring no nome do item E aplica normalização de plural/singular automaticamente — "cabos" acha "cabo coaxial", "sapatas" acha "base de haste sapata", "luzes" acha "luz de emergência". ' +
      'Use quando o usuário pedir "quais pedidos têm cabo?", "achar pedidos com sapata", "lista pedidos com X". Mostra agrupado por pedido. ' +
      'NÃO use list_shipments — esse não filtra por item; use ESTA tool sempre que o filtro for por produto/item.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        term: {
          type: 'STRING' as Type,
          description: 'Termo a buscar no nome do item. Pode ser singular ou plural — a tool normaliza. Ex: "cabo", "cabos", "sapata", "controle 2 botões".',
        },
        status: {
          type: 'STRING' as Type,
          description: 'Filtro opcional: "pending" (pendentes) | "shipped" (saíram) | "all" (todos). Default: pending.',
        },
        limit: {
          type: 'INTEGER' as Type,
          description: 'Máximo de pedidos retornados (default 50).',
        },
      },
      required: ['term'],
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

  // ─── RMA (Return Merchandise Authorization) ─────────────────────────────────
  {
    name: 'list_rmas',
    description:
      'Lista RMAs (devoluções de cliente). Use pra "quais RMAs estão pendentes?", "RMAs do Mundial Distribuidora", "RMAs em conserto".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        status: { type: 'STRING' as Type, description: 'Filtra por status: recebido | analise | conserto | pronto | devolvido | cancelado.' },
        client_name: { type: 'STRING' as Type, description: 'Filtra por nome de cliente (fuzzy).' },
        tecnico: { type: 'STRING' as Type, description: 'Filtra por nome do técnico.' },
        limit: { type: 'NUMBER' as Type },
      },
    },
  },
  {
    name: 'get_rma_details',
    description:
      'Retorna o RMA completo: cabeçalho + lista de itens (com componentes trocados, status, valor) + observações. Use pra "detalhes do RMA #5", "o que tem no RMA da OS 01050625".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        numero: { type: 'NUMBER' as Type, description: 'Número do RMA (ex: 5).' },
        numero_os: { type: 'STRING' as Type, description: 'Alternativa: número da OS interna.' },
        rma_id: { type: 'STRING' as Type, description: 'UUID do RMA.' },
      },
    },
  },
  {
    name: 'create_rma',
    description:
      'Cria um novo RMA pra um cliente. Use quando o usuário disser "abre um RMA do cliente X", "registra retorno do Mundial". Pode passar itens já no momento da criação.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        client_name: { type: 'STRING' as Type, description: 'Razão social do distribuidor/cliente.' },
        client_cnpj: { type: 'STRING' as Type },
        client_phone: { type: 'STRING' as Type },
        motivo: { type: 'STRING' as Type, description: 'defeito | desistencia | garantia | outro. Default: defeito.' },
        tecnico_nome: { type: 'STRING' as Type },
        tecnico_phone: { type: 'STRING' as Type },
        numero_os: { type: 'STRING' as Type, description: 'Número da OS interna (ex: 01050625).' },
        volume: { type: 'NUMBER' as Type, description: 'Quantos lotes/caixas chegaram.' },
        data_recebido: { type: 'STRING' as Type, description: 'Data de entrada (ISO YYYY-MM-DD).' },
        diagnostico: { type: 'STRING' as Type },
        items: {
          type: 'ARRAY' as Type,
          items: {
            type: 'OBJECT' as Type,
            properties: {
              item_name: { type: 'STRING' as Type, description: 'Ex: "EGP 12V".' },
              componentes_trocados: { type: 'STRING' as Type, description: 'Ex: "Res. 100K 3W, BD140".' },
              observacao_status: { type: 'STRING' as Type, description: 'Desgaste do Componente | Testada | Erro de Ligação | Sem Defeito.' },
              data_fabricacao: { type: 'STRING' as Type, description: 'ISO YYYY-MM-DD.' },
              tem_garantia: { type: 'BOOLEAN' as Type },
              valor_total: { type: 'NUMBER' as Type },
            },
          },
        },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'add_rma_item',
    description:
      'Adiciona uma linha de item a um RMA existente. Use pra "no RMA #5, adiciona uma linha: EGP 12V, componentes Res 100K 3W, observação Desgaste, R$ 5".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        numero: { type: 'NUMBER' as Type },
        rma_id: { type: 'STRING' as Type },
        item_name: { type: 'STRING' as Type },
        componentes_trocados: { type: 'STRING' as Type },
        observacao_status: { type: 'STRING' as Type },
        data_fabricacao: { type: 'STRING' as Type },
        tem_garantia: { type: 'BOOLEAN' as Type },
        valor_total: { type: 'NUMBER' as Type },
      },
    },
  },
  {
    name: 'update_rma_status',
    description:
      'Muda o status do RMA. Use pra "marca o RMA #5 como em conserto", "RMA da OS X foi devolvido". Status válidos: recebido, analise, conserto, pronto, devolvido, cancelado. Quando virar devolvido, preenche data_devolvido automaticamente.',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        numero: { type: 'NUMBER' as Type },
        rma_id: { type: 'STRING' as Type },
        status: { type: 'STRING' as Type, description: 'recebido | analise | conserto | pronto | devolvido | cancelado.' },
      },
      required: ['status'],
    },
  },
  {
    name: 'add_rma_observation',
    description: 'Anota uma observação na timeline de um RMA. Use pra "anota no RMA #5: cliente confirmou recebimento por WhatsApp".',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        numero: { type: 'NUMBER' as Type },
        rma_id: { type: 'STRING' as Type },
        content: { type: 'STRING' as Type },
      },
      required: ['content'],
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
  /** 'fabricacao' (componente da placa) | 'acervo' (embalagem, etiqueta, gabinete, manual) */
  tipo: 'fabricacao' | 'acervo';
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
      .select('id, component_id, quantity, target_price_brl, tipo, component:components(name)')
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
    tipo: (b.tipo === 'acervo' ? 'acervo' : 'fabricacao') as 'fabricacao' | 'acervo',
  }));
  return { product: prodRes.data, bom };
}

/**
 * Normaliza o argumento mount_type vindo da IA. Aceita 'SMD' / 'PTH' / null.
 * Como fallback (quando arg não foi passado), detecta pelo nome:
 * - "SMD" no texto → SMD
 * - "PTH" / "through hole" / "through-hole" no texto → PTH
 * - Pacotes SMD comuns (0402, 0603, 0805, 1206, SOT-23, SOIC) → SMD
 */
function normalizeMountType(arg: unknown, name?: string): 'SMD' | 'PTH' | null {
  if (typeof arg === 'string') {
    const u = arg.trim().toUpperCase();
    if (u === 'SMD' || u === 'SMT') return 'SMD';
    if (u === 'PTH' || u === 'THT') return 'PTH';
    if (u === '' || u === 'NULL' || u === 'NONE') return null;
  }
  if (name) {
    const n = name.toUpperCase();
    if (/\bSMD\b|\bSMT\b/.test(n)) return 'SMD';
    if (/\bPTH\b|\bTHT\b|THROUGH[- ]HOLE/.test(n)) return 'PTH';
    // Pacotes SMD clássicos (0402, 0603, 0805, 1206, 1210, 2010, 2512)
    if (/\b0(2|4|6|8)0[235]\b|\b1(20|21|81)6\b|\b2[05]1[02]\b|SOT[- ]?\d|SOIC|TSSOP|QFN|QFP|BGA|MELF/i.test(name)) return 'SMD';
  }
  return null;
}

/**
 * Remove acentos da string (lado JS, simétrico ao unaccent do PG).
 * "MAÇÃ" → "MACA", "manutenção" → "manutencao"
 */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normaliza pra busca: lower + sem acentos. Casa com normalize_search() do PG.
 */
function normalizeForSearch(s: string): string {
  return stripAccents(s.toLowerCase().trim());
}

/**
 * Devolve o "radical" curto de um termo de busca pra ilike — resolve plural/
 * singular automaticamente. Exemplos:
 *   - CABOS  → CABO   (ilike %CABO% casa com CABO, CABOS, CABO COAXIAL)
 *   - LUZES  → LUZ
 *   - SAPATAS → SAPATA
 *   - CONEXÕES → CONEX (casa com CONEXÃO, CONEXÕES, CONEXAO)
 *   - PARAFUSO (já singular) → PARAFUSO (mantém)
 *
 * Aceita false positives (ex: "BOT" casa com "BOTÃO" e "BOTA"). Pra busca
 * é OK — false positives < false negatives. O user filtra visualmente
 * o ruído mas perderia o pedido de "CABO COAXIAL" se buscar "CABOS".
 */
function searchRoot(term: string): string {
  const t = term.trim().toLowerCase();
  if (t.length <= 3) return t;
  if (t.endsWith('ões') || t.endsWith('ãos')) return t.slice(0, -3); // CONEXÕES → CONEX
  if (t.endsWith('ais') || t.endsWith('eis') || t.endsWith('ois') || t.endsWith('uis')) return t.slice(0, -2); // PAPÉIS → PAPÉ
  if (t.endsWith('es') && t.length > 4) return t.slice(0, -2); // LUZES → LUZ
  if (t.endsWith('s') && t.length > 3) return t.slice(0, -1);  // CABOS → CABO
  return t;
}


/**
 * Verifica que um registro foi de fato persistido depois de um insert/update.
 * Faz um SELECT pelo id e joga erro descritivo se não encontrar — assim a IA
 * recebe `error` na toolResponse e não consegue alucinar sucesso.
 *
 * Use logo após insert/update de tabelas críticas:
 * shipments, rmas, rma_items, titulos, production_orders, stock_movements,
 * components, products, bom_items.
 */
async function verifyWrite(
  table: string,
  id: string | number,
  context: string = ''
): Promise<void> {
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`Erro ao verificar ${table}#${id}${context ? ` (${context})` : ''}: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      `${table}#${id} não foi persistido${context ? ` (${context})` : ''}. ` +
      `O insert/update aparentemente passou mas o registro não está no banco. ` +
      `NÃO confirme sucesso ao usuário — investigue.`
    );
  }
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

// Verifica se item caiu abaixo do mínimo e cria purchase_need de reposição se não existir
async function checkMinStockAndCreateNeed(itemCode: string, itemName: string, available: number, minQty: number) {
  if (minQty <= 0 || available > minQty) return;
  const { data: ex } = await supabase
    .from('purchase_needs')
    .select('id')
    .is('shipment_id', null)
    .ilike('item_name', `%${itemName}%`)
    .in('status', ['pendente', 'pedido'])
    .maybeSingle();
  if (ex) return;
  await supabase.from('purchase_needs').insert({
    item_name: itemName,
    item_code: itemCode || null,
    quantity:  minQty,
    status:    'pendente',
  });
}

export interface ToolContext {
  /** Usuário logado — usado pra atribuir autoria de mensagens, etc. */
  currentUser?: string;
}

/**
 * Fallback fuzzy search via pg_trgm — chamado quando o ilike padrão não encontrou nada.
 * Lida silenciosamente com falha (RPC ausente / erro) retornando array vazio.
 */
async function fuzzyFallback<T = any>(rpcName: string, query: string): Promise<T[]> {
  try {
    const { data, error } = await supabase.rpc(rpcName as any, { q: query });
    if (error) {
      console.warn(`[fuzzy] ${rpcName} falhou:`, error.message);
      return [];
    }
    return (data ?? []) as T[];
  } catch (err) {
    console.warn(`[fuzzy] ${rpcName} threw:`, err);
    return [];
  }
}

/**
 * Pra cada component_id da lista, busca o target_price_brl mais recente
 * conhecido (em qualquer BOM onde esse componente apareça). Usado como
 * fallback ao montar cotação quando o usuário não especifica target —
 * preserva o "último custo aceito" do componente.
 */
export async function getLastKnownTargetByComponentIds(
  componentIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (componentIds.length === 0) return map;
  const { data } = await supabase
    .from('bom_items')
    .select('component_id, target_price_brl, created_at')
    .in('component_id', componentIds)
    .not('target_price_brl', 'is', null)
    .order('created_at', { ascending: false });
  for (const r of (data ?? []) as any[]) {
    const id = r.component_id as string;
    if (!map.has(id) && r.target_price_brl != null) {
      map.set(id, Number(r.target_price_brl));
    }
  }
  return map;
}

/**
 * Resolve um nome (ex: "Nathanna", "Felipe Enbracon") em um número de
 * WhatsApp, buscando em 3 tabelas na ordem: whatsapp_contacts → sellers →
 * client_contacts. Tenta ilike primeiro; se falha, fuzzy fallback.
 * Retorna null se nada encontrado.
 */
async function resolveRecipientPhoneByName(name: string): Promise<string | null> {
  const q = name.trim();
  if (!q) return null;

  // Pass 1: ilike em paralelo nas 3 tabelas
  const [waRes, sellersRes, clientsRes] = await Promise.all([
    supabase.from('whatsapp_contacts').select('phone').ilike('name', `%${q}%`).limit(1),
    supabase.from('sellers').select('whatsapp_number').ilike('name', `%${q}%`).limit(1),
    supabase.from('client_contacts').select('whatsapp_phone').ilike('name', `%${q}%`).not('whatsapp_phone', 'is', null).limit(1),
  ]);
  const waPhone = (waRes.data as any[])?.[0]?.phone;
  if (waPhone) return String(waPhone);
  const sellerPhone = (sellersRes.data as any[])?.[0]?.whatsapp_number;
  if (sellerPhone) return String(sellerPhone);
  const clientPhone = (clientsRes.data as any[])?.[0]?.whatsapp_phone;
  if (clientPhone) return String(clientPhone);

  // Pass 2: fuzzy fallback nas mesmas 3 tabelas
  const [fuzzyWa, fuzzyClients] = await Promise.all([
    fuzzyFallback<{ phone: string; sim: number }>('search_whatsapp_contacts_fuzzy', q),
    fuzzyFallback<{ whatsapp_phone: string; sim: number }>('search_client_contacts_fuzzy', q),
  ]);
  if (fuzzyWa[0]?.phone) return String(fuzzyWa[0].phone);
  // Sellers in-memory (poucos registros)
  const { data: allSellers } = await supabase.from('sellers').select('name, whatsapp_number');
  const bestSeller = ((allSellers ?? []) as any[])
    .map((s) => ({ ...s, sim: stringSimilarity(q, s.name) }))
    .filter((s) => s.sim > 0.4)
    .sort((a, b) => b.sim - a.sim)[0];
  if (bestSeller?.whatsapp_number) return String(bestSeller.whatsapp_number);
  const fuzzyClient = fuzzyClients.find((c) => c.whatsapp_phone);
  if (fuzzyClient?.whatsapp_phone) return String(fuzzyClient.whatsapp_phone);

  return null;
}

/**
 * Similaridade simples baseada em bigrams (Dice coefficient). Usado quando
 * a tabela é pequena (ex: sellers) e não vale criar RPC pg_trgm dedicada.
 * Retorna 0..1.
 */
function stringSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const bigrams = (s: string) => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const xb = bigrams(x);
  const yb = bigrams(y);
  const ySet = new Map<string, number>();
  for (const bg of yb) ySet.set(bg, (ySet.get(bg) ?? 0) + 1);
  let inter = 0;
  for (const bg of xb) {
    const n = ySet.get(bg);
    if (n && n > 0) {
      inter++;
      ySet.set(bg, n - 1);
    }
  }
  return (2 * inter) / (xb.length + yb.length);
}

export async function executeTool(name: string, args: any, ctx: ToolContext = {}): Promise<unknown> {
  switch (name) {
    // ---------- LEITURAS ----------
    case 'list_products': {
      const { data, error } = await supabase
        .from('products_with_cost')
        .select('id, name, unit_cost_brl, fabricacao_cost_brl, acervo_cost_brl, sale_price_brl, pricing_mode, product_type')
        .order('name');
      if (error) throw new Error(error.message);
      return { products: data };
    }

    case 'find_product_by_name': {
      const search = String(args.name ?? '').trim();
      if (!search) throw new Error('name é obrigatório');
      const { data, error } = await supabase
        .from('products_with_cost')
        .select('id, name, unit_cost_brl, fabricacao_cost_brl, acervo_cost_brl, sale_price_brl, pricing_mode, product_type')
        .ilike('name', `%${search}%`)
        .order('name');
      if (error) throw new Error(error.message);
      let products = data ?? [];
      let matchedBy: 'exact' | 'fuzzy' = 'exact';
      // Fallback fuzzy se ilike vazio (resolve transcrições/grafia variante)
      if (products.length === 0) {
        const fuzzy = await fuzzyFallback<{ id: string; name: string; sku: string; sim: number }>(
          'search_products_fuzzy',
          search
        );
        if (fuzzy.length > 0) {
          // Re-busca os products_with_cost dos ids fuzzy
          const ids = fuzzy.map((p) => p.id);
          const { data: enriched } = await supabase
            .from('products_with_cost')
            .select('id, name, unit_cost_brl, fabricacao_cost_brl, acervo_cost_brl, sale_price_brl, pricing_mode, product_type')
            .in('id', ids);
          // Preserva ordem de similaridade
          const byId = new Map((enriched ?? []).map((p: any) => [p.id, p]));
          products = fuzzy.map((f) => byId.get(f.id)).filter(Boolean) as any[];
          matchedBy = 'fuzzy';
        }
      }
      if (products.length === 0) {
        return { found: false, message: `Nenhum produto encontrado com "${search}".`, matched_by: matchedBy };
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
          tipo: b.tipo,
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
          .select('unit_cost_brl, fabricacao_cost_brl, acervo_cost_brl, sale_price_brl')
          .eq('id', productId)
          .single(),
        getProductWithBom(productId),
      ]);
      if (pRes.error || !pRes.data) throw new Error(pRes.error?.message ?? 'Produto não encontrado');
      const product: any = pRes.data;
      const fabricacaoBom = bomData.bom.filter((b) => b.tipo === 'fabricacao');
      const acervoBom     = bomData.bom.filter((b) => b.tipo === 'acervo');
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        pricing_mode: product.pricing_mode,
        custom_markup_pct: product.custom_markup_pct,
        product_type: product.product_type,
        unit_cost_brl: costRes.data?.unit_cost_brl ?? 0,
        fabricacao_cost_brl: costRes.data?.fabricacao_cost_brl ?? 0,
        acervo_cost_brl: costRes.data?.acervo_cost_brl ?? 0,
        sale_price_brl: costRes.data?.sale_price_brl ?? null,
        bom_summary: {
          fabricacao_count: fabricacaoBom.length,
          acervo_count:     acervoBom.length,
          total_count:      bomData.bom.length,
        },
        bom: bomData.bom.map((b) => ({
          bom_item_id: b.id,
          component_id: b.component_id,
          component_name: b.component_name,
          quantity_per_product: b.quantity,
          value_unit_brl: b.target_price_brl,
          tipo: b.tipo,
        })),
      };
    }

    case 'set_product_kit': {
      const kitName  = String(args.kit_product_name ?? '').trim();
      const comps    = Array.isArray(args.component_products) ? args.component_products as any[] : [];
      if (!kitName) throw new Error('kit_product_name é obrigatório');
      if (comps.length === 0) throw new Error('component_products não pode ser vazio');

      // Resolve o produto kit
      const { data: kitProds } = await supabase.from('products').select('id, name').ilike('name', `%${kitName}%`).limit(1);
      const kitProd = (kitProds as any[])?.[0];
      if (!kitProd) throw new Error(`Produto kit "${kitName}" não encontrado`);

      // Marca como kit
      await supabase.from('products').update({ is_kit: true }).eq('id', kitProd.id);

      // Resolve cada componente
      const resolved: { component_product_id: string; quantity: number; name: string }[] = [];
      for (const c of comps) {
        const { data: prods } = await supabase.from('products').select('id, name').ilike('name', `%${c.product_name}%`).limit(1);
        const prod = (prods as any[])?.[0];
        if (!prod) throw new Error(`Produto componente "${c.product_name}" não encontrado`);
        resolved.push({ component_product_id: prod.id, quantity: Number(c.quantity) || 1, name: prod.name });
      }

      // Salva (replace all)
      await supabase.from('product_kits').delete().eq('kit_product_id', kitProd.id);
      await supabase.from('product_kits').insert(
        resolved.map(r => ({ kit_product_id: kitProd.id, component_product_id: r.component_product_id, quantity: r.quantity }))
      );

      return {
        kit: kitProd.name,
        components: resolved.map(r => ({ name: r.name, quantity: r.quantity })),
        message: `Kit "${kitProd.name}" configurado com ${resolved.length} produto(s): ${resolved.map(r => `${r.quantity}× ${r.name}`).join(', ')}`,
      };
    }

    case 'get_kit_components': {
      const kitName = String(args.kit_product_name ?? '').trim();
      const { data: kitProds } = await supabase.from('products').select('id, name').ilike('name', `%${kitName}%`).limit(1);
      const kitProd = (kitProds as any[])?.[0];
      if (!kitProd) throw new Error(`Produto "${kitName}" não encontrado`);

      const { data: kits } = await supabase
        .from('product_kits')
        .select('component_product_id, quantity')
        .eq('kit_product_id', kitProd.id);

      if (!kits?.length) return { kit: kitProd.name, is_kit: false, components: [] };

      const components = await Promise.all((kits as any[]).map(async k => {
        const { data: cost } = await supabase.from('products_with_cost').select('name, unit_cost_brl').eq('id', k.component_product_id).single();
        return { name: (cost as any)?.name, quantity: k.quantity, unit_cost: (cost as any)?.unit_cost_brl };
      }));

      const totalCost = components.reduce((s, c) => s + (Number(c.unit_cost) * c.quantity), 0);
      return { kit: kitProd.name, is_kit: true, components, total_cost_brl: totalCost };
    }

    case 'list_components': {
      const { data, error } = await supabase
        .from('components')
        .select('id, name, mount_type, sku, unit')
        .order('name');
      if (error) throw new Error(error.message);
      return { components: data };
    }

    case 'find_component_by_name': {
      const search = String(args.name ?? '').trim();
      if (!search) throw new Error('name é obrigatório');
      const { data, error } = await supabase
        .from('components')
        .select('id, name, mount_type, sku, unit')
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

    // ---------- META — AUTO-VALIDAÇÃO ----------
    case 'verify_records_exist': {
      const claims = Array.isArray(args.claims) ? args.claims : [];
      if (claims.length === 0) throw new Error('claims é obrigatório (lista não vazia)');

      // Mapeia entity -> tabela + campos default de busca
      const entityMap: Record<string, { table: string; defaultField: string; selectFields: string }> = {
        shipment:         { table: 'shipments',         defaultField: 'numero_venda',  selectFields: 'id, client_name, numero_venda, numero_nfe, status' },
        rma:              { table: 'rmas',              defaultField: 'numero',        selectFields: 'id, numero, client_name, status' },
        titulo:           { table: 'titulos',           defaultField: 'numero_titulo', selectFields: 'id, client_name, valor, status, vencimento' },
        production_order: { table: 'production_orders', defaultField: 'id',            selectFields: 'id, product_name, quantity_ordered, status' },
        component:        { table: 'components',        defaultField: 'name',          selectFields: 'id, name, sku, mount_type' },
        product:          { table: 'products',          defaultField: 'name',          selectFields: 'id, name, product_type' },
        bom_item:         { table: 'bom_items',         defaultField: 'id',            selectFields: 'id, product_id, component_id, quantity, tipo' },
        stock_item:       { table: 'stock_items',       defaultField: 'item_code',     selectFields: 'id, item_code, item_name, quantity' },
        financeira:       { table: 'financeiras',       defaultField: 'nome',          selectFields: 'id, nome' },
        rma_item:         { table: 'rma_items',         defaultField: 'id',            selectFields: 'id, rma_id, item_name' },
      };

      const results: any[] = [];
      let allVerified = true;
      for (const c of claims as any[]) {
        const entity = String(c?.entity ?? '').toLowerCase();
        const cfg = entityMap[entity];
        if (!cfg) {
          results.push({ claim: c, exists: false, error: `entity "${entity}" desconhecida` });
          allVerified = false;
          continue;
        }
        const byId = c?.by_id ? String(c.by_id) : '';
        const byField = c?.by_field ? String(c.by_field) : cfg.defaultField;
        const byValue = c?.by_value != null ? String(c.by_value) : '';

        let q = supabase.from(cfg.table).select(cfg.selectFields).limit(1);
        if (byId) {
          q = q.eq('id', byId);
        } else if (byValue) {
          // Numero (numérico) usa eq exato; texto usa ilike
          if (byField === 'numero' || byField === 'id') {
            q = (q as any).eq(byField, isNaN(Number(byValue)) ? byValue : Number(byValue));
          } else {
            q = (q as any).ilike(byField, byValue);
          }
        } else {
          results.push({ claim: c, exists: false, error: 'forneça by_id OU by_field+by_value' });
          allVerified = false;
          continue;
        }

        const { data, error } = await q;
        if (error) {
          results.push({ claim: c, exists: false, error: error.message });
          allVerified = false;
          continue;
        }
        const rows = (data ?? []) as any[];
        if (rows.length === 0) {
          results.push({ claim: c, exists: false, error: 'registro não encontrado' });
          allVerified = false;
        } else {
          results.push({ claim: c, exists: true, found_data: rows[0] });
        }
      }

      return {
        all_verified: allVerified,
        results,
        summary: allVerified
          ? `Todas as ${claims.length} afirmações conferem com o banco. Pode confirmar ao usuário.`
          : `${results.filter((r) => !r.exists).length} de ${claims.length} afirmação(ões) FALHOU. NÃO confirme sucesso geral — reporte o que existe e o que não existe.`,
      };
    }

    // ---------- AÇÕES — RELATÓRIOS ----------
    case 'export_components_pdf': {
      const productName = args.product_name ? String(args.product_name).trim() : '';
      const excludeItems: string[] = Array.isArray(args.exclude_items)
        ? args.exclude_items.map((s: any) => String(s).trim()).filter(Boolean)
        : [];
      const resetVisibility = Boolean(args.reset_visibility);

      // Modo catálogo geral (sem produto)
      if (!productName) {
        const [{ data: compsRaw, error: compsErr }, { data: linksRaw, error: linksErr }] = await Promise.all([
          supabase.from('components').select('*').order('name'),
          supabase.from('bom_items').select('product_id, component_id, quantity, target_price_brl, tipo, show_in_pdf, created_at'),
        ]);
        if (compsErr) throw new Error(compsErr.message);
        if (linksErr) throw new Error(linksErr.message);
        exportComponentsGeneral(
          (compsRaw ?? []) as Component[],
          (linksRaw ?? []) as ExportBomLink[]
        );
        return {
          downloaded: true,
          mode: 'catalogo_geral',
          components_count: compsRaw?.length ?? 0,
          message: `PDF do catálogo geral baixado (${compsRaw?.length ?? 0} componentes).`,
        };
      }

      // Modo produto específico
      // 1. Localiza produto (fuzzy)
      const { data: prods, error: pErr } = await supabase
        .from('products').select('id, name').ilike('name', `%${productName}%`).limit(1);
      if (pErr) throw new Error(pErr.message);
      const product = (prods as any[])?.[0];
      if (!product) throw new Error(`Produto "${productName}" não encontrado.`);

      // 2. Aplica reset_visibility se solicitado
      if (resetVisibility) {
        await supabase
          .from('bom_items')
          .update({ show_in_pdf: true })
          .eq('product_id', product.id);
      }

      // 3. Aplica exclude_items: pra cada keyword, busca bom_items daquele produto
      //    cujo componente bate com a keyword e marca show_in_pdf=false.
      const excludedNames: string[] = [];
      const excludeFailed: string[] = [];
      if (excludeItems.length > 0) {
        const { data: bomRows } = await supabase
          .from('bom_items')
          .select('id, component:components(name)')
          .eq('product_id', product.id);
        const allRows = ((bomRows ?? []) as any[]).map((b) => ({
          id: b.id as string,
          name: (b.component?.name ?? '') as string,
        }));
        for (const keyword of excludeItems) {
          const lower = keyword.toLowerCase();
          const matches = allRows.filter((r) => r.name.toLowerCase().includes(lower));
          if (matches.length === 0) {
            excludeFailed.push(keyword);
            continue;
          }
          const ids = matches.map((m) => m.id);
          await supabase.from('bom_items').update({ show_in_pdf: false }).in('id', ids);
          for (const m of matches) excludedNames.push(m.name);
        }
      }

      // 4. Re-busca os dados atualizados (pra refletir os toggles aplicados)
      const [{ data: compsRaw, error: compsErr }, { data: linksRaw, error: linksErr }] = await Promise.all([
        supabase.from('components').select('*').order('name'),
        supabase.from('bom_items').select('product_id, component_id, quantity, target_price_brl, tipo, show_in_pdf, created_at'),
      ]);
      if (compsErr) throw new Error(compsErr.message);
      if (linksErr) throw new Error(linksErr.message);

      // 5. Gera o PDF (dispara download)
      exportComponentsByProduct(
        { id: product.id, name: product.name },
        (compsRaw ?? []) as Component[],
        (linksRaw ?? []) as ExportBomLink[]
      );

      const productLinks = ((linksRaw ?? []) as ExportBomLink[]).filter(
        (l) => l.product_id === product.id
      );
      const visibleCount = productLinks.filter((l) => l.show_in_pdf !== false).length;
      const hiddenCount = productLinks.length - visibleCount;

      return {
        downloaded: true,
        mode: 'produto',
        product: product.name,
        items_in_pdf: visibleCount,
        items_hidden: hiddenCount,
        excluded_now: excludedNames,
        exclude_keywords_not_matched: excludeFailed,
        message:
          `PDF do ${product.name} baixado` +
          (excludedNames.length > 0
            ? ` (omitidos: ${excludedNames.join(', ')})`
            : '') +
          (excludeFailed.length > 0
            ? `. Não encontrei: ${excludeFailed.join(', ')}.`
            : '.') +
          ` Total no PDF: ${visibleCount}${hiddenCount > 0 ? `, ocultos: ${hiddenCount}` : ''}.`,
      };
    }

    // ---------- ESCRITAS — COMPONENTES ----------
    case 'create_component': {
      const cname = String(args.name ?? '').trim();
      if (!cname) throw new Error('name é obrigatório');
      const mountType = normalizeMountType(args.mount_type, cname);
      const insertPayload: any = { name: cname };
      if (mountType) insertPayload.mount_type = mountType;
      const { data, error } = await supabase
        .from('components')
        .insert(insertPayload)
        .select('id, name, mount_type')
        .single();
      if (error) throw new Error(error.message);
      return { created: data };
    }

    case 'bulk_create_components': {
      // Aceita 2 formatos: legado (names: string[]) ou novo (components: {name, mount_type}[])
      let items: { name: string; mount_type: 'SMD' | 'PTH' | null }[] = [];
      if (Array.isArray(args.components) && args.components.length > 0) {
        items = args.components
          .map((c: any) => {
            const name = String(c?.name ?? '').trim();
            return name ? { name, mount_type: normalizeMountType(c?.mount_type, name) } : null;
          })
          .filter(Boolean) as any[];
      } else if (Array.isArray(args.names)) {
        items = args.names
          .map((s: any) => String(s).trim())
          .filter(Boolean)
          .map((name: string) => ({ name, mount_type: normalizeMountType(null, name) }));
      }
      if (items.length === 0) throw new Error('Forneça components (preferido) ou names com pelo menos 1 item');
      const { data, error } = await supabase
        .from('components')
        .insert(items.map((it) => {
          const row: any = { name: it.name };
          if (it.mount_type) row.mount_type = it.mount_type;
          return row;
        }))
        .select('id, name, mount_type');
      if (error) throw new Error(error.message);
      return { created_count: data?.length ?? 0, components: data };
    }

    case 'update_component': {
      const id = String(args.component_id ?? '');
      if (!id) throw new Error('component_id é obrigatório');
      const payload: Record<string, unknown> = {};
      if (args.name !== undefined) {
        const cname = String(args.name).trim();
        if (!cname) throw new Error('name não pode ser vazio');
        payload.name = cname;
      }
      if (args.mount_type !== undefined) {
        payload.mount_type = normalizeMountType(args.mount_type, String(args.name ?? ''));
      }
      if (Object.keys(payload).length === 0) throw new Error('Nada a atualizar (forneça name ou mount_type).');
      const { error } = await supabase.from('components').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, id, changes: payload };
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

      // Verifica se já existe produto com nome igual (ilike) — atualiza em vez de duplicar
      const { data: existing } = await supabase
        .from('products').select('id, name').ilike('name', pname).limit(1);
      const found = (existing as any[])?.[0];

      if (found) {
        const updates: any = {};
        if (args.description) updates.description = String(args.description).trim();
        if (args.product_type) updates.product_type = String(args.product_type).trim();
        if (args.unit) updates.unit = String(args.unit).trim();
        if (args.direct_cost_brl != null) updates.direct_cost_brl = Number(args.direct_cost_brl);
        if (Object.keys(updates).length > 0) {
          await supabase.from('products').update(updates).eq('id', found.id);
        }
        return { updated: true, id: found.id, name: found.name, note: 'Produto já existia — dados atualizados.' };
      }

      const payload: any = { name: pname };
      if (args.description) payload.description = String(args.description).trim();
      if (args.product_type) payload.product_type = String(args.product_type).trim();
      if (args.unit) payload.unit = String(args.unit).trim();
      if (args.direct_cost_brl != null) payload.direct_cost_brl = Number(args.direct_cost_brl);
      const { data, error } = await supabase
        .from('products').insert(payload).select('id, name').single();
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
      if (args.unit !== undefined) payload.unit = args.unit ? String(args.unit).trim() : null;
      if (args.direct_cost_brl != null) payload.direct_cost_brl = Number(args.direct_cost_brl);
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

      const tipoArg = args.tipo === 'acervo' ? 'acervo' : args.tipo === 'fabricacao' ? 'fabricacao' : null;

      if (existing) {
        const updatePayload: any = { quantity: qty };
        if (args.value_unit !== undefined) {
          updatePayload.target_price_brl = Number(args.value_unit);
        }
        if (tipoArg) updatePayload.tipo = tipoArg;
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
          }${tipoArg ? ` e tipo pra ${tipoArg}` : ''}.`,
        };
      }

      const payload: any = {
        product_id: productId,
        component_id: componentId,
        quantity: qty,
        tipo: tipoArg ?? 'fabricacao',
      };
      if (args.value_unit !== undefined) payload.target_price_brl = Number(args.value_unit);
      const { data, error } = await supabase
        .from('bom_items')
        .insert(payload)
        .select('id, component_id, quantity, target_price_brl, tipo')
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
      if (args.tipo !== undefined) {
        const t = String(args.tipo).toLowerCase();
        if (t !== 'fabricacao' && t !== 'acervo') {
          throw new Error('tipo deve ser "fabricacao" ou "acervo".');
        }
        payload.tipo = t;
      }
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
      if (!sname) throw new Error('name é obrigatório');
      const currency = args.default_currency === 'USD' ? 'USD' : 'BRL';
      const payload: any = { name: sname, default_currency: currency };
      if (args.email) {
        const e = String(args.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('email inválido');
        payload.email = e;
      }
      if (args.cnpj)           payload.cnpj           = String(args.cnpj).trim();
      if (args.address)        payload.address        = String(args.address).trim();
      if (args.whatsapp_phone) {
        const d = String(args.whatsapp_phone).replace(/\D/g, '');
        payload.whatsapp_phone = d.startsWith('55') ? d : `55${d}`;
      }
      const { data, error } = await supabase
        .from('suppliers')
        .insert(payload)
        .select('id, name, email, cnpj, address, default_currency, whatsapp_phone')
        .single();
      if (error) throw new Error(error.message);
      return { created: data };
    }

    case 'update_supplier': {
      const id = String(args.supplier_id ?? '');
      if (!id) throw new Error('supplier_id é obrigatório');
      const payload: any = {};
      if (args.name)    payload.name    = String(args.name).trim();
      if (args.cnpj)    payload.cnpj    = String(args.cnpj).trim();
      if (args.address) payload.address = String(args.address).trim();
      if (args.email) {
        const e = String(args.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('email inválido');
        payload.email = e;
      }
      if (args.default_currency) {
        payload.default_currency = args.default_currency === 'USD' ? 'USD' : 'BRL';
      }
      if (args.whatsapp_phone) {
        const d = String(args.whatsapp_phone).replace(/\D/g, '');
        payload.whatsapp_phone = d.startsWith('55') ? d : `55${d}`;
      }
      if (Object.keys(payload).length === 0) throw new Error('Nada a atualizar');
      const { error } = await supabase.from('suppliers').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
      return { updated: true, id, changes: payload };
    }

    case 'send_quote_request_whatsapp': {
      const items = (args.items ?? []) as Array<{ name: string; quantity: number; unit?: string }>;
      if (!items.length) throw new Error('items não pode ser vazio');

      // 1. Resolve fornecedor — por supplier_id ou por phone direto
      let supplierId = String(args.supplier_id ?? '');
      let supplierName = '';
      let whatsappPhone = '';

      if (supplierId) {
        // Caminho normal: busca pelo ID
        const { data: supplier, error: suppErr } = await supabase
          .from('suppliers').select('id, name, whatsapp_phone').eq('id', supplierId).single();
        if (suppErr || !supplier) throw new Error('Fornecedor não encontrado');
        supplierName = (supplier as any).name;
        whatsappPhone = (supplier as any).whatsapp_phone ?? '';
        if (!whatsappPhone && args.phone) {
          // Usuário forneceu número — salva e usa
          const digits = String(args.phone).replace(/\D/g, '');
          whatsappPhone = digits.startsWith('55') ? digits : `55${digits}`;
          await supabase.from('suppliers').update({ whatsapp_phone: whatsappPhone }).eq('id', supplierId);
        }
        if (!whatsappPhone) {
          throw new Error(`Fornecedor "${supplierName}" não tem WhatsApp cadastrado. Forneça o número na mesma mensagem — ex: "manda pro Vitor, número 11 99999-9999".`);
        }
      } else if (args.phone) {
        // Caminho alternativo: número direto, tenta encontrar fornecedor pelo número
        const digits = String(args.phone).replace(/\D/g, '');
        whatsappPhone = digits.startsWith('55') ? digits : `55${digits}`;
        const { data: byPhone } = await supabase
          .from('suppliers').select('id, name').eq('whatsapp_phone', whatsappPhone).maybeSingle();
        if (byPhone) {
          supplierId = (byPhone as any).id;
          supplierName = (byPhone as any).name;
        } else {
          // Cria fornecedor mínimo com o número
          const name = args.supplier_name ? String(args.supplier_name).trim() : `Fornecedor ${whatsappPhone.slice(-4)}`;
          const { data: created, error: createErr } = await supabase
            .from('suppliers')
            .insert({ name, email: `${whatsappPhone}@whatsapp.tmp`, whatsapp_phone: whatsappPhone, default_currency: 'BRL' })
            .select('id, name').single();
          if (createErr || !created) throw new Error(createErr?.message ?? 'Falha ao criar fornecedor');
          supplierId = (created as any).id;
          supplierName = (created as any).name;
        }
      } else {
        throw new Error('Informe supplier_id (use list_suppliers) OU phone (número WhatsApp direto).');
      }

      // 2. Cria cotação no banco
      const deadlineDays = args.deadline_days ? Number(args.deadline_days) : 5;
      const deadline = new Date(Date.now() + deadlineDays * 86400000).toISOString();
      const title = args.title
        ? String(args.title)
        : `Cotação ${supplierName} — ${new Date().toLocaleDateString('pt-BR')}`;

      let usdRate: number | null = null;
      try { const fx = await fetchUsdBrl(); usdRate = fx.rate; } catch {}

      const { data: q, error: qErr } = await supabase
        .from('quotations')
        .insert({ title, status: 'sent', context_type: 'purchase_list', usd_brl_rate: usdRate, deadline })
        .select('id, public_token')
        .single();
      if (qErr || !q) throw new Error(qErr?.message ?? 'Falha ao criar cotação');
      const quotationId = (q as any).id as string;

      // 3. Insere itens (resolve component_id se possível)
      const itemsPayload: any[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const { data: comps } = await supabase
          .from('components').select('id').ilike('name', `%${it.name}%`).limit(1);
        const comp = (comps as any[])?.[0];
        itemsPayload.push({
          quotation_id:        quotationId,
          component_id:        comp?.id ?? null,
          component_name_free: comp ? null : it.name,
          quantity:            it.quantity,
          position:            i,
        });
      }
      await supabase.from('quotation_items').insert(itemsPayload);

      // 4. Cria convite único para este fornecedor → gera token
      const { data: invite, error: invErr } = await supabase
        .from('quotation_invites')
        .insert({ quotation_id: quotationId, supplier_id: supplierId, status: 'sent', sent_at: new Date().toISOString() })
        .select('token')
        .single();
      if (invErr || !invite) throw new Error(invErr?.message ?? 'Falha ao criar convite');
      const inviteUrl = buildPublicQuoteUrl((invite as any).token);

      // 5. Monta e envia mensagem WhatsApp
      // Por padrão usa o template aprovado `cotacao_egp` (funciona pra qualquer fornecedor, sem janela de 24h)
      // Se custom_message for fornecido, manda como texto livre (só funciona dentro da janela de 24h)
      const deadlineLabel = new Date(deadline).toLocaleDateString('pt-BR');
      const customMsg = args.custom_message ? String(args.custom_message).trim() : null;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const sendBody = customMsg
        ? {
            to: whatsappPhone,
            text: `${customMsg}${args.notes ? `\n_Obs: ${args.notes}_` : ''}\n\n🔗 ${inviteUrl}\n*Prazo:* ${deadlineLabel}`,
            sender_label: ctx.currentUser,
          }
        : {
            to: whatsappPhone,
            template: {
              name: 'cotacao_egp',
              language: 'pt_BR',
              params: [supplierName, inviteUrl, deadlineLabel],
            },
            sender_label: ctx.currentUser,
          };

      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify(sendBody),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao enviar cotação WhatsApp');

      return {
        sent: true,
        supplier: supplierName,
        phone: whatsappPhone,
        quotation_id: quotationId,
        invite_url: inviteUrl,
        items_count: items.length,
        deadline: deadlineLabel,
        message_id: json.message_id,
      };
    }

    case 'delete_supplier': {
      const id = String(args.supplier_id ?? '');
      if (!id) throw new Error('supplier_id é obrigatório');
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, id };
    }

    // ---------- FORNECEDORES POR COMPONENTE ----------
    case 'get_component_suppliers': {
      const compName = String(args.component_name ?? '').trim();
      const { data: comps } = await supabase.from('components')
        .select('id, name').ilike('name', `%${compName}%`).limit(1);
      const comp = (comps as any[])?.[0];
      if (!comp) return { component: compName, suppliers: [], message: 'Componente não encontrado no catálogo.' };

      const { data, error } = await supabase.from('component_suppliers')
        .select('is_preferred, notes, created_at, supplier:suppliers(id, name, email, cnpj, address, default_currency)')
        .eq('component_id', comp.id)
        .order('is_preferred', { ascending: false });
      if (error) throw new Error(error.message);

      return {
        component_id: comp.id,
        component: comp.name,
        suppliers: (data ?? []).map((r: any) => ({
          supplier_id:   r.supplier?.id,
          name:          r.supplier?.name,
          email:         r.supplier?.email,
          cnpj:          r.supplier?.cnpj,
          address:       r.supplier?.address,
          is_preferred:  r.is_preferred,
          notes:         r.notes,
        })),
        has_preferred: (data ?? []).some((r: any) => r.is_preferred),
      };
    }

    case 'set_component_supplier': {
      const compName  = String(args.component_name ?? '').trim();
      const suppName  = String(args.supplier_name ?? '').trim();
      const preferred = Boolean(args.is_preferred ?? false);
      const notes     = args.notes ? String(args.notes).trim() : null;

      const { data: comps } = await supabase.from('components')
        .select('id, name').ilike('name', `%${compName}%`).limit(1);
      const comp = (comps as any[])?.[0];
      if (!comp) throw new Error(`Componente "${compName}" não encontrado.`);

      const { data: supps } = await supabase.from('suppliers')
        .select('id, name').ilike('name', `%${suppName}%`).limit(1);
      const supp = (supps as any[])?.[0];
      if (!supp) throw new Error(`Fornecedor "${suppName}" não encontrado. Cadastre primeiro com create_supplier.`);

      // Se is_preferred, remove preferência de outros fornecedores do mesmo componente
      if (preferred) {
        await supabase.from('component_suppliers')
          .update({ is_preferred: false })
          .eq('component_id', comp.id);
      }

      const { error } = await supabase.from('component_suppliers')
        .upsert({ component_id: comp.id, supplier_id: supp.id, is_preferred: preferred, notes },
                 { onConflict: 'component_id,supplier_id' });
      if (error) throw new Error(error.message);

      return { linked: supp.name, to_component: comp.name, is_preferred: preferred };
    }

    case 'remove_component_supplier': {
      const compName = String(args.component_name ?? '').trim();
      const suppName = String(args.supplier_name ?? '').trim();

      const { data: comps } = await supabase.from('components')
        .select('id').ilike('name', `%${compName}%`).limit(1);
      const comp = (comps as any[])?.[0];
      if (!comp) throw new Error(`Componente "${compName}" não encontrado.`);

      const { data: supps } = await supabase.from('suppliers')
        .select('id').ilike('name', `%${suppName}%`).limit(1);
      const supp = (supps as any[])?.[0];
      if (!supp) throw new Error(`Fornecedor "${suppName}" não encontrado.`);

      const { error } = await supabase.from('component_suppliers')
        .delete().eq('component_id', comp.id).eq('supplier_id', supp.id);
      if (error) throw new Error(error.message);
      return { removed: true, component: compName, supplier: suppName };
    }

    // ---------- COTAÇÃO DE LISTA LIVRE ----------
    case 'create_quotation_from_list': {
      const items = (args.items ?? []) as Array<{ name: string; quantity: number; target_price_brl?: number }>;
      if (!items.length) throw new Error('items é obrigatório');
      const deadlineDays = args.deadline_days ? Number(args.deadline_days) : 5;
      const autoInvitePreferred = Boolean(args.auto_invite_preferred ?? true);
      const additionalSupplierNames: string[] = Array.isArray(args.additional_supplier_names)
        ? args.additional_supplier_names.map((s: any) => String(s).trim()).filter(Boolean)
        : [];
      const title = args.title
        ? String(args.title)
        : `Cotação Lista ${new Date().toLocaleDateString('pt-BR')}`;
      const deadline = new Date(Date.now() + deadlineDays * 86400000).toISOString();

      let usdRate: number | null = null;
      try { const fx = await fetchUsdBrl(); usdRate = fx.rate; } catch {}

      // Cria a cotação (sem product_id)
      const { data: q, error: qErr } = await supabase.from('quotations')
        .insert({ title, status: 'sent', context_type: 'purchase_list', usd_brl_rate: usdRate, deadline })
        .select('id, public_token').single();
      if (qErr || !q) throw new Error(qErr?.message ?? 'Falha ao criar cotação');
      const quotationId = (q as any).id as string;
      const publicToken = (q as any).public_token as string;

      // Resolve componentes e insere itens — em 2 passes pra aplicar
      // fallback de target_price_brl (último custo conhecido) quando o
      // usuário não passou explicitamente
      const preferredSupplierIds = new Set<string>();
      const itemsPayload: any[] = [];
      const unresolvedItems: string[] = [];
      const resolved: { it: typeof items[number]; compId: string | null }[] = [];

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const { data: comps } = await supabase.from('components')
          .select('id').ilike('name', `%${it.name}%`).limit(1);
        const compId = (comps as any[])?.[0]?.id ?? null;
        resolved.push({ it, compId });

        if (compId && autoInvitePreferred) {
          const { data: cs } = await supabase.from('component_suppliers')
            .select('supplier_id').eq('component_id', compId).eq('is_preferred', true).maybeSingle();
          if (cs) preferredSupplierIds.add((cs as any).supplier_id);
          else unresolvedItems.push(it.name);
        }
      }

      // Busca último target conhecido pra cada componente sem target explícito
      const compIdsNeedingFallback = resolved
        .filter((r) => r.compId && r.it.target_price_brl == null)
        .map((r) => r.compId!) as string[];
      const lastKnownTargets = await getLastKnownTargetByComponentIds(compIdsNeedingFallback);

      let fallbackUsedCount = 0;
      for (let i = 0; i < resolved.length; i++) {
        const { it, compId } = resolved[i];
        const explicitTarget = it.target_price_brl != null ? Number(it.target_price_brl) : null;
        const fallbackTarget = compId ? (lastKnownTargets.get(compId) ?? null) : null;
        const finalTarget = explicitTarget ?? fallbackTarget;
        if (explicitTarget == null && fallbackTarget != null) fallbackUsedCount++;
        itemsPayload.push({
          quotation_id:        quotationId,
          component_id:        compId,
          component_name_free: compId ? null : it.name,
          quantity:            it.quantity,
          target_price_brl:    finalTarget,
          position:            i,
        });
      }

      await supabase.from('quotation_items').insert(itemsPayload);

      // Adiciona fornecedores adicionais por nome
      if (additionalSupplierNames.length) {
        for (const sn of additionalSupplierNames) {
          const { data: ss } = await supabase.from('suppliers')
            .select('id').ilike('name', `%${sn}%`).limit(1);
          const s = (ss as any[])?.[0];
          if (s) preferredSupplierIds.add(s.id);
        }
      }

      // Cria convites
      const invites: Array<{ supplier_name: string; url: string }> = [];
      if (preferredSupplierIds.size > 0) {
        const { data: suppData } = await supabase.from('suppliers')
          .select('id, name').in('id', [...preferredSupplierIds]);
        const invitePayload = (suppData ?? []).map((s: any) => ({
          quotation_id: quotationId, supplier_id: s.id, status: 'sent', sent_at: new Date().toISOString(),
        }));
        const { data: createdInvites } = await supabase.from('quotation_invites')
          .insert(invitePayload).select('token, supplier:suppliers(name)');
        for (const inv of (createdInvites ?? []) as any[]) {
          invites.push({ supplier_name: inv.supplier?.name ?? '—', url: buildPublicQuoteUrl(inv.token) });
        }
      }

      return {
        success: true,
        quotation_id: quotationId,
        title,
        items_count: items.length,
        items_with_fallback_target: fallbackUsedCount,
        public_url: buildPublicQuoteUrl(publicToken),
        expires_at: deadline,
        invites,
        items_without_preferred_supplier: unresolvedItems,
        note: unresolvedItems.length
          ? `Esses componentes não têm fornecedor preferido — convide manualmente: ${unresolvedItems.join(', ')}`
          : 'Todos os componentes têm fornecedor preferido vinculado.',
      };
    }

    // ---------- ANÁLISE DE COTAÇÕES ----------
    case 'analyze_quotation_responses': {
      const qId  = String(args.quotation_id ?? '');
      const mode = String(args.mode ?? 'full');
      if (!qId) throw new Error('quotation_id é obrigatório');

      // Busca todas as respostas com itens
      const { data: invites } = await supabase.from('quotation_invites')
        .select('id, supplier:suppliers(id, name)').eq('quotation_id', qId);
      const inviteIds = ((invites ?? []) as any[]).map((i) => i.id);
      if (!inviteIds.length) return { message: 'Nenhum convite encontrado nessa cotação.', responses: [] };

      const { data: responses, error } = await supabase.from('quotation_responses')
        .select(`id, supplier_name, currency, usd_brl_rate_used, payment_response, notes, submitted_at, invite_id,
                 items:quotation_response_items(
                   unit_price, ipi_pct, pis_pct, cofins_pct, st_pct,
                   quotation_item:quotation_items(id, quantity, component_id, component_name_free,
                     component:components(name))
                 )`)
        .in('invite_id', inviteIds)
        .order('submitted_at');
      if (error) throw new Error(error.message);

      // Busca convites sem resposta
      const respondedInviteIds = new Set(((responses ?? []) as any[]).map((r) => r.invite_id));
      const notResponded = ((invites ?? []) as any[])
        .filter((i) => !respondedInviteIds.has(i.id))
        .map((i) => (i.supplier as any)?.name ?? '?');

      // Normaliza preço pra BRL
      function effectivePriceBrl(item: any, currency: string, usdRate: number | null): number | null {
        if (item.unit_price == null) return null;
        const base = Number(item.unit_price);
        const taxes = 1 + Number(item.ipi_pct ?? 0) / 100 + Number(item.pis_pct ?? 0) / 100
          + Number(item.cofins_pct ?? 0) / 100 + Number(item.st_pct ?? 0) / 100;
        const brl = currency === 'USD' ? base * (usdRate ?? 1) : base;
        return parseFloat((brl * taxes).toFixed(4));
      }

      if (mode === 'full') {
        return {
          mode: 'full',
          responded_count: (responses ?? []).length,
          not_responded: notResponded,
          suppliers: ((responses ?? []) as any[]).map((r) => ({
            supplier_name:    r.supplier_name,
            currency:         r.currency,
            payment_response: r.payment_response,
            notes:            r.notes,
            submitted_at:     r.submitted_at,
            items: (r.items ?? []).map((it: any) => {
              const compName = it.quotation_item?.component?.name ?? it.quotation_item?.component_name_free ?? '?';
              const priceBrl = effectivePriceBrl(it, r.currency, r.usd_brl_rate_used);
              return { component: compName, quantity: it.quotation_item?.quantity, unit_price: it.unit_price, currency: r.currency, effective_price_brl: priceBrl, ipi_pct: it.ipi_pct, st_pct: it.st_pct };
            }),
          })),
        };
      }

      // mode === 'best_price': agrupa por componente, acha 1° e 2° menor preço
      const byComponent: Record<string, Array<{ supplier: string; price_brl: number; original_price: number; currency: string; payment: string }>> = {};
      for (const r of (responses ?? []) as any[]) {
        for (const it of r.items ?? []) {
          const compName = it.quotation_item?.component?.name ?? it.quotation_item?.component_name_free ?? '?';
          const priceBrl = effectivePriceBrl(it, r.currency, r.usd_brl_rate_used);
          if (priceBrl == null) continue;
          if (!byComponent[compName]) byComponent[compName] = [];
          byComponent[compName].push({ supplier: r.supplier_name, price_brl: priceBrl, original_price: Number(it.unit_price), currency: r.currency, payment: r.payment_response ?? '' });
        }
      }

      const bestPrices = Object.entries(byComponent).map(([comp, entries]) => {
        const sorted = [...entries].sort((a, b) => a.price_brl - b.price_brl);
        const best   = sorted[0];
        const second = sorted[1] ?? null;
        const saving = second ? parseFloat(((second.price_brl - best.price_brl) / second.price_brl * 100).toFixed(1)) : null;
        return {
          component:         comp,
          best_price_brl:    best.price_brl,
          best_supplier:     best.supplier,
          best_currency:     best.currency,
          best_payment:      best.payment,
          second_price_brl:  second?.price_brl ?? null,
          second_supplier:   second?.supplier ?? null,
          saving_vs_second_pct: saving,
        };
      }).sort((a, b) => a.component.localeCompare(b.component));

      return { mode: 'best_price', best_prices: bestPrices, not_responded: notResponded };
    }

    case 'get_component_price_history': {
      const compName = String(args.component_name ?? '').trim();
      const limit    = Math.min(Number(args.limit ?? 10), 50);

      const { data: comps } = await supabase.from('components')
        .select('id, name').ilike('name', `%${compName}%`).limit(1);
      const comp = (comps as any[])?.[0];
      if (!comp) return { component: compName, history: [], message: 'Componente não encontrado.' };

      // Busca todos quotation_items desse componente com respostas
      const { data: qItems } = await supabase.from('quotation_items')
        .select('id').eq('component_id', comp.id);
      const qItemIds = ((qItems ?? []) as any[]).map((i) => i.id);
      if (!qItemIds.length) return { component: comp.name, history: [], message: 'Nenhuma cotação com esse componente.' };

      const { data: responseItems, error } = await supabase.from('quotation_response_items')
        .select(`unit_price, ipi_pct, pis_pct, cofins_pct, st_pct,
                 response:quotation_responses(currency, usd_brl_rate_used, supplier_name, submitted_at,
                   invite:quotation_invites(quotation_id))`)
        .in('quotation_item_id', qItemIds)
        .not('unit_price', 'is', null)
        .order('quotation_responses.submitted_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);

      const history = ((responseItems ?? []) as any[]).map((it) => {
        const r   = it.response;
        const base = Number(it.unit_price);
        const taxes = 1 + (Number(it.ipi_pct) + Number(it.pis_pct) + Number(it.cofins_pct) + Number(it.st_pct)) / 100;
        const brl  = r.currency === 'USD' ? base * (r.usd_brl_rate_used ?? 1) : base;
        return {
          supplier:           r.supplier_name,
          submitted_at:       r.submitted_at,
          unit_price:         base,
          currency:           r.currency,
          effective_price_brl: parseFloat((brl * taxes).toFixed(4)),
          quotation_id:       r.invite?.quotation_id,
        };
      }).sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());

      // Calcula variação % entre entradas consecutivas
      for (let i = 0; i < history.length - 1; i++) {
        const prev = history[i + 1].effective_price_brl;
        const curr = history[i].effective_price_brl;
        (history[i] as any).change_pct = prev > 0 ? parseFloat(((curr - prev) / prev * 100).toFixed(1)) : null;
      }

      return { component: comp.name, history, count: history.length };
    }

    case 'check_expired_quotations': {
      const now = new Date().toISOString();
      // Cotações vencidas com convites ainda pendentes/sent
      const { data: expired, error } = await supabase.from('quotation_invites')
        .select(`id, supplier:suppliers(name, email),
                 quotation:quotations!inner(id, title, deadline, status)`)
        .in('status', ['pending', 'sent'])
        .not('quotations.deadline', 'is', null)
        .lt('quotations.deadline', now)
        .neq('quotations.status', 'closed');
      if (error) throw new Error(error.message);

      const grouped: Record<string, { quotation_title: string; non_responders: string[] }> = {};
      for (const inv of (expired ?? []) as any[]) {
        const qId    = inv.quotation?.id;
        const qTitle = inv.quotation?.title ?? qId;
        if (!grouped[qId]) grouped[qId] = { quotation_title: qTitle, non_responders: [] };
        const suppName = inv.supplier?.name ?? '?';
        grouped[qId].non_responders.push(suppName);

        // Marca convite como expirado
        await supabase.from('quotation_invites').update({ status: 'expired' }).eq('id', inv.id);
      }

      const result = Object.entries(grouped).map(([qId, g]) => ({
        quotation_id:    qId,
        quotation_title: g.quotation_title,
        non_responders:  g.non_responders,
      }));

      return {
        expired_count: result.length,
        quotations: result,
        message: result.length === 0
          ? 'Nenhuma cotação vencida com resposta pendente.'
          : `${result.length} cotação(ões) vencida(s) com fornecedor(es) que não responderam.`,
      };
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

      // Fallback de target: para componentes sem target_price_brl explícito
      // na BOM, busca o último custo conhecido (mais recente em qualquer BOM)
      const compIdsNeedingFallback = filtered
        .filter((b) => b.target_price_brl == null)
        .map((b) => b.component_id);
      const lastKnownTargets = await getLastKnownTargetByComponentIds(compIdsNeedingFallback);

      const itemsPayload = filtered.map((b, idx) => ({
        quotation_id: quotationId,
        component_id: b.component_id,
        quantity: b.quantity * units,
        target_price_brl: b.target_price_brl ?? lastKnownTargets.get(b.component_id) ?? null,
        position: idx,
      }));
      const fallbackUsedCount = filtered.filter((b) =>
        b.target_price_brl == null && lastKnownTargets.has(b.component_id)
      ).length;
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
        items_with_fallback_target: fallbackUsedCount,
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
        .select('quantity, target_price_brl, tipo, product:products(id, name)')
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
          tipo: (b.tipo === 'acervo' ? 'acervo' : 'fabricacao') as 'fabricacao' | 'acervo',
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

    case 'search_memories': {
      const keyword = String(args.keyword ?? '').trim();
      if (!keyword) throw new Error('keyword é obrigatório');
      const { data, error } = await supabase
        .from('agent_memories')
        .select('id, content, created_at')
        .ilike('content', `%${keyword}%`)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return { memories: data ?? [], count: (data ?? []).length };
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
      const components = (args.components ?? []) as Array<{
        name: string; sku?: string; quantity: number; unit?: string;
        target_price_brl?: number; value_unit?: number; price?: number;
        tipo?: 'fabricacao' | 'acervo';
        mount_type?: string;
      }>;
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
          const { data } = await supabase.from('components').select('id, name, mount_type').ilike('sku', comp.sku).maybeSingle();
          compRow = data;
        }
        if (!compRow) {
          const { data } = await supabase.from('components').select('id, name, mount_type').ilike('name', `%${comp.name}%`).limit(1);
          compRow = (data as any[])?.[0] ?? null;
        }

        const mountType = normalizeMountType(comp.mount_type, comp.name);

        if (compRow) {
          componentId = compRow.id;
          // Se detectamos mount_type pelo nome e o componente ainda não tinha, preenche
          if (mountType && !compRow.mount_type) {
            await supabase.from('components').update({ mount_type: mountType }).eq('id', componentId);
          }
        } else {
          // Cria componente automaticamente
          const insertPayload: any = {
            name: comp.name.trim(),
            sku: comp.sku?.trim() ?? null,
            unit: comp.unit ?? 'un',
          };
          if (mountType) insertPayload.mount_type = mountType;
          const { data: newComp, error: compErr } = await supabase
            .from('components')
            .insert(insertPayload)
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

        // Aceita target_price_brl (preferido), value_unit ou price (aliases tolerados)
        const rawPrice = comp.target_price_brl ?? comp.value_unit ?? comp.price;
        const targetPrice = rawPrice != null && Number.isFinite(Number(rawPrice))
          ? Number(rawPrice)
          : null;
        const tipo = comp.tipo === 'acervo' ? 'acervo' : 'fabricacao';

        if (existingBom) {
          const update: Record<string, unknown> = { quantity: comp.quantity, tipo };
          if (targetPrice != null) update.target_price_brl = targetPrice;
          await supabase.from('bom_items').update(update).eq('id', existingBom.id);
          results.push({ component: comp.name, action: 'atualizado', quantity: comp.quantity, target_price_brl: targetPrice, tipo });
        } else {
          const insert: Record<string, unknown> = { product_id: productId, component_id: componentId, quantity: comp.quantity, tipo };
          if (targetPrice != null) insert.target_price_brl = targetPrice;
          await supabase.from('bom_items').insert(insert);
          results.push({ component: comp.name, action: 'adicionado', quantity: comp.quantity, target_price_brl: targetPrice, tipo });
        }
      }

      const totalCost = results.reduce((sum, r) => sum + (r.target_price_brl != null ? r.target_price_brl * (r.quantity ?? 0) : 0), 0);
      return {
        product: productName,
        product_id: productId,
        created_product: !existing,
        components_processed: results.length,
        components_with_price: results.filter((r) => r.target_price_brl != null).length,
        unit_cost_brl: totalCost > 0 ? Number(totalCost.toFixed(4)) : null,
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
    // ---------- MARCAS PRÓPRIAS ----------
    // ---------- RH ----------
    case 'list_prestadores': {
      const st = String(args.status ?? 'PRESTADOR');
      let q = supabase.from('prestadores')
        .select('id, nome, valor_prestacao, conducao, carro, almoco_horario, status, aniversario, cpf, banco, agencia, conta, pix')
        .order('nome');
      if (st !== 'todos') q = q.eq('status', st);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { prestadores: data ?? [], count: (data ?? []).length };
    }

    case 'get_prestador': {
      const name = String(args.name ?? '').trim();
      const { data, error } = await supabase.from('prestadores')
        .select('*').ilike('nome', `%${name}%`).limit(1);
      if (error) throw new Error(error.message);
      const p = (data ?? [])[0];
      if (!p) return { found: false, message: `Prestador "${name}" não encontrado.` };
      return { found: true, prestador: p };
    }

    case 'update_prestador': {
      const name = String(args.name ?? '').trim();
      const { data: found } = await supabase.from('prestadores')
        .select('id, nome').ilike('nome', `%${name}%`).limit(1);
      const p = (found as any[])?.[0];
      if (!p) throw new Error(`Prestador "${name}" não encontrado.`);
      const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (args.valor_prestacao != null) fields.valor_prestacao  = Number(args.valor_prestacao);
      if (args.conducao        != null) fields.conducao         = Number(args.conducao);
      if (args.carro           != null) fields.carro            = Number(args.carro);
      if (args.almoco_horario)          fields.almoco_horario   = String(args.almoco_horario).trim();
      if (args.status)                  fields.status           = String(args.status).trim();
      if (args.aniversario)             fields.aniversario      = String(args.aniversario).trim();
      if (args.cpf)                     fields.cpf              = String(args.cpf).trim();
      if (args.banco)                   fields.banco            = String(args.banco).trim();
      if (args.agencia)                 fields.agencia          = String(args.agencia).trim();
      if (args.conta)                   fields.conta            = String(args.conta).trim();
      if (args.pix)                     fields.pix              = String(args.pix).trim();
      if (args.observacoes)             fields.observacoes      = String(args.observacoes).trim();
      const { error } = await supabase.from('prestadores').update(fields).eq('id', p.id);
      if (error) throw new Error(error.message);
      return { updated: true, nome: p.nome, changes: fields };
    }

    case 'create_prestador': {
      const nome = String(args.nome ?? '').trim();
      if (!nome) throw new Error('nome é obrigatório');
      const payload: Record<string, unknown> = { nome, status: 'PRESTADOR' };
      if (args.valor_prestacao != null) payload.valor_prestacao = Number(args.valor_prestacao);
      if (args.conducao        != null) payload.conducao        = Number(args.conducao);
      if (args.carro           != null) payload.carro           = Number(args.carro);
      if (args.almoco_horario)          payload.almoco_horario  = String(args.almoco_horario).trim();
      if (args.cpf)                     payload.cpf             = String(args.cpf).trim();
      if (args.banco)                   payload.banco           = String(args.banco).trim();
      if (args.agencia)                 payload.agencia         = String(args.agencia).trim();
      if (args.conta)                   payload.conta           = String(args.conta).trim();
      if (args.pix)                     payload.pix             = String(args.pix).trim();
      if (args.observacoes)             payload.observacoes     = String(args.observacoes).trim();
      const { data, error } = await supabase.from('prestadores').insert(payload).select('id, nome').single();
      if (error) throw new Error(error.message);
      return { created: data };
    }

    case 'save_whatsapp_contact': {
      const name  = String(args.name ?? '').trim();
      const notes = args.notes ? String(args.notes).trim() : null;
      if (!name) throw new Error('name é obrigatório');
      const rawPhone = String(args.phone ?? '').replace(/\D/g, '');
      if (!rawPhone) throw new Error('phone é obrigatório');
      const phone = rawPhone.startsWith('55') ? rawPhone : `55${rawPhone}`;

      // 1) Tenta achar por número primeiro (atualizar nome do contato existente)
      const { data: byPhone } = await supabase
        .from('whatsapp_contacts')
        .select('id, name')
        .eq('phone', phone)
        .maybeSingle();
      if (byPhone) {
        const { error } = await supabase
          .from('whatsapp_contacts')
          .update({ name, notes, updated_at: new Date().toISOString() })
          .eq('id', byPhone.id);
        if (error) throw new Error(error.message);
        return { updated: true, name, phone, message: `Contato do número ${phone} atualizado: "${(byPhone as any).name}" → "${name}"` };
      }

      // 2) Se não existe pelo número, tenta achar pelo nome (compat com fluxo antigo)
      const { data: byName } = await supabase
        .from('whatsapp_contacts')
        .select('id')
        .ilike('name', name)
        .limit(1)
        .maybeSingle();

      if (byName) {
        const { error } = await supabase
          .from('whatsapp_contacts')
          .update({ phone, notes, updated_at: new Date().toISOString() })
          .eq('id', byName.id);
        if (error) throw new Error(error.message);
        return { updated: true, name, phone, message: `Contato "${name}" atualizado → ${phone}` };
      }

      // 3) Cria novo
      const { error } = await supabase
        .from('whatsapp_contacts')
        .insert({ name, phone, notes });
      if (error) throw new Error(error.message);
      return { created: true, name, phone, message: `Contato "${name}" cadastrado → ${phone}` };
    }

    case 'find_whatsapp_contact': {
      const query = String(args.name ?? '').trim();
      if (!query) throw new Error('name é obrigatório');

      // Busca unificada em 3 tabelas: whatsapp_contacts (agenda), sellers
      // (vendedoras), client_contacts (clientes/CRM). Tenta ilike primeiro;
      // se nada encontrado em nenhuma, faz fuzzy fallback em todas.
      const [waRes, sellersRes, clientsRes] = await Promise.all([
        supabase.from('whatsapp_contacts').select('id, name, phone').ilike('name', `%${query}%`).limit(5),
        supabase.from('sellers').select('id, name, whatsapp_number').ilike('name', `%${query}%`).limit(5),
        supabase.from('client_contacts').select('id, name, whatsapp_phone').ilike('name', `%${query}%`).not('whatsapp_phone', 'is', null).limit(5),
      ]);

      let contacts: any[] = [
        ...((waRes.data ?? []) as any[]).map((c: any) => ({ id: c.id, name: c.name, phone: c.phone, source: 'agenda' })),
        ...((sellersRes.data ?? []) as any[]).map((s: any) => ({ id: s.id, name: s.name, phone: s.whatsapp_number, source: 'vendedora' })),
        ...((clientsRes.data ?? []) as any[]).map((c: any) => ({ id: c.id, name: c.name, phone: c.whatsapp_phone, source: 'cliente' })),
      ];
      let matchedBy: 'exact' | 'fuzzy' = 'exact';

      // Fallback fuzzy se ilike não encontrou em nenhuma tabela
      if (contacts.length === 0) {
        const [fuzzyWa, fuzzyClients] = await Promise.all([
          fuzzyFallback<{ id: string; name: string; phone: string; sim: number }>('search_whatsapp_contacts_fuzzy', query),
          fuzzyFallback<{ id: string; name: string; whatsapp_phone: string; sim: number }>('search_client_contacts_fuzzy', query),
        ]);
        // Sellers: como são poucos (~5), faz match in-memory
        const { data: allSellers } = await supabase.from('sellers').select('id, name, whatsapp_number');
        const fuzzySellers = ((allSellers ?? []) as any[])
          .map((s) => ({ ...s, sim: stringSimilarity(query, s.name) }))
          .filter((s) => s.sim > 0.3)
          .sort((a, b) => b.sim - a.sim);

        contacts = [
          ...fuzzyWa.map((c) => ({ id: c.id, name: c.name, phone: c.phone, source: 'agenda', similarity: c.sim })),
          ...fuzzySellers.map((s: any) => ({ id: s.id, name: s.name, phone: s.whatsapp_number, source: 'vendedora', similarity: s.sim })),
          ...fuzzyClients.filter((c) => c.whatsapp_phone).map((c) => ({ id: c.id, name: c.name, phone: c.whatsapp_phone, source: 'cliente', similarity: c.sim })),
        ];
        if (contacts.length > 0) matchedBy = 'fuzzy';
      }

      return { found: contacts.length, contacts, matched_by: matchedBy };
    }

    case 'list_whatsapp_contacts': {
      const { data, error } = await supabase
        .from('whatsapp_contacts')
        .select('id, name, phone, notes, updated_at')
        .order('name');
      if (error) throw new Error(error.message);
      return { total: (data ?? []).length, contacts: data ?? [] };
    }

    case 'generate_holiday_flyer': {
      const holiday = String(args.holiday ?? '').trim().toLowerCase();
      const mainText = String(args.main_text ?? '').trim();
      const secondaryText = args.secondary_text ? String(args.secondary_text).trim() : '';
      const customTheme = args.custom_theme ? String(args.custom_theme).trim() : '';
      const style = String(args.style ?? 'elegante').toLowerCase();
      const colorPaletteArg = args.color_palette ? String(args.color_palette).trim() : '';
      const imageSize = String(args.image_size ?? 'square_hd');
      const referenceImageUrl = args.reference_image_url ? String(args.reference_image_url).trim() : null;

      if (!mainText) throw new Error('main_text é obrigatório (texto que vai aparecer no flyer)');
      if (mainText.length > 60) {
        throw new Error('main_text muito longo — máximo 60 chars. A IA escreve no design, textos longos viram ilegíveis.');
      }

      // Identidade visual EGP — TODA holiday é gerada com fundo claro e
      // o rosa da marca (#CB1464) como cor de destaque/acento.
      const EGP_BRAND_PINK = '#CB1464';

      // Mapeia holiday → cena + paleta (cada paleta já inclui o EGP pink)
      const HOLIDAY_CFG: Record<string, { scene: string; palette: string; vibe: string }> = {
        maes: {
          scene: 'a tender Mother\'s Day scene with a mother joyfully holding a smiling baby in soft window light, floating pink rose petals and heart accents, bright airy bokeh, predominantly white and light cream background with delicate pink decorative elements on the sides',
          palette: `bright white background dominant, EGP signature pink ${EGP_BRAND_PINK}, soft blush, rose gold accents, cream highlights`,
          vibe: 'tender, warm, loving, celebratory, fresh and bright',
        },
        pais: {
          scene: 'a heartwarming Father\'s Day scene with a smiling father and child sharing a moment, bright window light, white minimalist background with subtle pink and warm accents on borders',
          palette: `clean white background, EGP brand pink ${EGP_BRAND_PINK} accents, warm grey, soft gold details`,
          vibe: 'strong, warm, family, gratitude, modern and clean',
        },
        namorados: {
          scene: 'a romantic minimalist scene with floating pink roses and elegant hearts, bright white airy background, soft natural lighting',
          palette: `pure white background, EGP brand pink ${EGP_BRAND_PINK}, blush rose, cream`,
          vibe: 'romantic, elegant, fresh, modern',
        },
        criancas: {
          scene: 'a joyful minimalist Children\'s Day scene with floating colorful pastel balloons, candies, and playful stars on a bright white background',
          palette: `white dominant background, EGP brand pink ${EGP_BRAND_PINK}, pastel rainbow accents (soft blue, mint, yellow)`,
          vibe: 'playful, joyful, energetic, fresh and bright',
        },
        professor: {
          scene: 'an elegant tribute to teachers: an open book, eyeglasses, an apple and chalk elements floating with pink ribbon details, bright clean white background',
          palette: `white background, EGP pink ${EGP_BRAND_PINK} accents, soft gold, warm grey`,
          vibe: 'respectful, appreciative, scholarly, modern',
        },
        natal: {
          scene: 'an elegant minimalist Christmas scene with a decorated Christmas tree, soft falling snowflakes, golden lights, pink and gold ornaments, bright white winter background',
          palette: `white background, EGP brand pink ${EGP_BRAND_PINK} ornaments, classic Christmas red and gold accents, fresh white snow`,
          vibe: 'festive, magical, warm, family, fresh and bright',
        },
        ano_novo: {
          scene: 'an elegant New Year scene with golden fireworks, champagne glasses and confetti on a bright minimalist white background with pink accents',
          palette: `bright white background, gold and EGP pink ${EGP_BRAND_PINK} confetti, silver details`,
          vibe: 'celebratory, hopeful, glamorous, fresh',
        },
        pascoa: {
          scene: 'an Easter scene with pastel decorated eggs, spring flowers, soft bunny silhouettes on a bright white background',
          palette: `clean white background, EGP brand pink ${EGP_BRAND_PINK}, pastel mint, soft lavender, cream`,
          vibe: 'fresh, joyful, soft, spring renewal',
        },
        independencia: {
          scene: 'a tasteful Brazilian Independence Day scene with subtle Brazilian flag color accents (green, yellow, blue) and EGP pink details, clean white background',
          palette: `white background, Brazilian flag colors (green, yellow, blue) with EGP brand pink ${EGP_BRAND_PINK} ribbon as accent`,
          vibe: 'patriotic, proud, modern and clean',
        },
        consumidor: {
          scene: 'a customer appreciation scene with elegant shopping bags, gift boxes and stars on a bright minimalist white background',
          palette: `bright white background, EGP brand pink ${EGP_BRAND_PINK}, soft gold accents`,
          vibe: 'grateful, premium, customer-focused, fresh',
        },
        consciencia_negra: {
          scene: 'a powerful tribute scene celebrating Black consciousness with diverse smiling people portraits and traditional pattern accents on a bright background',
          palette: `warm cream and white background, rich earth tones, gold, deep red, with EGP pink ${EGP_BRAND_PINK} accent`,
          vibe: 'powerful, respectful, dignified, modern',
        },
        black_friday: {
          scene: 'a bold modern sales promotion scene with price tags, shopping bags and dynamic geometric elements on a bright contrasting background',
          palette: `bright white and EGP pink ${EGP_BRAND_PINK} dominant, with bold black price tags as accent`,
          vibe: 'energetic, modern, fresh take on black friday',
        },
        aniversario_empresa: {
          scene: 'a corporate anniversary celebration scene with elegant balloons, golden confetti and EGP pink accents on a bright white background',
          palette: `bright white background, EGP brand pink ${EGP_BRAND_PINK} dominant, gold and silver accents`,
          vibe: 'celebratory, premium, professional, fresh milestone',
        },
        outro: {
          scene: (customTheme || 'a beautiful corporate celebration scene') + ' on a bright clean white background with pink decorative accents',
          palette: `white background dominant, EGP brand pink ${EGP_BRAND_PINK} accents, harmonious complementary tones`,
          vibe: 'professional, celebratory, fresh and clean',
        },
      };

      const cfg = HOLIDAY_CFG[holiday] ?? HOLIDAY_CFG['outro'];
      const palette = colorPaletteArg
        ? `${colorPaletteArg}, with EGP brand pink ${EGP_BRAND_PINK} as accent color`
        : cfg.palette;

      const STYLE_QUALIFIERS: Record<string, string> = {
        suave: 'soft airy lighting, dreamy bokeh, romantic atmosphere, light and bright',
        vibrante: 'vibrant saturated colors with bright background, dynamic energetic composition',
        elegante: 'refined elegant composition, premium magazine-quality, sophisticated bright lighting',
        festivo: 'cheerful festive atmosphere on a bright background, decorative elements',
      };
      const styleQualifier = STYLE_QUALIFIERS[style] ?? STYLE_QUALIFIERS['elegante'];

      // Monta prompt em inglês (Flux performa melhor em EN). O texto fica em PT
      // porque a IA escreve LITERAL o que vem entre aspas.
      const textInstruction = secondaryText
        ? `Large elegant calligraphic script text "${mainText}" in EGP pink ${EGP_BRAND_PINK} as the main visual element, with smaller text "${secondaryText}" nearby in a complementary modern font.`
        : `Large elegant calligraphic script text "${mainText}" in EGP pink ${EGP_BRAND_PINK} as the main visual element, beautifully integrated.`;

      const prompt = [
        'Professional EGP-branded marketing flyer for social media (Instagram post).',
        cfg.scene + '.',
        textInstruction,
        `Color palette: ${palette}.`,
        styleQualifier + '.',
        `Mood: ${cfg.vibe}.`,
        // Reforço crítico de identidade EGP — o que mais impacta o resultado:
        `IMPORTANT BRANDING: bright white or very light background dominant (60-80% of the image), EGP signature pink ${EGP_BRAND_PINK} as the main accent color throughout the composition, clean modern corporate aesthetic, generous white space, NOT dark or moody.`,
        'Leave the bottom-left corner clean and uncluttered for company logo placement.',
        'High quality commercial design. No watermarks. No stock-image text overlays.',
      ].join(' ');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const reqBody: Record<string, unknown> = {
        prompt,
        image_size: imageSize,
        model: 'dev',
        skip_product_overlay: true,
        lighter_branding: true,
      };
      if (referenceImageUrl) reqBody.reference_image_url = referenceImageUrl;

      const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify(reqBody),
      });
      const genJson = await genRes.json();
      if (!genRes.ok) throw new Error(genJson.error ?? 'Falha ao gerar flyer');

      return {
        image_url: genJson.url,
        stored: genJson.stored,
        branded: genJson.branded,
        model_used: genJson.model_used ?? 'flux-dev',
        prompt_used: prompt,
        holiday,
        main_text: mainText,
        secondary_text: secondaryText || null,
        instruction:
          'Mostre o preview ao usuário com markdown: ![Preview](url). ' +
          'Diga que o flyer foi gerado e pergunte: 1) Salvar na galeria (save_marketing_asset)? 2) Enviar pra alguém via WhatsApp (send_whatsapp_image)? 3) Gerar variação (chamar de novo com estilo diferente)? ' +
          'NÃO envie nem salve sem aprovação explícita.',
      };
    }

    case 'save_marketing_asset': {
      const imageUrl = String(args.image_url ?? '').trim();
      const title = String(args.title ?? '').trim();
      if (!imageUrl) throw new Error('image_url é obrigatório');
      if (!title) throw new Error('title é obrigatório');

      const payload: Record<string, unknown> = {
        image_url: imageUrl,
        title,
        holiday: args.holiday ? String(args.holiday).trim().toLowerCase() : null,
        tags: Array.isArray(args.tags) ? args.tags.map((t: any) => String(t).trim()).filter(Boolean) : [],
        notes: args.notes ? String(args.notes).trim() : null,
        prompt_used: args.prompt_used ? String(args.prompt_used) : null,
        model_used: args.model_used ? String(args.model_used) : null,
        created_by: ctx.currentUser ?? null,
      };

      const { data, error } = await supabase
        .from('marketing_assets')
        .insert(payload)
        .select('id, image_url, title, holiday, tags, created_at')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Falha ao salvar asset');
      await verifyWrite('marketing_assets', (data as any).id, 'save_marketing_asset');
      return { saved: true, verified: true, asset: data };
    }

    case 'list_marketing_assets': {
      let q = supabase
        .from('marketing_assets')
        .select('id, image_url, title, holiday, tags, notes, created_at, created_by')
        .order('created_at', { ascending: false })
        .limit(Number(args.limit ?? 30));
      if (args.holiday) q = q.eq('holiday', String(args.holiday).toLowerCase());
      if (args.tag) q = q.contains('tags', [String(args.tag)]);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { assets: data ?? [], count: (data ?? []).length };
    }

    case 'delete_marketing_asset': {
      const id = String(args.asset_id ?? '');
      if (!id) throw new Error('asset_id é obrigatório');
      const { error } = await supabase.from('marketing_assets').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, id };
    }

    case 'generate_image': {
      const templateId      = String(args.template_id ?? 'promocao_produto').trim();
      const productFilename = String(args.product_filename ?? '').trim();
      const cor             = String(args.cor ?? 'blue').trim();
      const imageSizeArg    = String(args.image_size ?? 'landscape_4_3').trim();

      // Fundo limpo e neutro — o produto real é sobreposto server-side via jimp
      // Prompts focados em gradiente sólido + espaço central vazio para o produto
      const TEMPLATE_PROMPTS: Record<string, string> = {
        promocao_produto:  `Clean professional product display background. Smooth ${cor} gradient from bottom-left to top-right, soft subtle geometric lines, minimal abstract shapes on the sides. Bright center area kept clean for product placement. Commercial quality, vibrant. No objects, no text.`,
        lancamento:        `Dramatic product reveal background. Dark ${cor === 'blue' ? 'deep navy' : cor} gradient, subtle radial glow in center, thin light streaks on edges, cinematic premium atmosphere. Central area clear for product. No text.`,
        liquidacao:        'Bold sale promotion background. Strong red-to-black diagonal gradient, golden accent lines on corners, energetic abstract shapes on edges, center area clean and bright. No text.',
        data_comemorativa: `Festive celebration background. Elegant gradient with warm celebratory colors, decorative elements on the borders, clean central space. Professional marketing quality. No text.`,
        institucional:     `Professional corporate background. Clean ${cor} and white gradient, abstract circuit pattern on edges only, premium business aesthetic, wide open center. No text.`,
        agradecimento:     `Warm appreciation background. Soft golden gradient, elegant subtle pattern on borders, generous clear center space, premium feel. No text.`,
      };
      const prompt = TEMPLATE_PROMPTS[templateId] ?? TEMPLATE_PROMPTS['promocao_produto'];

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const genRes  = await fetch(`${supabaseUrl}/functions/v1/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ prompt, image_size: imageSizeArg, product_filename: productFilename || undefined }),
      });
      const genJson = await genRes.json();
      if (!genRes.ok) throw new Error(genJson.error ?? 'Falha ao gerar imagem');

      return {
        image_url: genJson.url,
        stored: genJson.stored,
        branded: genJson.branded,
        instruction: 'Mostre a imagem para o usuário usando markdown image: ![Preview](url). Depois pergunte se deseja enviar e para qual contato. NÃO envie sem aprovação explícita.',
      };
    }

    case 'send_whatsapp_image': {
      const phoneRaw   = String(args.phone ?? '').trim();
      const imageUrl   = String(args.image_url ?? '').trim();
      const caption    = String(args.caption ?? '').trim();

      if (!phoneRaw)  throw new Error('phone é obrigatório');
      if (!imageUrl)  throw new Error('image_url é obrigatório');

      // Resolve número por nome se necessário
      let phone = phoneRaw.replace(/\D/g, '');
      if (!phone || phone.length < 8) {
        const { data: found } = await supabase
          .from('whatsapp_contacts')
          .select('phone')
          .ilike('name', `%${phoneRaw}%`)
          .limit(1);
        const resolved = (found as any)?.[0]?.phone;
        if (!resolved) throw new Error(`Contato "${phoneRaw}" não encontrado. Informe o número diretamente.`);
        phone = resolved;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const sendRes  = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({
          to: phone,
          image_url: imageUrl,
          text: caption || undefined,
          sender_label: ctx.currentUser,
        }),
      });
      const sendJson = await sendRes.json();
      if (!sendRes.ok) throw new Error(sendJson.error ?? 'Falha ao enviar');

      return { sent: true, to: phone, message_id: sendJson.message_id };
    }

    case 'send_whatsapp_message': {
      const phone   = String(args.phone ?? '').replace(/\D/g, '');
      const message = String(args.message ?? '').trim();
      if (!phone) throw new Error('phone é obrigatório');
      if (!message) throw new Error('message é obrigatório');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ to: phone, text: message, sender_label: ctx.currentUser }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha ao enviar mensagem WhatsApp');
      return { sent: true, to: phone, message_id: json.message_id };
    }

    case 'send_whatsapp_broadcast':
    case 'send_whatsapp_broadcast_template': {
      const isTemplate = name === 'send_whatsapp_broadcast_template';
      const recipients = Array.isArray(args.recipients) ? args.recipients.map((r: any) => String(r).trim()).filter(Boolean) : [];
      if (recipients.length === 0) throw new Error('recipients vazio');
      if (recipients.length > 100) throw new Error('Máximo 100 destinatários por chamada');

      const message = !isTemplate ? String(args.message ?? '').trim() : null;
      if (!isTemplate && !message) throw new Error('message é obrigatório');

      const templateName = isTemplate ? String(args.template_name ?? '').trim() : null;
      const templateLang = isTemplate ? String(args.template_lang ?? 'pt_BR') : 'pt_BR';
      const templateParams = Array.isArray(args.template_params) ? args.template_params.map((p: any) => String(p)) : [];
      if (isTemplate && !templateName) throw new Error('template_name é obrigatório');

      // Resolve cada recipient → { name, phone }
      const resolved: Array<{ original: string; name: string; phone: string | null; error?: string }> = [];
      for (const r of recipients) {
        const digits = r.replace(/\D/g, '');
        // Se parece com número (10+ dígitos), usa direto
        if (digits.length >= 10) {
          const phone = digits.startsWith('55') ? digits : `55${digits}`;
          resolved.push({ original: r, name: r, phone });
          continue;
        }
        // Senão busca por nome em client_contacts e whatsapp_contacts
        const { data: client } = await supabase
          .from('client_contacts')
          .select('name, trade_name, whatsapp_phone')
          .ilike('name', `%${r}%`)
          .not('whatsapp_phone', 'is', null)
          .limit(1)
          .maybeSingle();
        if (client && (client as any).whatsapp_phone) {
          resolved.push({
            original: r,
            name: (client as any).trade_name ?? (client as any).name,
            phone: (client as any).whatsapp_phone,
          });
          continue;
        }
        const { data: contact } = await supabase
          .from('whatsapp_contacts')
          .select('name, phone')
          .ilike('name', `%${r}%`)
          .limit(1)
          .maybeSingle();
        if (contact) {
          resolved.push({
            original: r,
            name: (contact as any).name,
            phone: (contact as any).phone,
          });
          continue;
        }
        resolved.push({ original: r, name: r, phone: null, error: 'não encontrado' });
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      // Envia em paralelo (limite simples: até 10 simultâneos)
      async function sendOne(r: { name: string; phone: string }): Promise<{ ok: boolean; message_id?: string; error?: string }> {
        try {
          let body: Record<string, unknown>;
          if (isTemplate) {
            // Resolve placeholders {{name}} / {{first_name}} para o destinatário
            const params = templateParams.map((p: string) =>
              p.replace(/\{\{name\}\}/gi, r.name)
               .replace(/\{\{first_name\}\}/gi, (r.name.split(' ')[0] ?? r.name))
            );
            body = { to: r.phone, template: { name: templateName, language: templateLang, params }, sender_label: ctx.currentUser };
          } else {
            body = { to: r.phone, text: message, sender_label: ctx.currentUser };
          }
          const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
            body: JSON.stringify(body),
          });
          const json = await res.json();
          if (!res.ok) return { ok: false, error: json.error ?? 'falha' };
          return { ok: true, message_id: json.message_id };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }

      const results: Array<{ recipient: string; phone: string | null; ok: boolean; message_id?: string; error?: string }> = [];

      // Processa em lotes de 10
      const validResolved = resolved.filter((r) => r.phone);
      for (let i = 0; i < validResolved.length; i += 10) {
        const batch = validResolved.slice(i, i + 10);
        const batchResults = await Promise.all(batch.map((r) => sendOne(r as { name: string; phone: string })));
        batch.forEach((r, idx) => {
          results.push({
            recipient: r.original,
            phone: r.phone,
            ok: batchResults[idx].ok,
            message_id: batchResults[idx].message_id,
            error: batchResults[idx].error,
          });
        });
      }

      // Adiciona não resolvidos
      for (const r of resolved.filter((x) => !x.phone)) {
        results.push({ recipient: r.original, phone: null, ok: false, error: r.error ?? 'sem WhatsApp' });
      }

      const sucesso = results.filter((r) => r.ok).length;
      const falha = results.length - sucesso;

      return {
        mode: isTemplate ? 'template' : 'text',
        template_name: templateName,
        total: results.length,
        sucesso,
        falha,
        results,
      };
    }

    case 'list_marketing_templates': {
      const { data, error } = await supabase
        .from('marketing_templates')
        .select('name, template_id, caption, created_at, created_by')
        .order('name');
      if (error) throw new Error(error.message);
      return {
        total: (data ?? []).length,
        templates: (data ?? []).map((t: any) => ({
          name: t.name,
          type: t.template_id,
          caption: t.caption,
          created_at: t.created_at?.slice(0, 10),
          created_by: t.created_by,
        })),
      };
    }

    case 'send_marketing_template': {
      const templateName    = String(args.template_name ?? '').trim();
      const recipients      = Array.isArray(args.recipients) ? args.recipients.map(String) : [];
      const captionOverride = String(args.caption_override ?? '').trim();

      if (!templateName)       throw new Error('template_name é obrigatório');
      if (recipients.length === 0) throw new Error('recipients deve ter pelo menos 1 destinatário');

      // Busca template por nome — ilike primeiro, fuzzy fallback se não achou
      let found: any[] = [];
      const { data: ilikeData } = await supabase
        .from('marketing_templates')
        .select('*')
        .ilike('name', `%${templateName}%`)
        .order('name')
        .limit(3);
      found = (ilikeData ?? []) as any[];

      if (found.length === 0) {
        const fuzzy = await fuzzyFallback<{ id: string; name: string; sim: number }>(
          'search_marketing_templates_fuzzy',
          templateName
        );
        if (fuzzy.length > 0) {
          const ids = fuzzy.map((f) => f.id);
          const { data: enriched } = await supabase
            .from('marketing_templates').select('*').in('id', ids);
          const byId = new Map((enriched ?? []).map((t: any) => [t.id, t]));
          found = fuzzy.map((f) => byId.get(f.id)).filter(Boolean) as any[];
        }
      }

      if (!found.length) {
        const { data: all } = await supabase
          .from('marketing_templates')
          .select('name, template_id')
          .order('name');
        return {
          found: false,
          error: `Template "${templateName}" não encontrado.`,
          message: 'Nenhum template com esse nome existe. Peça ao usuário para criar o template primeiro em Vendas → Imagens IA.',
          available_templates: (all ?? []).map((t: any) => t.name),
        };
      }

      const tmpl     = (found[0]) as any;
      const imageUrl  = tmpl.image_url as string;
      const formData  = (tmpl.form_data ?? {}) as Record<string, string>;
      const tmplId    = (tmpl.template_id ?? '') as string;

      // Detecta se é template de promoção (tem preço) → usa Meta template aprovado
      // para contornar a janela de 24h
      const isPromo = tmplId === 'promocao' && formData.preco_promocional;
      const META_PROMO_TEMPLATE = 'promo_imagem_egp';

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      // Envia para cada destinatário
      const results: { recipient: string; phone: string | null; success: boolean; via?: string; error?: string }[] = [];

      for (const recipient of recipients) {
        // Resolve número — se já é dígitos, usa direto. Senão busca em
        // whatsapp_contacts → sellers → client_contacts (com fuzzy fallback).
        let phone = recipient.replace(/\D/g, '');
        if (!phone || phone.length < 8) {
          const resolved = await resolveRecipientPhoneByName(recipient);
          if (!resolved) {
            results.push({ recipient, phone: null, success: false, error: `Contato "${recipient}" não encontrado em agenda, vendedoras ou clientes` });
            continue;
          }
          phone = resolved;
        }

        let sendBody: Record<string, unknown>;
        let via: string;

        if (isPromo) {
          // Usa o template Meta aprovado com imagem no header + variáveis no body
          // Funciona fora da janela de 24h
          sendBody = {
            to: phone,
            template: {
              name: META_PROMO_TEMPLATE,
              language: 'pt_BR',
              image_url: imageUrl,
              params: [
                formData.produto         || tmpl.name,
                formData.preco_promocional,
                formData.condicao        || 'à vista',
              ].filter(Boolean),
            },
            sender_label: ctx.currentUser,
          };
          via = `meta:${META_PROMO_TEMPLATE}`;
        } else {
          // Outros templates: envia como imagem normal (requer janela 24h)
          sendBody = {
            to: phone,
            image_url: imageUrl,
            text: captionOverride || (tmpl.caption as string | null) || undefined,
            sender_label: ctx.currentUser,
          };
          via = 'image';
        }

        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
          body: JSON.stringify(sendBody),
        });
        const json = await res.json();
        results.push({ recipient, phone, success: res.ok, via, error: res.ok ? undefined : (json.error ?? 'Falha ao enviar') });
      }

      const sent   = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return {
        template_used: tmpl.name,
        total: recipients.length,
        sent,
        failed,
        results,
      };
    }

    case 'list_whatsapp_conversations': {
      const limit = Number(args.limit ?? 10);
      const { data: sessions } = await supabase
        .from('whatsapp_sessions')
        .select('phone, updated_at')
        .order('updated_at', { ascending: false })
        .limit(limit);

      const convs = await Promise.all(
        ((sessions ?? []) as any[]).map(async (s) => {
          const { data: msgs } = await supabase
            .from('whatsapp_messages')
            .select('direction, text, created_at')
            .eq('phone', s.phone)
            .order('created_at', { ascending: false })
            .limit(1);
          const last = (msgs as any[])?.[0];
          return {
            phone: s.phone,
            last_activity: s.updated_at,
            last_message: last?.text?.slice(0, 100),
            last_direction: last?.direction,
          };
        })
      );
      return { total: convs.length, conversations: convs };
    }

    case 'get_whatsapp_conversation': {
      const phone = String(args.phone ?? '').replace(/\D/g, '');
      if (!phone) throw new Error('phone é obrigatório');
      const limit = Number(args.limit ?? 20);

      const { data: msgs } = await supabase
        .from('whatsapp_messages')
        .select('direction, text, created_at')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(limit);

      return {
        phone,
        messages: ((msgs ?? []) as any[]).reverse().map((m) => ({
          from: m.direction === 'in' ? 'cliente' : 'egp',
          text: m.text,
          time: m.created_at,
        })),
      };
    }

    // ---------- CLIENTES (CRM/Marketing) ----------
    case 'list_client_contacts': {
      const filter = String(args.filter ?? 'all');
      const tag    = args.tag ? String(args.tag).trim() : null;
      const limit  = Number(args.limit ?? 50);

      let q = supabase.from('client_contacts')
        .select('id, name, trade_name, cnpj, whatsapp_phone, email, last_purchase_at, total_orders, total_spent, tags, opt_in_promo, opt_in_catalog')
        .order('last_purchase_at', { ascending: false, nullsFirst: false })
        .limit(limit);

      const cutoff60 = new Date(Date.now() - 60 * 86400000).toISOString();
      if (filter === 'active')          q = q.gte('last_purchase_at', cutoff60);
      else if (filter === 'inactive')   q = q.lt('last_purchase_at', cutoff60);
      else if (filter === 'no_whatsapp') q = q.is('whatsapp_phone', null);
      else if (filter === 'opt_in_promo')   q = q.eq('opt_in_promo', true);
      else if (filter === 'opt_in_catalog') q = q.eq('opt_in_catalog', true);

      if (tag) q = q.contains('tags', [tag]);

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: (data ?? []).length, filter, clients: data ?? [] };
    }

    case 'find_client_contact': {
      const query = String(args.query ?? '').trim();
      if (!query) throw new Error('query é obrigatório');
      const digits = query.replace(/\D/g, '');
      const phoneNorm = digits.length >= 10 ? (digits.startsWith('55') ? digits : `55${digits}`) : null;

      let q = supabase.from('client_contacts')
        .select('id, name, trade_name, cnpj, whatsapp_phone, email, total_orders, total_spent, last_purchase_at, tags, opt_in_promo, opt_in_catalog')
        .limit(10);

      if (phoneNorm) {
        q = q.eq('whatsapp_phone', phoneNorm);
      } else if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(query) || digits.length === 14) {
        q = q.eq('cnpj', query);
      } else {
        q = q.or(`name.ilike.%${query}%,trade_name.ilike.%${query}%`);
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      let list = (data ?? []) as any[];
      let matchedBy: 'exact' | 'fuzzy' = 'exact';
      // Fallback fuzzy só para busca por nome (não pra cnpj/telefone)
      if (list.length === 0 && !phoneNorm && !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(query) && digits.length !== 14) {
        const fuzzy = await fuzzyFallback<{ id: string; name: string; whatsapp_phone: string; cnpj: string; sim: number }>(
          'search_client_contacts_fuzzy',
          query
        );
        if (fuzzy.length > 0) {
          const ids = fuzzy.map((f) => f.id);
          const { data: enriched } = await supabase
            .from('client_contacts')
            .select('id, name, trade_name, cnpj, whatsapp_phone, email, total_orders, total_spent, last_purchase_at, tags, opt_in_promo, opt_in_catalog')
            .in('id', ids);
          const byId = new Map((enriched ?? []).map((c: any) => [c.id, c]));
          list = fuzzy.map((f) => byId.get(f.id)).filter(Boolean) as any[];
          matchedBy = 'fuzzy';
        }
      }
      if (list.length === 0) return { found: 0, message: `Nenhum cliente encontrado para "${query}"`, matched_by: matchedBy };
      return {
        found: list.length,
        matched_by: matchedBy,
        best_match: list[0],
        candidates: list.slice(1, 5),
      };
    }

    case 'save_client_contact': {
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('name é obrigatório');
      const wppDigits = args.whatsapp_phone ? String(args.whatsapp_phone).replace(/\D/g, '') : '';
      const wpp = wppDigits ? (wppDigits.startsWith('55') ? wppDigits : `55${wppDigits}`) : null;
      const optIn = !!(args.opt_in_promo || args.opt_in_catalog);
      const payload: Record<string, unknown> = {
        name,
        trade_name:     args.trade_name     ? String(args.trade_name).trim() : null,
        cnpj:           args.cnpj           ? String(args.cnpj).trim()       : null,
        whatsapp_phone: wpp,
        phone:          args.phone          ? String(args.phone).trim()      : null,
        email:          args.email          ? String(args.email).trim().toLowerCase() : null,
        address:        args.address        ? String(args.address).trim()    : null,
        notes:          args.notes          ? String(args.notes).trim()      : null,
        tags:           Array.isArray(args.tags) ? args.tags.map((t: any) => String(t).trim()).filter(Boolean) : [],
        opt_in_promo:   args.opt_in_promo === true,
        opt_in_catalog: args.opt_in_catalog === true,
        opt_in_at:      optIn ? new Date().toISOString() : null,
      };
      const { data, error } = await supabase
        .from('client_contacts').insert(payload)
        .select('id, name, whatsapp_phone, cnpj').single();
      if (error) throw new Error(error.message);
      return { created: data };
    }

    case 'update_client_contact': {
      let clientId = args.client_id ? String(args.client_id) : null;
      if (!clientId && args.query) {
        const query = String(args.query).trim();
        const digits = query.replace(/\D/g, '');
        const phoneNorm = digits.length >= 10 ? (digits.startsWith('55') ? digits : `55${digits}`) : null;
        let q = supabase.from('client_contacts').select('id').limit(1);
        if (phoneNorm) q = q.eq('whatsapp_phone', phoneNorm);
        else if (digits.length === 14) q = q.eq('cnpj', query);
        else q = q.or(`name.ilike.%${query}%,trade_name.ilike.%${query}%`);
        const { data: found } = await q;
        clientId = (found?.[0] as any)?.id ?? null;
      }
      if (!clientId) throw new Error('Cliente não encontrado. Use client_id ou query.');

      const patch: Record<string, unknown> = {};
      if (args.name !== undefined)       patch.name = String(args.name).trim();
      if (args.trade_name !== undefined) patch.trade_name = args.trade_name ? String(args.trade_name).trim() : null;
      if (args.cnpj !== undefined)       patch.cnpj = args.cnpj ? String(args.cnpj).trim() : null;
      if (args.phone !== undefined)      patch.phone = args.phone ? String(args.phone).trim() : null;
      if (args.email !== undefined)      patch.email = args.email ? String(args.email).trim().toLowerCase() : null;
      if (args.address !== undefined)    patch.address = args.address ? String(args.address).trim() : null;
      if (args.notes !== undefined)      patch.notes = args.notes ? String(args.notes).trim() : null;
      if (args.whatsapp_phone !== undefined) {
        const d = String(args.whatsapp_phone).replace(/\D/g, '');
        patch.whatsapp_phone = d ? (d.startsWith('55') ? d : `55${d}`) : null;
      }
      if (args.opt_in_promo !== undefined)   { patch.opt_in_promo = !!args.opt_in_promo; if (args.opt_in_promo) patch.opt_in_at = new Date().toISOString(); }
      if (args.opt_in_catalog !== undefined) { patch.opt_in_catalog = !!args.opt_in_catalog; if (args.opt_in_catalog) patch.opt_in_at = new Date().toISOString(); }

      if (Object.keys(patch).length === 0) throw new Error('Nada a atualizar');

      const { data, error } = await supabase
        .from('client_contacts').update(patch).eq('id', clientId)
        .select('id, name, whatsapp_phone, cnpj').single();
      if (error) throw new Error(error.message);
      return { updated: true, client: data, changes: patch };
    }

    case 'tag_client_contact': {
      let clientId = args.client_id ? String(args.client_id) : null;
      if (!clientId && args.query) {
        const query = String(args.query).trim();
        const { data: found } = await supabase.from('client_contacts')
          .select('id, tags')
          .or(`name.ilike.%${query}%,trade_name.ilike.%${query}%,cnpj.eq.${query}`)
          .limit(1);
        clientId = (found?.[0] as any)?.id ?? null;
      }
      if (!clientId) throw new Error('Cliente não encontrado.');

      const { data: current } = await supabase.from('client_contacts')
        .select('tags').eq('id', clientId).single();
      const currentTags = ((current as any)?.tags ?? []) as string[];
      const addTags = Array.isArray(args.add_tags) ? args.add_tags.map((t: any) => String(t).trim()).filter(Boolean) : [];
      const removeTags = Array.isArray(args.remove_tags) ? args.remove_tags.map((t: any) => String(t).trim()).filter(Boolean) : [];

      const newTags = [...new Set([...currentTags, ...addTags])].filter((t) => !removeTags.includes(t));

      const { error } = await supabase.from('client_contacts').update({ tags: newTags }).eq('id', clientId);
      if (error) throw new Error(error.message);
      return { updated: true, tags: newTags, added: addTags, removed: removeTags };
    }

    case 'delete_client_contact': {
      let clientId = args.client_id ? String(args.client_id) : null;
      if (!clientId && args.query) {
        const query = String(args.query).trim();
        const { data: found } = await supabase.from('client_contacts')
          .select('id').or(`name.ilike.%${query}%,trade_name.ilike.%${query}%`).limit(1);
        clientId = (found?.[0] as any)?.id ?? null;
      }
      if (!clientId) throw new Error('Cliente não encontrado.');
      const { error } = await supabase.from('client_contacts').delete().eq('id', clientId);
      if (error) throw new Error(error.message);
      return { deleted: true, client_id: clientId };
    }

    case 'list_client_brands': {
      const activeOnly = args.active_only !== false;
      let q = supabase.from('client_brands')
        .select('id, brand_name, client_name, notes, active, created_at')
        .order('brand_name');
      if (activeOnly) q = q.eq('active', true);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { brands: data ?? [], count: (data ?? []).length };
    }

    case 'register_client_brand': {
      const brandName  = String(args.brand_name ?? '').trim().toUpperCase();
      if (!brandName) throw new Error('brand_name é obrigatório');
      const clientName = args.client_name ? String(args.client_name).trim() : null;
      const notes      = args.notes ? String(args.notes).trim() : null;
      const { data, error } = await supabase.from('client_brands')
        .upsert({ brand_name: brandName, client_name: clientName, notes, active: true },
                 { onConflict: 'brand_name' })
        .select('id, brand_name, client_name').single();
      if (error) throw new Error(error.message);
      return { registered: data };
    }

    case 'delete_client_brand': {
      const brandName = String(args.brand_name ?? '').trim().toUpperCase();
      if (!brandName) throw new Error('brand_name é obrigatório');
      // Desativa em vez de deletar (preserva histórico)
      const { error } = await supabase.from('client_brands')
        .update({ active: false }).ilike('brand_name', brandName);
      if (error) throw new Error(error.message);
      return { deactivated: true, brand_name: brandName };
    }

    case 'get_private_label_orders': {
      const statusFilter = args.status ? String(args.status) : 'pending';
      let q = supabase.from('shipment_items')
        .select(`id, item_name, item_code, brand_name, item_color, item_detail, quantity, unit_price,
                 shipment:shipments!inner(id, client_name, numero_venda, numero_nfe, data_prevista, status)`)
        .eq('is_private_label', true);
      if (statusFilter !== 'all') {
        q = q.eq('shipments.status', statusFilter);
      }
      if (args.client_name) {
        q = q.ilike('shipments.client_name', `%${String(args.client_name)}%`);
      }
      if (args.brand_name) {
        q = q.ilike('brand_name', `%${String(args.brand_name)}%`);
      }
      const { data, error } = await q.limit(200);
      if (error) throw new Error(error.message);

      // Ordena por data_prevista do shipment (nulls por último)
      (data ?? []).sort((a: any, b: any) => {
        const da = a.shipment?.data_prevista ?? '';
        const db = b.shipment?.data_prevista ?? '';
        return da < db ? -1 : da > db ? 1 : 0;
      });

      // Agrupa por cliente + marca
      const grouped: Record<string, {
        client_name: string; brand_name: string;
        items: Array<{ item_name: string; item_color: string | null; item_detail: string | null; quantity: number; numero_venda: string | null; data_prevista: string | null }>;
      }> = {};
      for (const row of (data ?? []) as any[]) {
        const key = `${row.shipment?.client_name}__${row.brand_name ?? '?'}`;
        if (!grouped[key]) {
          grouped[key] = { client_name: row.shipment?.client_name ?? '?', brand_name: row.brand_name ?? '(sem marca)', items: [] };
        }
        grouped[key].items.push({
          item_name:     row.item_name,
          item_color:    row.item_color,
          item_detail:   row.item_detail,
          quantity:      row.quantity,
          numero_venda:  row.shipment?.numero_venda,
          data_prevista: row.shipment?.data_prevista,
        });
      }

      return {
        total_items: (data ?? []).length,
        groups: Object.values(grouped),
        summary: Object.values(grouped).map((g) =>
          `${g.client_name} — ${g.brand_name}: ` +
          g.items.map((i) => `${i.quantity}x ${i.item_color ?? i.item_name}`).join(', ')
        ),
      };
    }

    case 'find_partial_shipment': {
      const docType  = String(args.document_type ?? '').trim();
      const cnpj     = args.client_cnpj ? String(args.client_cnpj).replace(/\D/g, '') : null;
      const name     = args.client_name ? String(args.client_name).trim() : null;
      const daysBack = Number(args.days_back ?? 90);
      const since    = new Date(Date.now() - daysBack * 86400000).toISOString();

      if (!cnpj && !name) return { candidates: [], message: 'Informe client_cnpj ou client_name para buscar.' };

      let q = supabase.from('shipments')
        .select('id, client_name, client_cnpj, numero_nfe, numero_venda, data_venda, status, valor_total, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(10);

      // Busca por CNPJ (exato) ou nome (fuzzy)
      if (cnpj) {
        q = q.eq('client_cnpj', cnpj);
      } else if (name) {
        q = q.ilike('client_name', `%${name}%`);
      }

      // Filtra registros "incompletos" conforme o tipo do documento chegando
      if (docType === 'nfe') {
        // Chegou uma NF-e → procura vendas sem NF-e vinculada
        q = q.is('numero_nfe', null);
      } else if (docType === 'venda') {
        // Chegou uma Venda → procura NF-es sem número de venda vinculado
        q = q.is('numero_venda', null);
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const candidates = (data ?? []) as any[];
      return {
        candidates,
        count: candidates.length,
        message: candidates.length === 0
          ? `Nenhum pedido parcial encontrado para esse cliente nos últimos ${daysBack} dias.`
          : `Encontrei ${candidates.length} pedido(s) que pode(m) corresponder. Confirme com o usuário antes de vincular.`,
      };
    }

    case 'link_document_to_shipment': {
      const id = String(args.shipment_id ?? '').trim();
      if (!id) throw new Error('shipment_id é obrigatório');

      const updates: Record<string, unknown> = {};
      if (args.numero_nfe)    updates.numero_nfe    = String(args.numero_nfe).trim();
      if (args.numero_venda)  updates.numero_venda  = String(args.numero_venda).trim();
      if (args.chave_acesso)  updates.chave_acesso  = String(args.chave_acesso).replace(/\D/g, '').slice(0, 44) || null;
      if (args.data_venda)    updates.data_venda    = String(args.data_venda);
      if (args.data_prevista) updates.data_prevista = String(args.data_prevista);
      if (args.valor_total != null) updates.valor_total = Number(args.valor_total);
      if (args.notes)         updates.notes         = String(args.notes).trim();

      if (Object.keys(updates).length === 0) throw new Error('Nenhum campo para atualizar.');

      const { data: before } = await supabase.from('shipments')
        .select('client_name, numero_nfe, numero_venda').eq('id', id).single();

      const { error } = await supabase.from('shipments').update(updates).eq('id', id);
      if (error) throw new Error(error.message);

      return {
        linked: true,
        shipment_id: id,
        client_name: (before as any)?.client_name,
        before: { numero_nfe: (before as any)?.numero_nfe, numero_venda: (before as any)?.numero_venda },
        after: updates,
      };
    }

    case 'create_shipment': {
      const clientName = String(args.client_name ?? '').trim();
      if (!clientName) throw new Error('client_name é obrigatório');

      // ── Pré-validações de itens (CRÍTICO pra evitar pedido sem produtos) ─────
      const itemsInputRaw = Array.isArray(args.items) ? args.items : [];
      const validTipos = ['venda','retorno_conserto','retorno_garantia','remessa_demonstracao','remessa_conserto','remessa_industrializacao','rma','outro'];
      const tipoNotaPre = args.tipo_nota && validTipos.includes(String(args.tipo_nota)) ? String(args.tipo_nota) : 'venda';

      // Vendas SEMPRE precisam de itens. Outros tipos (RMA, retorno) podem ser vazios.
      const tiposQueExigemItens = new Set(['venda', 'remessa_demonstracao', 'remessa_industrializacao']);
      if (tiposQueExigemItens.has(tipoNotaPre) && itemsInputRaw.length === 0) {
        throw new Error(
          `Pedido tipo "${tipoNotaPre}" exige ao menos 1 item. Você passou items vazio. ` +
          `Se importou um PDF, releia a tabela de produtos e extraia TODAS as linhas — não pode criar venda sem produtos.`
        );
      }

      // expected_items_count (cross-check do que a IA viu no PDF vs o que extraiu)
      const expectedItems = args.expected_items_count != null ? Number(args.expected_items_count) : null;
      if (expectedItems != null && Number.isFinite(expectedItems) && expectedItems > 0) {
        if (itemsInputRaw.length !== expectedItems) {
          throw new Error(
            `Cross-check de itens FALHOU: você disse que o PDF tem ${expectedItems} itens, mas só extraiu ${itemsInputRaw.length}. ` +
            `NÃO crie o pedido com dados parciais — releia o PDF, extraia TODAS as linhas e tente de novo. ` +
            `Itens parciais geram pedido errado no banco e a equipe descobre tarde demais.`
          );
        }
      }

      // Previne duplicata: checa por numero_nfe ou numero_venda + cliente
      const nfe   = args.numero_nfe    ? String(args.numero_nfe).trim()   : null;
      const nvenda = args.numero_venda ? String(args.numero_venda).trim() : null;
      const updateIfExists = Boolean(args.update_if_exists);
      let existingShipment: any = null;
      if (nfe || nvenda) {
        let dupQ = supabase.from('shipments').select('*');
        if (nfe)    dupQ = dupQ.eq('numero_nfe',    nfe);
        else        dupQ = dupQ.eq('numero_venda',  nvenda!).ilike('client_name', `%${clientName}%`);
        const { data: existing } = await dupQ.limit(1).maybeSingle();
        existingShipment = existing;
      }

      if (existingShipment && !updateIfExists) {
        // Compara dados pra a IA poder decidir entre "tudo igual" vs "mudou"
        const existingId = existingShipment.id as string;
        const { data: oldItems } = await supabase
          .from('shipment_items')
          .select('id, item_code, item_name, quantity, unit_price')
          .eq('shipment_id', existingId);
        const oldItemsArr = (oldItems ?? []) as any[];
        const oldItemsCount = oldItemsArr.length;
        const oldTotal = oldItemsArr.reduce(
          (s, it: any) => s + Number(it.quantity ?? 0) * Number(it.unit_price ?? 0),
          0
        );
        const newItemsCount = itemsInputRaw.length;
        const newTotal = itemsInputRaw.reduce(
          (s: number, it: any) => s + Number(it.quantity ?? 0) * Number(it.unit_price ?? 0),
          0
        );

        // Compara campos principais do cabeçalho (apenas onde o user/IA passou valor)
        const fieldsCompared: Record<string, { old: any; new: any }> = {};
        const compareFields = [
          'client_name', 'client_trade_name', 'client_cnpj', 'client_phone',
          'client_email', 'client_address', 'numero_nfe', 'numero_venda',
          'data_venda', 'data_prevista', 'valor_total', 'total_produtos',
          'frete_tipo', 'frete_valor', 'forma_pagamento', 'condicao_pagamento',
        ];
        for (const f of compareFields) {
          const newVal = (args as any)[f];
          if (newVal === undefined || newVal === null || newVal === '') continue;
          const oldVal = existingShipment[f];
          // Compara como string trimada pra evitar falso positivo de número/string
          const oldStr = oldVal == null ? '' : String(oldVal).trim();
          const newStr = String(newVal).trim();
          if (oldStr !== newStr) {
            fieldsCompared[f] = { old: oldVal ?? null, new: newVal };
          }
        }

        const itemsCountChanged = newItemsCount !== oldItemsCount;
        const totalChanged = Math.abs(newTotal - oldTotal) > 0.01;
        const headerChanged = Object.keys(fieldsCompared).length > 0;
        const anythingChanged = itemsCountChanged || totalChanged || headerChanged;

        return {
          already_exists: true,
          changed: anythingChanged,
          shipment_id: existingId,
          existing: {
            client_name: existingShipment.client_name,
            numero_nfe: existingShipment.numero_nfe,
            numero_venda: existingShipment.numero_venda,
            status: existingShipment.status,
            valor_total: existingShipment.valor_total,
            data_venda: existingShipment.data_venda,
            items_count: oldItemsCount,
            items_total_calculated: oldTotal,
          },
          incoming: {
            items_count: newItemsCount,
            items_total_calculated: newTotal,
          },
          fields_changed: fieldsCompared,
          items_count_diff: { old: oldItemsCount, new: newItemsCount },
          total_diff: { old: oldTotal, new: newTotal },
          message: anythingChanged
            ? `Pedido ${nfe ? `NF-e ${nfe}` : `Venda #${nvenda}`} já existe MAS com dados diferentes. ` +
              `Cabeçalho: ${headerChanged ? Object.keys(fieldsCompared).join(', ') : 'igual'}. ` +
              `Itens: ${oldItemsCount} → ${newItemsCount}. ` +
              `Total: R$ ${oldTotal.toFixed(2)} → R$ ${newTotal.toFixed(2)}. ` +
              `MOSTRE essa comparação pro usuário e pergunte se ele quer ATUALIZAR (chame de novo com update_if_exists=true).`
            : `Pedido ${nfe ? `NF-e ${nfe}` : `Venda #${nvenda}`} já existe e os dados batem com o que o PDF traz. Nada a fazer — só informe ao usuário "Já está cadastrado, tudo certo".`,
        };
      }

      const tipoNota = tipoNotaPre;
      const payload: Record<string, unknown> = {
        client_name:         clientName,
        client_trade_name:   args.client_trade_name   ? String(args.client_trade_name).trim() : null,
        tipo_nota:           tipoNota,
        natureza_operacao:   args.natureza_operacao   ? String(args.natureza_operacao).trim() : null,
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

      let shipmentId: string;
      let created: any;
      let isUpdate = false;
      // Backup dos itens antigos pra restore em caso de falha em modo update
      let oldItemsBackup: any[] = [];
      let oldHeaderBackup: any = null;

      if (existingShipment && updateIfExists) {
        // ── MODO UPDATE: pedido já existe e usuário pediu pra atualizar ──
        isUpdate = true;
        shipmentId = existingShipment.id as string;

        // Backup pra restore caso post-validação falhe
        oldHeaderBackup = { ...existingShipment };
        const { data: oldItems } = await supabase
          .from('shipment_items').select('*').eq('shipment_id', shipmentId);
        oldItemsBackup = (oldItems ?? []) as any[];

        // Atualiza só campos que vieram com valor (não apaga campos antigos
        // que não estão na nova chamada — preserva o que o user já tinha)
        const updatePayload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(payload)) {
          if (v !== null && v !== undefined && v !== '') updatePayload[k] = v;
        }
        updatePayload.updated_at = new Date().toISOString();
        const { error: upErr } = await supabase
          .from('shipments').update(updatePayload).eq('id', shipmentId);
        if (upErr) throw new Error(`Falha ao atualizar pedido: ${upErr.message}`);
        // Apaga itens antigos pra inserir os novos (substituição completa)
        const { error: delErr } = await supabase
          .from('shipment_items').delete().eq('shipment_id', shipmentId);
        if (delErr) throw new Error(`Falha ao limpar itens antigos: ${delErr.message}`);
        const { data: ship } = await supabase
          .from('shipments')
          .select('id, client_name, numero_venda, numero_nfe, status')
          .eq('id', shipmentId).maybeSingle();
        created = ship;
      } else {
        // ── MODO CREATE: pedido novo ──
        const { data: c, error } = await supabase
          .from('shipments')
          .insert(payload)
          .select('id, client_name, numero_venda, numero_nfe, status')
          .single();
        if (error || !c) throw new Error(error?.message ?? 'Falha ao criar pedido');
        created = c;
        shipmentId = (c as any).id as string;
      }

      // Helper: restaura estado original em caso de falha durante update
      async function restoreOnFailure(reason: string): Promise<never> {
        if (isUpdate && oldHeaderBackup) {
          // Restaura cabeçalho
          const restoreHeader: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(oldHeaderBackup)) {
            if (k === 'id' || k === 'created_at') continue;
            restoreHeader[k] = v;
          }
          await supabase.from('shipments').update(restoreHeader).eq('id', shipmentId);
          // Limpa qualquer item parcial e re-insere os antigos
          await supabase.from('shipment_items').delete().eq('shipment_id', shipmentId);
          if (oldItemsBackup.length > 0) {
            const restoredItems = oldItemsBackup.map((it: any) => {
              const { id: _ignore, created_at: _ignore2, ...rest } = it;
              return rest;
            });
            await supabase.from('shipment_items').insert(restoredItems);
          }
          throw new Error(reason + ` Estado original do pedido foi restaurado.`);
        } else {
          // Modo create: deleta o pedido recém-criado
          await supabase.from('shipments').delete().eq('id', shipmentId);
          throw new Error(reason + ` Pedido NÃO foi criado no banco.`);
        }
      }

      // Verificação pós-criação: confirma que o registro existe de fato no banco
      const { data: verified, error: verifyErr } = await supabase
        .from('shipments')
        .select('id, client_name, numero_venda, numero_nfe, status')
        .eq('id', shipmentId)
        .maybeSingle();
      if (verifyErr || !verified) {
        throw new Error(`Pedido inserido mas não confirmado no banco (id: ${shipmentId}). Verifique manualmente.`);
      }

      const itemsInput: Array<{
        product_name?: string; product_id?: string;
        item_code?: string; item_name?: string; unit_price?: number; quantity: number;
        is_private_label?: boolean; brand_name?: string; item_color?: string; item_detail?: string;
      }> = Array.isArray(args.items) ? args.items : [];
      const itemsAdded: any[] = [];
      const itemsFailed: any[] = [];
      let privateLabelsDetected = 0;
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
        const isPrivateLabel = Boolean(it.is_private_label);
        if (isPrivateLabel) privateLabelsDetected++;
        const itemPayload: Record<string, unknown> = {
          shipment_id:      shipmentId,
          product_id:       productId || null,
          item_code:        it.item_code        ? String(it.item_code).trim()        : null,
          item_name:        it.item_name        ? String(it.item_name).trim()        : null,
          unit_price:       it.unit_price != null ? Number(it.unit_price)            : null,
          quantity:         qty,
          is_private_label: isPrivateLabel,
          brand_name:       it.brand_name       ? String(it.brand_name).trim()       : null,
          item_color:       it.item_color       ? String(it.item_color).trim()       : null,
          item_detail:      it.item_detail      ? String(it.item_detail).trim()      : null,
        };
        const { error: insErr } = await supabase.from('shipment_items').insert(itemPayload);
        if (insErr) {
          itemsFailed.push({ item_name: it.item_name ?? it.product_name, error: insErr.message });
        } else {
          itemsAdded.push({
            product_id: productId || null, item_code: it.item_code,
            item_name: it.item_name ?? it.product_name, quantity: qty,
            is_private_label: isPrivateLabel, brand_name: it.brand_name, item_color: it.item_color,
            unit_price: it.unit_price,
          });
        }
      }

      // ── Post-validação CRÍTICA: count + total ────────────────────────────
      // 1) Count real no banco (não confiar só no array em memória)
      const { count: realCount } = await supabase
        .from('shipment_items')
        .select('id', { count: 'exact', head: true })
        .eq('shipment_id', shipmentId);
      const realInserted = realCount ?? 0;

      // Se tipo exige itens mas nada foi persistido → ROLLBACK
      if (tiposQueExigemItens.has(tipoNota) && realInserted === 0) {
        await restoreOnFailure(
          `Operação descartada: tipo "${tipoNota}" exige itens mas nenhum foi persistido. ` +
          `Falhas: ${itemsFailed.map((f) => `${f.item_name}: ${f.error}`).join('; ')}.`
        );
      }

      // Se expected_items_count foi passado e não bate com o que persistiu → ROLLBACK
      if (expectedItems != null && expectedItems > 0 && realInserted !== expectedItems) {
        await restoreOnFailure(
          `Operação descartada: esperava ${expectedItems} itens mas apenas ${realInserted} foram persistidos. ` +
          `Itens que falharam: ${itemsFailed.map((f) => `${f.item_name}: ${f.error}`).join('; ') || 'nenhum erro reportado, mas count não bate'}.`
        );
      }

      // Se algum item falhou na inserção (mas count bate ou expected não foi passado),
      // ainda é problema — relata pra IA reagir
      if (itemsFailed.length > 0) {
        await restoreOnFailure(
          `Operação descartada: ${itemsFailed.length} item(ns) falharam na inserção. ` +
          `Detalhes: ${itemsFailed.map((f) => `"${f.item_name}": ${f.error}`).join(' | ')}.`
        );
      }

      // 2) Cross-check de total (aviso, não bloqueia)
      const expectedTotal = args.expected_total != null ? Number(args.expected_total) : null;
      let totalWarning: string | null = null;
      if (expectedTotal != null && Number.isFinite(expectedTotal) && expectedTotal > 0) {
        const computedTotal = itemsAdded.reduce(
          (sum, it: any) => sum + (Number(it.unit_price ?? 0) * Number(it.quantity ?? 0)),
          0
        );
        const diff = Math.abs(computedTotal - expectedTotal);
        const diffPct = (diff / expectedTotal) * 100;
        if (diffPct > 5) {
          totalWarning = `Total dos itens (R$ ${computedTotal.toFixed(2)}) diverge do esperado (R$ ${expectedTotal.toFixed(2)}) em ${diffPct.toFixed(1)}% — confira preços/quantidades.`;
        }
      }

      // Auto-registra purchase_needs para itens sem estoque suficiente
      const needsAutoCreated: string[] = [];
      for (const it of itemsAdded) {
        const needed = Number(it.quantity ?? 0);
        if (!(needed > 0)) continue;

        // Verifica saldo em estoque
        let stockAvail = 0;
        if (it.item_code) {
          const { data: stockRow } = await supabase
            .from('stock_items')
            .select('quantity, reserved_quantity')
            .ilike('item_code', it.item_code)
            .maybeSingle();
          if (stockRow) stockAvail = Number((stockRow as any).quantity) - Number((stockRow as any).reserved_quantity);
        }
        const deficit = needed - stockAvail;
        if (deficit <= 0) continue; // estoque cobre — não precisa comprar

        // Verifica se já existe need não-cancelado para este item+pedido
        const itemNameSearch = (it.item_name ?? it.item_code ?? '').trim();
        const { data: existing } = await supabase
          .from('purchase_needs')
          .select('id')
          .eq('shipment_id', shipmentId)
          .ilike('item_name', `%${itemNameSearch}%`)
          .neq('status', 'cancelado')
          .maybeSingle();
        if (existing) continue;

        await supabase.from('purchase_needs').insert({
          item_name:   itemNameSearch,
          item_code:   it.item_code ?? null,
          quantity:    deficit,
          shipment_id: shipmentId,
          status:      'pendente',
        });
        needsAutoCreated.push(`${deficit}x ${itemNameSearch}`);
      }

      const privateLabelItems = itemsAdded.filter((i) => i.is_private_label);
      return {
        action: isUpdate ? 'updated' : 'created',
        created,
        verified: true,
        verified_id: shipmentId,
        confirmed_in_database: true,
        items_added: itemsAdded,
        items_inserted_count: realInserted,
        items_expected_count: expectedItems,
        items_replaced_count: isUpdate ? oldItemsBackup.length : 0,
        items_failed: itemsFailed,
        total_warning: totalWarning,
        private_label_count: privateLabelsDetected,
        private_label_items: privateLabelItems,
        private_label_alert: privateLabelsDetected > 0
          ? `⚠️ ${privateLabelsDetected} item(ns) com marca própria detectado(s): ${privateLabelItems.map((i) => `${i.quantity}x ${i.item_color ?? i.item_name} — ${i.brand_name}`).join(' | ')}`
          : null,
        purchase_needs_auto_created: needsAutoCreated,
        message: isUpdate
          ? `Pedido ${created?.numero_venda ?? created?.numero_nfe ?? shipmentId} atualizado: ${oldItemsBackup.length} item(ns) substituído(s) por ${realInserted} novo(s).`
          : `Pedido ${created?.numero_venda ?? created?.numero_nfe ?? shipmentId} criado com ${realInserted} item(ns).`,
      };
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
      // Read-after-write: confirma que o status realmente mudou no banco
      const { data: verify } = await supabase
        .from('shipments').select('id, status').eq('id', id).maybeSingle();
      if (!verify || verify.status !== newStatus) {
        throw new Error(
          `Update aparentemente passou mas status não bate (esperado: ${newStatus}, atual: ${verify?.status ?? 'inexistente'}). NÃO confirme ao usuário.`
        );
      }
      return { updated: true, verified: true, shipment_id: id, new_status: newStatus };
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
      await verifyWrite('shipments', id, 'update_shipment');
      return { updated: true, verified: true, shipment_id: id, changes: payload };
    }

    case 'delete_shipment': {
      const id = String(args.shipment_id ?? '');
      if (!id) throw new Error('shipment_id é obrigatório');
      const { error } = await supabase.from('shipments').delete().eq('id', id);
      if (error) throw new Error(error.message);
      // Verifica que sumiu
      const { data: stillExists } = await supabase
        .from('shipments').select('id').eq('id', id).maybeSingle();
      if (stillExists) {
        throw new Error(`Delete aparentemente passou mas pedido ainda existe (id ${id}). NÃO confirme ao usuário.`);
      }
      return { deleted: true, verified: true, shipment_id: id };
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
      const today = todayBR();
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
      // Resolve shipment apenas se algum identificador de pedido foi passado.
      let resolvedId: string | null = null;
      if (args.shipment_id || args.numero_venda || args.client_name) {
        const shipId = await resolveShipmentId(args);
        resolvedId = typeof shipId === 'string' ? shipId : null;
      }
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
      if (args.item_name) q = q.ilike('item_name', `%${searchRoot(String(args.item_name))}%`);
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
        let q = supabase.from('purchase_needs').select('id').limit(1);
        if (args.item_name) q = q.ilike('item_name', `%${searchRoot(String(args.item_name))}%`);
        if (args.shipment_id) q = q.eq('shipment_id', String(args.shipment_id));
        else if (args.numero_venda || args.client_name) {
          const r = await resolveShipmentId(args);
          if (typeof r === 'string') q = q.eq('shipment_id', r);
        }
        const { data } = await q;
        needId = (data?.[0] as any)?.id ?? null;
      }
      if (!needId) {
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
        needId = (created as any)?.id ?? null;
      } else {
        const { error } = await supabase
          .from('purchase_needs')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', needId);
        if (error) throw new Error(error.message);
      }

      // Quando marca como "chegou": alimenta o estoque automaticamente
      let stockEntry: any = null;
      let shipmentsNowReady: any[] = [];
      if (newStatus === 'chegou' && needId) {
        const { data: need } = await supabase
          .from('purchase_needs')
          .select('shipment_id, item_name, item_code, quantity, ordered_quantity, unit, carrier, shipment:shipments(numero_venda)')
          .eq('id', needId)
          .maybeSingle();
        const n = need as any;
        const qty = Number(n?.ordered_quantity ?? n?.quantity ?? 0);
        if (qty > 0) {
          const code = (n.item_code ?? n.item_name).trim().toUpperCase().replace(/\s+/g, '_');
          const { data: existing } = await supabase
            .from('stock_items')
            .select('id, quantity')
            .ilike('item_code', code)
            .maybeSingle();
          if (existing) {
            await supabase
              .from('stock_items')
              .update({ quantity: Number((existing as any).quantity) + qty, updated_at: new Date().toISOString() })
              .eq('id', (existing as any).id);
          } else {
            await supabase
              .from('stock_items')
              .insert({ item_code: code, item_name: n.item_name, quantity: qty, unit: n.unit ?? 'un' });
          }
          await supabase.from('stock_movements').insert({
            item_code: code,
            item_name: n.item_name,
            type: 'entrada',
            quantity: qty,
            notes: `Chegada${n.shipment?.numero_venda ? ` do pedido #${n.shipment.numero_venda}` : ''}${n.carrier ? ` via ${n.carrier}` : ''}`,
            created_by: ctx.currentUser ?? null,
          });
          stockEntry = { quantity: qty, item_code: code, item_name: n.item_name, unit: n.unit ?? 'un' };
        }

        // Verificação de cobertura: identifica pedidos que agora podem sair
        // (pedidos onde TODOS os purchase_needs estão chegou/cancelado).
        if (n?.shipment_id) {
          const { data: pendingNeeds } = await supabase
            .from('purchase_needs')
            .select('id')
            .eq('shipment_id', n.shipment_id)
            .in('status', ['pendente', 'pedido']);
          if (!pendingNeeds || pendingNeeds.length === 0) {
            const { data: ship } = await supabase
              .from('shipments')
              .select('id, client_name, numero_venda, status')
              .eq('id', n.shipment_id)
              .eq('status', 'pending')
              .maybeSingle();
            if (ship) shipmentsNowReady.push(ship);
          }
        }
      }

      const baseMsg = stockEntry
        ? `Marcado como chegou e ${stockEntry.quantity} ${stockEntry.unit} adicionado(s) ao estoque automaticamente.`
        : undefined;
      const readyMsg = shipmentsNowReady.length > 0
        ? ` 🎯 Pedido${shipmentsNowReady.length > 1 ? 's' : ''} agora pronto${shipmentsNowReady.length > 1 ? 's' : ''} para sair: ${shipmentsNowReady.map((s) => `${s.client_name}${s.numero_venda ? ` #${s.numero_venda}` : ''}`).join(', ')}`
        : '';

      return {
        updated: true,
        need_id: needId,
        new_status: newStatus,
        stock_entry: stockEntry,
        shipments_now_ready: shipmentsNowReady,
        message: (baseMsg ?? '') + readyMsg || undefined,
      };
    }

    case 'add_purchase_need_note': {
      let needId = args.need_id ? String(args.need_id) : null;
      if (!needId) {
        let q = supabase.from('purchase_needs').select('id').limit(1);
        if (args.item_name) q = q.ilike('item_name', `%${searchRoot(String(args.item_name))}%`);
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
      if (args.item_name) {
        // Aplica radical pra resolver plural/singular (CABOS → CABO, SAPATAS → SAPATA)
        const nameFilter = searchRoot(String(args.item_name));
        // Busca direta por nome
        q = q.ilike('item_name', `%${nameFilter}%`);
        // Também resolve via aliases: se houver alias com esse nome, inclui o item canônico
        const { data: aliasRows } = await supabase.from('item_aliases')
          .select('stock_item_id').ilike('alias', `%${nameFilter}%`);
        const aliasIds = ((aliasRows ?? []) as any[]).map((r) => r.stock_item_id as string);
        if (aliasIds.length > 0) {
          // Re-executa query com OR por ids canônicos
          q = supabase.from('stock_items')
            .select('id, item_code, item_name, quantity, unit, min_quantity')
            .or(`item_name.ilike.%${nameFilter}%,id.in.(${aliasIds.join(',')})`)
            .order('item_name');
        }
      }
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
        const { data } = await supabase.from('stock_items').select('*').ilike('item_name', `%${searchRoot(String(args.item_name))}%`).limit(1);
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
      // Verifica que a quantidade bate
      const { data: verify } = await supabase
        .from('stock_items').select('id, quantity').eq('id', item.id).maybeSingle();
      if (!verify || Number(verify.quantity) !== newQty) {
        throw new Error(
          `Ajuste de estoque não bateu (esperado ${newQty}, atual ${verify?.quantity ?? 'nada'}). NÃO confirme.`
        );
      }
      const newAvail = newQty - Number(item.reserved_quantity ?? 0);
      await checkMinStockAndCreateNeed(item.item_code, item.item_name, newAvail, Number(item.min_quantity ?? 0));
      return { adjusted: true, verified: true, item_code: item.item_code, old_quantity: item.quantity, new_quantity: newQty };
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
          // Se caiu abaixo do mínimo, registra need de reposição
          const { data: fullItem } = await supabase.from('stock_items').select('item_name, min_quantity').eq('id', stockItem.id).single();
          if (fullItem) {
            await checkMinStockAndCreateNeed(code, (fullItem as any).item_name, newQty - newReserved, Number((fullItem as any).min_quantity ?? 0));
          }
          deducted++;
        }
        // Item não encontrado no estoque: ignora silenciosamente.
        // O pedido saiu — o desencontro de cadastro não deve bloquear nem aparecer pro usuário.
      }
      // Marca o pedido como shipped automaticamente após descontar
      await supabase.from('shipments').update({
        status: 'shipped',
        data_saida: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: args.author ?? null,
      }).eq('id', shipmentId).eq('status', 'pending'); // só atualiza se ainda pending

      return { ok: true, deducted, status_updated: 'shipped' };
    }

    // ── Ordens de Produção ────────────────────────────────────────────────────
    case 'create_production_order': {
      const productName = String(args.product_name ?? '').trim();
      const qty = Number(args.quantity);
      const sentAt = args.sent_at ? String(args.sent_at) : todayBR();

      // Localiza produto
      const { data: prods } = await supabase.from('products').select('id, name').ilike('name', `%${productName}%`).limit(1);
      const product = (prods as any[])?.[0];
      if (!product) throw new Error(`Produto "${productName}" não encontrado.`);

      // Busca BOM (apenas itens de fabricação — produção/montagem não consome acervo)
      const { data: bom } = await supabase
        .from('bom_items')
        .select('quantity, tipo, component:components(id, name, sku, unit)')
        .eq('product_id', product.id)
        .eq('tipo', 'fabricacao');
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
      if (orderErr || !order) throw new Error(orderErr?.message ?? 'Falha ao criar ordem de produção');
      const orderId = order.id;
      await verifyWrite('production_orders', orderId, 'create_production_order');

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
      const returnedAt = args.returned_at ? String(args.returned_at) : todayBR();

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
    case 'get_bom_stock_status': {
      const productName = String(args.product_name ?? '').trim();
      const product = await findProductByName(productName);
      if (!product) return { error: `Produto "${productName}" não encontrado.` };

      const { bom } = await getProductWithBom(product.id);
      if (!bom.length) return { product: product.name, bom: [], message: 'Produto não tem BOM cadastrada.' };

      const componentIds = bom.map((b) => b.component_id).filter(Boolean) as string[];

      // Uma única query para todos os itens de estoque dos componentes da BOM
      const { data: stockRows } = await supabase
        .from('stock_items')
        .select('component_id, item_name, quantity, reserved_quantity, unit, min_quantity')
        .in('component_id', componentIds);

      const stockByCompId: Record<string, any> = {};
      for (const s of (stockRows ?? []) as any[]) {
        if (s.component_id) stockByCompId[s.component_id] = s;
      }

      const result = bom.map((b) => {
        const s = stockByCompId[b.component_id ?? ''];
        const qty       = s ? Number(s.quantity) : 0;
        const reserved  = s ? Number(s.reserved_quantity ?? 0) : 0;
        const available = qty - reserved;
        return {
          component:        b.component_name,
          qty_per_unit:     b.quantity,
          tipo:             b.tipo,
          stock:            qty,
          reserved:         reserved,
          available:        available,
          unit:             s?.unit ?? null,
          min_quantity:     s?.min_quantity ?? null,
          below_minimum:    s?.min_quantity != null && available < Number(s.min_quantity),
          has_stock:        qty > 0,
        };
      });

      const withStock    = result.filter((r) => r.has_stock).length;
      const withoutStock = result.filter((r) => !r.has_stock).length;

      return {
        product:        product.name,
        total_components: result.length,
        with_stock:     withStock,
        without_stock:  withoutStock,
        components:     result,
      };
    }

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

      // Busca BOM completo do produto (apenas fabricação — produção/montagem não consome acervo)
      const { data: bom } = await supabase
        .from('bom_items')
        .select('quantity, tipo, component:components(id, name, sku, unit)')
        .eq('product_id', product.id)
        .eq('tipo', 'fabricacao');

      if (!bom?.length) return { feasible: false, message: `${product.name} não tem BOM de fabricação cadastrado. Cadastre os componentes primeiro.` };

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

    case 'check_component_stock_for_production': {
      const compName    = String(args.component_name ?? '').trim();
      const productName = String(args.finished_product_name ?? '').trim();
      if (!compName || !productName) throw new Error('component_name e finished_product_name são obrigatórios.');

      // 1. Localiza o componente
      const { data: comps } = await supabase
        .from('components')
        .select('id, name, sku, unit')
        .ilike('name', `%${compName}%`)
        .limit(1);
      const comp = (comps as any[])?.[0];
      if (!comp) return { error: `Componente "${compName}" não encontrado no catálogo.` };

      // 2. Estoque atual do componente
      let stockRow: any = null;
      const { data: stockByComp } = await supabase
        .from('stock_items').select('quantity, reserved_quantity, unit')
        .eq('component_id', comp.id).maybeSingle();
      stockRow = stockByComp;
      if (!stockRow && comp.sku) {
        const { data: stockBySku } = await supabase
          .from('stock_items').select('quantity, reserved_quantity, unit')
          .ilike('item_code', comp.sku).maybeSingle();
        stockRow = stockBySku;
      }
      const compQty = stockRow ? Number(stockRow.quantity) - Number(stockRow.reserved_quantity) : 0;

      // 3. Produto acabado + stock
      const { data: products } = await supabase
        .from('products').select('id, name').ilike('name', `%${productName}%`).limit(1);
      const product = (products as any[])?.[0];
      if (!product) return { error: `Produto "${productName}" não encontrado no catálogo.` };

      const { data: prodStock } = await supabase
        .from('stock_items').select('quantity, reserved_quantity')
        .ilike('item_name', `%${product.name}%`).maybeSingle();
      const prodQtyInStock = prodStock
        ? Number((prodStock as any).quantity) - Number((prodStock as any).reserved_quantity)
        : 0;

      // 4. BOM: quantas unidades do componente por produto acabado
      const { data: bomItem } = await supabase
        .from('bom_items')
        .select('quantity')
        .eq('product_id', product.id)
        .eq('component_id', comp.id)
        .maybeSingle();
      const compPerUnit = bomItem ? Number((bomItem as any).quantity) : 1;

      // 5. Calcular cobertura
      const canComplete   = compPerUnit > 0 ? Math.floor(compQty / compPerUnit) : 0;
      const totalDemand   = prodQtyInStock; // controles em estoque que precisam do componente
      const covered       = Math.min(canComplete, totalDemand);
      const notCovered    = Math.max(0, totalDemand - covered);
      const compNeeded    = notCovered * compPerUnit;

      return {
        component:               comp.name,
        component_stock:         compQty,
        component_per_unit:      compPerUnit,
        finished_product:        product.name,
        finished_product_stock:  totalDemand,
        can_complete_units:      covered,
        units_without_component: notCovered,
        component_missing:       compNeeded,
        summary: notCovered === 0
          ? `Estoque de ${comp.name} (${compQty}) é suficiente para todos os ${totalDemand} ${product.name} em estoque.`
          : covered === 0
          ? `Sem ${comp.name} em estoque — nenhum dos ${totalDemand} ${product.name} pode ser completado. Faltam ${compNeeded} ${comp.name}.`
          : `Com ${compQty} ${comp.name}, dá para completar ${covered} dos ${totalDemand} ${product.name}. Os outros ${notCovered} ficam sem — faltam ${compNeeded} ${comp.name} a mais.`,
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

      // Apenas itens de fabricação descontam estoque na produção (acervo é embalagem/etiqueta)
      const { data: bom } = await supabase
        .from('bom_items')
        .select('quantity, tipo, component:components(id, name, sku, unit)')
        .eq('product_id', product.id)
        .eq('tipo', 'fabricacao');

      if (!bom?.length) throw new Error(`${product.name} não tem BOM de fabricação cadastrado.`);

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
      const orderedAt = args.ordered_at ? String(args.ordered_at) : todayBR();

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
      if (args.item_name) q = q.ilike('item_name', `%${searchRoot(String(args.item_name))}%`);
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
            // Fabricação — cruza BOM × estoque de componentes (apenas tipo='fabricacao')
            const { data: bom } = await supabase
              .from('bom_items')
              .select('quantity, component:components(id, name, sku)')
              .eq('product_id', prod.id)
              .eq('tipo', 'fabricacao');

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

    // ---------- ALIASES DE NOMES ----------
    case 'find_similar_stock_items': {
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('name é obrigatório');

      // Palavras significativas (>= 3 chars, sem stopwords PT)
      const stopwords = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'com', 'em', 'por', 'que', 'uma', 'uns', 'umas']);
      const words = name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && !stopwords.has(w));

      if (!words.length) {
        // Busca literal se não sobrou palavra significativa
        const { data } = await supabase.from('stock_items')
          .select('id, item_code, item_name, quantity, unit, min_quantity')
          .ilike('item_name', `%${name}%`).limit(20);
        return { query: name, candidates: data ?? [], count: (data ?? []).length };
      }

      // OR por cada palavra significativa
      const orFilter = words.map((w) => `item_name.ilike.%${w}%`).join(',');
      const { data, error } = await supabase.from('stock_items')
        .select('id, item_code, item_name, quantity, unit, min_quantity')
        .or(orFilter)
        .order('item_name')
        .limit(20);
      if (error) throw new Error(error.message);

      // Pontua por quantas palavras do termo coincidem no nome
      const scored = ((data ?? []) as any[])
        .map((item) => {
          const lower = item.item_name.toLowerCase();
          const matches = words.filter((w) => lower.includes(w)).length;
          return { ...item, word_matches: matches };
        })
        .sort((a, b) => b.word_matches - a.word_matches);

      return {
        query: name,
        candidates: scored,
        count: scored.length,
        has_multiple: scored.length > 1,
      };
    }

    case 'add_item_alias': {
      const canonicalName = String(args.canonical_item_name ?? '').trim();
      const alias        = String(args.alias ?? '').trim();
      if (!canonicalName || !alias) throw new Error('canonical_item_name e alias são obrigatórios');

      // Localiza o item canônico
      const { data: items } = await supabase.from('stock_items')
        .select('id, item_name')
        .ilike('item_name', `%${canonicalName}%`)
        .limit(1);
      const item = (items as any[])?.[0];
      if (!item) throw new Error(`Item "${canonicalName}" não encontrado no estoque.`);

      const { error } = await supabase.from('item_aliases')
        .insert({ stock_item_id: item.id, alias });
      // 23505 = unique_violation (alias já existe — ok, não é erro)
      if (error && error.code !== '23505') throw new Error(error.message);

      return { linked: alias, to: item.item_name, stock_item_id: item.id, already_existed: error?.code === '23505' };
    }

    case 'list_item_aliases': {
      let q = supabase.from('item_aliases')
        .select('id, alias, created_at, stock_item:stock_items(id, item_name)')
        .order('created_at', { ascending: false });
      if (args.item_name) {
        // Filtra pelo nome canônico via subquery simulada: busca item primeiro
        const { data: items } = await supabase.from('stock_items')
          .select('id').ilike('item_name', `%${String(args.item_name)}%`).limit(1);
        const itemId = (items as any[])?.[0]?.id;
        if (itemId) q = q.eq('stock_item_id', itemId);
      }
      const { data, error } = await q.limit(200);
      if (error) throw new Error(error.message);
      return { aliases: data ?? [], count: (data ?? []).length };
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
      const today = todayBR();
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

    case 'add_item_synonym': {
      const canonical = normalizeForSearch(String(args.canonical ?? ''));
      if (!canonical) throw new Error('canonical é obrigatório');
      const variantsRaw = Array.isArray(args.variants) ? args.variants : [];
      const variants = variantsRaw
        .map((v: any) => normalizeForSearch(String(v ?? '')))
        .filter((v: string) => v.length > 0 && v !== canonical);
      if (variants.length === 0) throw new Error('variants precisa ter pelo menos 1 item válido');

      // Upsert: se canonical já existe, mescla as variants (sem duplicar)
      const { data: existing } = await supabase
        .from('item_synonyms').select('id, variants').eq('canonical', canonical).maybeSingle();
      if (existing) {
        const merged = Array.from(new Set([...(existing as any).variants ?? [], ...variants]));
        const { error: upErr } = await supabase
          .from('item_synonyms')
          .update({ variants: merged, notes: args.notes ? String(args.notes) : null })
          .eq('id', (existing as any).id);
        if (upErr) throw new Error(upErr.message);
        return { updated: true, id: (existing as any).id, canonical, variants: merged };
      }

      const { data: created, error } = await supabase
        .from('item_synonyms')
        .insert({
          canonical,
          variants,
          notes: args.notes ? String(args.notes) : null,
          created_by: ctx.currentUser ?? null,
        })
        .select('id, canonical, variants')
        .single();
      if (error || !created) throw new Error(error?.message ?? 'Falha ao criar sinônimo');
      await verifyWrite('item_synonyms', (created as any).id, 'add_item_synonym');
      return { created: true, verified: true, synonym: created };
    }

    case 'list_item_synonyms': {
      const { data, error } = await supabase
        .from('item_synonyms')
        .select('id, canonical, variants, notes, created_at, created_by')
        .order('canonical');
      if (error) throw new Error(error.message);
      return { synonyms: data ?? [], count: (data ?? []).length };
    }

    case 'remove_item_synonym': {
      let id = args.synonym_id ? String(args.synonym_id) : null;
      if (!id && args.canonical) {
        const can = normalizeForSearch(String(args.canonical));
        const { data } = await supabase
          .from('item_synonyms').select('id').eq('canonical', can).maybeSingle();
        id = (data as any)?.id ?? null;
      }
      if (!id) throw new Error('Forneça synonym_id ou canonical.');
      const { error } = await supabase.from('item_synonyms').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, id };
    }

    case 'find_shipments_by_item': {
      const term = String(args.term ?? '').trim();
      if (!term) throw new Error('term é obrigatório');
      const status = String(args.status ?? 'pending').toLowerCase();
      const limit = Number(args.limit ?? 50);

      // Aplica radical (singular/plural) e remove acentos antes de mandar pra RPC
      const root = searchRoot(term);
      const normalized = normalizeForSearch(root);

      // Chama RPC inteligente: combina unaccent + sinônimos + pg_trgm fuzzy
      const { data: rows, error } = await supabase.rpc('search_shipment_items_smart', {
        p_term: normalized,
        p_status: status === 'all' ? null : status,
        p_limit: limit * 5,
      });
      if (error) throw new Error(error.message);

      // Agrupa por shipment_id
      const grouped = new Map<string, any>();
      let bestMatchVia: 'exact' | 'fuzzy' | 'partial' = 'partial';
      for (const row of ((rows ?? []) as any[])) {
        const sid = row.shipment_id;
        if (!grouped.has(sid)) {
          grouped.set(sid, {
            shipment_id: sid,
            client_name: row.client_name,
            numero_venda: row.numero_venda,
            numero_nfe: row.numero_nfe,
            status: row.shipment_status,
            data_venda: row.data_venda,
            data_prevista: row.data_prevista,
            valor_total: row.valor_total,
            best_match_score: Number(row.match_score ?? 0),
            items_matched: [],
          });
        }
        const ship = grouped.get(sid)!;
        const score = Number(row.match_score ?? 0);
        if (score > ship.best_match_score) ship.best_match_score = score;
        ship.items_matched.push({
          item_name: row.item_name,
          item_code: row.item_code,
          quantity: row.quantity,
          unit_price: row.unit_price,
          match_score: score,
          matched_via: row.matched_via,
        });
        if (row.matched_via === 'exact') bestMatchVia = 'exact';
        else if (row.matched_via === 'fuzzy' && bestMatchVia !== 'exact') bestMatchVia = 'fuzzy';
      }

      // Ordena pedidos por score (melhor match primeiro)
      const results = Array.from(grouped.values())
        .sort((a, b) => b.best_match_score - a.best_match_score)
        .slice(0, limit);

      return {
        term,
        normalized_root: root,
        normalized_search: normalized,
        match_strategy: bestMatchVia,
        status_filter: status,
        shipments_found: results.length,
        items_matched_total: results.reduce((s, r) => s + r.items_matched.length, 0),
        shipments: results,
        message: results.length === 0
          ? `Nenhum pedido${status !== 'all' ? ` com status "${status}"` : ''} contém item parecido com "${term}". Tenta outros termos ou status="all". Se for um termo da operação que costuma aparecer com outro nome, considere cadastrar como sinônimo via add_item_synonym.`
          : `Encontrei ${results.length} pedido(s) com itens batendo "${term}"${bestMatchVia === 'fuzzy' ? ' (match aproximado — alguns por similaridade)' : ''}.`,
      };
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
      let results = (data ?? []) as any[];
      let matchedBy: 'exact' | 'fuzzy' = 'exact';
      if (results.length === 0) {
        const fuzzy = await fuzzyFallback<{ id: string; nome: string; sim: number }>('search_financeiras_fuzzy', q);
        if (fuzzy.length > 0) {
          const ids = fuzzy.map((f) => f.id);
          const { data: enriched } = await supabase
            .from('financeiras').select('id, nome, contato, notes').in('id', ids);
          const byId = new Map((enriched ?? []).map((r: any) => [r.id, r]));
          results = fuzzy.map((f) => byId.get(f.id)).filter(Boolean) as any[];
          matchedBy = 'fuzzy';
        }
      }
      if (results.length === 0) {
        return { found: false, message: `Nenhuma financeira com nome parecido com "${q}". Use create_financeira para cadastrar.`, matched_by: matchedBy };
      }
      return { found: true, financeiras: results, matched_by: matchedBy };
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
      if (error || !data) throw new Error(error?.message ?? 'Falha ao criar financeira');
      await verifyWrite('financeiras', (data as any).id, 'create_financeira');
      return { created: data, verified: true };
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
        data_entrada:   args.data_entrada   ? String(args.data_entrada)          : todayBR(),
        notes:          args.notes          ? String(args.notes).trim()          : null,
      };
      const { data, error } = await supabase
        .from('titulos')
        .insert(payload)
        .select('id, financeira_id, client_name, valor, vencimento, status')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Falha ao registrar título');
      await verifyWrite('titulos', (data as any).id, 'register_titulo');
      return { registered: true, verified: true, titulo: data, financeira: financeira.nome };
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
        patch.data_pagamento = args.data_pagamento ? String(args.data_pagamento) : todayBR();
      }
      const { error } = await supabase.from('titulos').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
      const { data: verify } = await supabase
        .from('titulos').select('id, status').eq('id', id).maybeSingle();
      if (!verify || verify.status !== newStatus) {
        throw new Error(`Status do título não bate (esperado ${newStatus}, atual ${verify?.status ?? 'nada'}). NÃO confirme.`);
      }
      return { updated: true, verified: true, titulo_id: id, new_status: newStatus };
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
      const hoje = todayBR();
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

    // ─── RMA ────────────────────────────────────────────────────────────────
    case 'list_rmas': {
      const limit = Math.min(Number(args.limit ?? 50), 200);
      let q = supabase
        .from('rmas')
        .select(`id, numero, client_name, client_trade_name, motivo, status, solucao,
                 tecnico_nome, numero_os, data_recebido, data_devolvido, volume, desconto,
                 created_at`)
        .order('data_recebido', { ascending: false, nullsFirst: false })
        .limit(limit);
      if (args.status)      q = q.eq('status', String(args.status));
      if (args.client_name) q = q.ilike('client_name', `%${String(args.client_name)}%`);
      if (args.tecnico)     q = q.ilike('tecnico_nome', `%${String(args.tecnico)}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: (data ?? []).length, rmas: data ?? [] };
    }

    case 'get_rma_details': {
      let rmaId: string | null = args.rma_id ? String(args.rma_id) : null;
      if (!rmaId && args.numero != null) {
        const { data } = await supabase.from('rmas').select('id').eq('numero', Number(args.numero)).maybeSingle();
        rmaId = (data as any)?.id ?? null;
      }
      if (!rmaId && args.numero_os) {
        const { data } = await supabase.from('rmas').select('id').eq('numero_os', String(args.numero_os)).maybeSingle();
        rmaId = (data as any)?.id ?? null;
      }
      if (!rmaId) return { found: false, message: 'RMA não encontrado.' };

      const [rmaRes, itemsRes, obsRes] = await Promise.all([
        supabase.from('rmas').select('*').eq('id', rmaId).single(),
        supabase.from('rma_items').select('*').eq('rma_id', rmaId).order('posicao', { ascending: true, nullsFirst: false }),
        supabase.from('rma_observations').select('content, author, created_at').eq('rma_id', rmaId).order('created_at', { ascending: false }),
      ]);
      if (rmaRes.error) throw new Error(rmaRes.error.message);
      const rma: any = rmaRes.data;
      const items = (itemsRes.data ?? []) as any[];
      const subtotal = items.reduce((s, i) => s + (Number(i.valor_total) || 0), 0);
      const total = subtotal - (Number(rma.desconto) || 0);
      return {
        found: true,
        rma,
        items,
        observations: obsRes.data ?? [],
        subtotal,
        total,
      };
    }

    case 'create_rma': {
      const clientName = String(args.client_name ?? '').trim();
      if (!clientName) throw new Error('client_name é obrigatório');
      const motivosValidos = new Set(['defeito', 'desistencia', 'garantia', 'outro']);
      const motivo = motivosValidos.has(String(args.motivo)) ? String(args.motivo) : 'defeito';

      const payload: any = {
        client_name: clientName,
        client_cnpj: args.client_cnpj ? String(args.client_cnpj).trim() : null,
        client_phone: args.client_phone ? String(args.client_phone).trim() : null,
        motivo,
        tecnico_nome: args.tecnico_nome ? String(args.tecnico_nome).trim() : null,
        tecnico_phone: args.tecnico_phone ? String(args.tecnico_phone).trim() : null,
        numero_os: args.numero_os ? String(args.numero_os).trim() : null,
        volume: args.volume != null ? Number(args.volume) : 1,
        data_recebido: args.data_recebido ? String(args.data_recebido).slice(0, 10) : new Date().toISOString().slice(0, 10),
        diagnostico: args.diagnostico ? String(args.diagnostico).trim() : null,
      };
      const { data: created, error } = await supabase.from('rmas').insert(payload).select('id, numero').single();
      if (error || !created) throw new Error(error?.message ?? 'Falha ao criar RMA');
      const rmaId = (created as any).id;
      await verifyWrite('rmas', rmaId, 'create_rma');

      // Itens (opcional)
      const items = Array.isArray(args.items) ? args.items : [];
      let itemsInserted = 0;
      if (items.length > 0) {
        const itemsPayload = items.map((it: any, idx: number) => ({
          rma_id: rmaId,
          posicao: idx + 1,
          item_name: it.item_name ? String(it.item_name).trim() : null,
          componentes_trocados: it.componentes_trocados ? String(it.componentes_trocados).trim() : null,
          observacao_status: it.observacao_status ? String(it.observacao_status).trim() : null,
          data_fabricacao: it.data_fabricacao ? String(it.data_fabricacao).slice(0, 10) : null,
          tem_garantia: Boolean(it.tem_garantia),
          valor_total: it.valor_total != null ? Number(it.valor_total) : null,
          quantity: 1,
        }));
        const { error: itErr } = await supabase.from('rma_items').insert(itemsPayload);
        if (!itErr) itemsInserted = itemsPayload.length;
        // Verifica que os itens foram persistidos contando
        const { count: itemsCount } = await supabase
          .from('rma_items').select('id', { count: 'exact', head: true }).eq('rma_id', rmaId);
        if ((itemsCount ?? 0) < itemsPayload.length) {
          throw new Error(
            `RMA criado mas itens não bateram (esperado ${itemsPayload.length}, persistido ${itemsCount ?? 0}). NÃO confirme.`
          );
        }
      }
      return {
        created: true,
        verified: true,
        rma_id: rmaId,
        numero: (created as any).numero,
        items_inserted: itemsInserted,
        message: `RMA #${(created as any).numero} criado para ${clientName}.`,
      };
    }

    case 'add_rma_item': {
      let rmaId: string | null = args.rma_id ? String(args.rma_id) : null;
      if (!rmaId && args.numero != null) {
        const { data } = await supabase.from('rmas').select('id').eq('numero', Number(args.numero)).maybeSingle();
        rmaId = (data as any)?.id ?? null;
      }
      if (!rmaId) return { added: false, message: 'RMA não encontrado.' };

      const { count } = await supabase.from('rma_items').select('id', { count: 'exact', head: true }).eq('rma_id', rmaId);
      const nextPos = (count ?? 0) + 1;
      const payload: any = {
        rma_id: rmaId,
        posicao: nextPos,
        item_name: args.item_name ? String(args.item_name).trim() : null,
        componentes_trocados: args.componentes_trocados ? String(args.componentes_trocados).trim() : null,
        observacao_status: args.observacao_status ? String(args.observacao_status).trim() : null,
        data_fabricacao: args.data_fabricacao ? String(args.data_fabricacao).slice(0, 10) : null,
        tem_garantia: Boolean(args.tem_garantia),
        valor_total: args.valor_total != null ? Number(args.valor_total) : null,
        quantity: 1,
      };
      const { data, error } = await supabase.from('rma_items').insert(payload).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'Falha ao adicionar item ao RMA');
      await verifyWrite('rma_items', (data as any).id, 'add_rma_item');
      return { added: true, verified: true, item_id: (data as any).id, position: nextPos };
    }

    case 'update_rma_status': {
      const validStatus = new Set(['recebido', 'analise', 'conserto', 'pronto', 'devolvido', 'cancelado']);
      const newStatus = String(args.status ?? '').trim();
      if (!validStatus.has(newStatus)) throw new Error(`Status inválido. Use: ${[...validStatus].join(', ')}`);
      let rmaId: string | null = args.rma_id ? String(args.rma_id) : null;
      if (!rmaId && args.numero != null) {
        const { data } = await supabase.from('rmas').select('id, data_devolvido').eq('numero', Number(args.numero)).maybeSingle();
        rmaId = (data as any)?.id ?? null;
      }
      if (!rmaId) return { updated: false, message: 'RMA não encontrado.' };

      const update: any = { status: newStatus, updated_at: new Date().toISOString() };
      if (newStatus === 'devolvido') {
        // Auto-preenche data_devolvido se ainda não tiver
        const { data: cur } = await supabase.from('rmas').select('data_devolvido').eq('id', rmaId).single();
        if (!(cur as any)?.data_devolvido) {
          update.data_devolvido = new Date().toISOString().slice(0, 10);
        }
      }
      const { error } = await supabase.from('rmas').update(update).eq('id', rmaId);
      if (error) throw new Error(error.message);
      const { data: verify } = await supabase
        .from('rmas').select('id, status').eq('id', rmaId).maybeSingle();
      if (!verify || verify.status !== newStatus) {
        throw new Error(`Status do RMA não bate (esperado ${newStatus}, atual ${verify?.status ?? 'nada'}). NÃO confirme.`);
      }
      return { updated: true, verified: true, rma_id: rmaId, new_status: newStatus };
    }

    case 'add_rma_observation': {
      let rmaId: string | null = args.rma_id ? String(args.rma_id) : null;
      if (!rmaId && args.numero != null) {
        const { data } = await supabase.from('rmas').select('id').eq('numero', Number(args.numero)).maybeSingle();
        rmaId = (data as any)?.id ?? null;
      }
      if (!rmaId) return { added: false, message: 'RMA não encontrado.' };
      const content = String(args.content ?? '').trim();
      if (!content) throw new Error('content é obrigatório');
      const { data, error } = await supabase
        .from('rma_observations')
        .insert({ rma_id: rmaId, content, author: ctx.currentUser ?? null })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { added: true, observation_id: (data as any)?.id };
    }

    default:
      throw new Error(`Tool desconhecida: ${name}`);
  }
}
