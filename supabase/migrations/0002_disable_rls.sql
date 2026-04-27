-- Desabilita RLS nas tabelas internas pra app funcionar com a publishable key
-- enquanto ainda não temos Auth + policies por papel.
-- Quando integrarmos Supabase Auth, reativar e adicionar policies adequadas.

alter table components               disable row level security;
alter table products                 disable row level security;
alter table bom_items                disable row level security;
alter table suppliers                disable row level security;
alter table quotations               disable row level security;
alter table quotation_items          disable row level security;
alter table quotation_invites        disable row level security;
alter table quotation_responses      disable row level security;
alter table quotation_response_items disable row level security;
