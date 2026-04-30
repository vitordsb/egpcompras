-- Tipo da nota fiscal: distingue Venda, Retorno (RMA), Remessa, Demonstração
-- Default 'venda' mantém compatibilidade com pedidos antigos

alter table shipments add column if not exists tipo_nota text not null default 'venda'
  check (tipo_nota in (
    'venda',                  -- venda normal (CFOP 5102, 5403, 6102 etc)
    'retorno_conserto',       -- retorno de conserto (CFOP 5916, 6916) — EGP devolve item consertado ao cliente
    'retorno_garantia',       -- retorno em garantia/troca (CFOP 5949, 6949 com xMotivo)
    'remessa_demonstracao',   -- remessa para demonstração (CFOP 5912, 6912)
    'remessa_conserto',       -- envio para conserto externo (CFOP 5915, 6915)
    'remessa_industrializacao', -- envio para industrialização (CFOP 5901, 6901)
    'rma',                     -- RMA genérico (autorização de devolução)
    'outro'
  ));

-- Natureza da operação livre (texto da NF-e)
alter table shipments add column if not exists natureza_operacao text;

-- Data específica do RMA/retorno (separada de data_saida pra workflow distinto)
-- Por enquanto reusa data_saida — se precisar separar depois, criar coluna data_rma

create index if not exists shipments_tipo_nota_idx on shipments(tipo_nota) where tipo_nota != 'venda';
