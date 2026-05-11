-- RLS em user_profiles — proteção anti-escalation
--
-- Problema: hoje a tabela está sem RLS. Combinado com a anon key no bundle
-- JavaScript, qualquer pessoa com acesso ao painel JS consegue fazer:
--   PATCH /rest/v1/user_profiles?email=eq.seuemail&apikey=<anon>
--   { "role": "admin" }
-- e virar admin instantaneamente.
--
-- Solução: habilitar RLS. SELECT continua liberado (Edge Functions e
-- frontend leem pra resolver role). UPDATE/INSERT/DELETE: SÓ service_role.
-- Frontend nunca deveria escrever direto nessa tabela — vai via Edge
-- Function `wa-admin-set-role` (a criar no Sprint 2 quando UI de permissões
-- for refeita).

alter table user_profiles enable row level security;

-- Leitura: todos os tokens válidos podem ler (anon e authenticated).
-- O frontend precisa pra resolver role do usuário logado no auth-context.
drop policy if exists user_profiles_select on user_profiles;
create policy user_profiles_select
  on user_profiles for select
  using (true);

-- Escrita: NENHUM token público pode escrever. Apenas service_role
-- (Edge Functions, admin scripts) consegue mexer.
-- Não criar policies de INSERT/UPDATE/DELETE → bloqueio implícito.
-- service_role bypassa RLS automaticamente, então continua funcionando
-- via Edge Function.

-- rollback:
-- alter table user_profiles disable row level security;
-- drop policy if exists user_profiles_select on user_profiles;
