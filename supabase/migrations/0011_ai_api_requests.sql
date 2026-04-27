-- Cada chamada do agente (uma mensagem do usuário) pode disparar várias
-- requests à API Gemini, porque o loop de function calling chama
-- generateContent uma vez pra cada rodada (resposta inicial + 1 por rodada de
-- tool calls). Esse é o limite que costuma bater (RPM=20 no free tier),
-- então precisamos trackear separado de tool_calls_count.
alter table ai_usage
  add column if not exists api_requests_count int not null default 0;
