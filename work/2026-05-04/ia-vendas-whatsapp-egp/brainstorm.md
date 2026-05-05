# Brainstorm: ia-vendas-whatsapp-egp
Data: 2026-05-04
Briefing: IA de vendas WhatsApp EGP — handoff humano, estoque em tempo real, geração de pedidos, inteligência de marketing

## Sessão 1 — 13:00

### Briefing original
Bot WhatsApp (Gemini 2.5 Flash + Supabase Edge Function) atendendo clientes B2B/B2C da EGP Tecnologia.
Melhorias solicitadas: handoff para vendedoras, check de estoque real, geração de pedido interno, promoções ativas.

---

## Síntese

### Consenso (4+ agentes concordam)

1. **Function Calling nativo do Gemini** é a abordagem correta para as 4 novas capacidades. O parsing de `%%PEDIDO%%` via regex é frágil, exposto a injection, e não escala para múltiplas ações no mesmo turno. (Backend, QA, Security, DevOps)

2. **Campo `status` em `whatsapp_sessions`** (`active | handoff | closed`) é a fonte de verdade do estado de handoff — a IA consulta antes de processar e ignora se `handoff`. (Backend, Frontend, UX, QA)

3. **Tabela `order_intents` separada** de `shipments` — intenções de compra via WhatsApp são rascunhos que precisam de aprovação humana antes de virar pedido real. (Backend, Frontend, QA)

4. **Tabela `promotions`** com campo `description_for_bot` (texto que a IA cita literalmente), `starts_at`, `ends_at` — elimina necessidade de o LLM raciocinar sobre datas e porcentagens. (Backend, UX, Frontend)

5. **Handoff caloroso com nome da vendedora e protocolo numerado** — o cliente não se sente abandonado, sabe quem vai atender. (UX, Backend, Frontend)

6. **Rate limiting por número de telefone** para evitar abuso e custo descontrolado de API. (Security, QA, DevOps)

7. **RLS habilitada nas tabelas WhatsApp** — hoje está desabilitada globalmente, expondo histórico de conversas e PII. (Security, Frontend, QA)

---

### Tensões e conflitos

| Tensão | Posição A | Posição B | Recomendação |
|--------|-----------|-----------|--------------|
| Tools via Function Calling vs parsing de texto | Backend/QA: Function Calling garante dado real, elimina injection | Sem defensor real — parsing é o estado atual por inércia | **Function Calling** — o parsing %%PEDIDO%% tem 3 vulnerabilidades críticas identificadas |
| Handoff: notificação via WhatsApp (mesmo WA_PHONE_ID) vs painel interno | Backend: enviar WA para vendedora é zero-infra | Frontend: painel com Realtime dá visibilidade de fila e SLA | **Ambos** — WA imediato + painel como gestão. Não são mutuamente exclusivos |
| order_intents reserva estoque imediatamente vs só registra intenção | Backend: reserva cria complexidade de rollback | QA: sem reserva há race condition de confirmação falsa | **Sem reserva agora** + comunicar "sujeito a confirmação". Adicionar reserva quando volume exigir |
| Expandir WhatsAppPage.tsx vs criar rotas dedicadas | Frontend: arquivo já tem 590 linhas, extrair antes | Backend: isolamento de acesso por role justifica rota própria | **Refatorar WhatsAppPage em sub-componentes + nova rota `/admin/handoffs`** para vendedoras com acesso restrito |

---

### Decisões críticas necessárias

1. **Function Calling ou continuar com parsing de texto?**
   - Recomendação: **Function Calling**. A abordagem de parsing tem 3 bugs críticos documentados (injection, JSON malformado, race condition de duplo webhook). Custo: latência sobe de ~1,5s para ~2,5-3,5s por mensagem.

2. **Handoff: IA para completamente ou continua em paralelo com vendedora?**
   - Recomendação: **IA para** ao detectar handoff (`status = 'handoff'`). Resposta automática: "Aguarde, {vendedora} vai te atender." Se IA continuar em paralelo com vendedora, cliente pode receber mensagens contraditórias.

3. **Vendedoras têm login no Supabase Auth ou são registros na tabela `sellers`?**
   - Recomendação: **Registros em `sellers`** inicialmente (nome, número WA, status). Se precisar de acesso ao painel interno, criar usuário Auth separado. Não misturar com os usuários atuais do app.

4. **order_intents reserva `reserved_quantity` imediatamente?**
   - Recomendação: **Não**. Comunicar "sujeito a confirmação de estoque" ao cliente. A vendedora confirma e converte manualmente. Reserva atômica é necessária apenas acima de ~50 pedidos/dia simultâneos.

5. **Supabase Free ou Pro? (urgente)**
   - Recomendação: **Upgrade para Pro ($25/mes) imediatamente**. Dados de venda em produção sem backup automático é risco inaceitável. O Free tier não tem backup automático.

---

### Top 5 riscos consolidados

| # | Risco | Severidade | Fonte |
|---|-------|-----------|-------|
| 1 | 🔴 **Prompt injection via `%%PEDIDO%%`**: cliente envia o bloco diretamente na mensagem e `createOrder` executa com dados arbitrários. Nenhuma validação de que o bloco veio do modelo. | CRÍTICO | Security + QA |
| 2 | 🔴 **Verify token `egp-whatsapp-2026` hardcoded no repositório git**: qualquer pessoa com acesso ao repo pode forjar webhooks. Já está no histórico git — o valor precisa ser rotacionado, não apenas movido. | CRÍTICO | Security |
| 3 | 🔴 **`dbUpdate` com `id` vazio atualiza TODAS as sessões**: quando `dbInsert` falha em `getSession`, `id = ''` → `PATCH /whatsapp_sessions?id=eq.` sem filtro → pode substituir histórico de todos os clientes. | CRÍTICO | QA |
| 4 | 🔴 **Sem backup automático no Supabase Free**: qualquer migration errada ou delete acidental perde dados de venda permanentemente. RPO real = semanas. | CRÍTICO | DevOps |
| 5 | 🔴 **Webhook spoofing sem validação de assinatura HMAC-SHA256**: a URL da Edge Function pode receber POSTs forjados criando sessões e pedidos fraudulentos. Meta envia `X-Hub-Signature-256` em todo POST real — não está sendo validado. | CRÍTICO | Security |

---

### Próximos passos acionáveis (próxima sessão)

1. **[30min] Corrigir 3 bugs críticos ANTES de qualquer feature nova:**
   - Guard: `if (!session.id) throw new Error('session id vazio')` antes de `saveSession`
   - Mover `VERIFY_TOKEN` para `Deno.env.get('WA_VERIFY_TOKEN')` e rotacionar valor
   - Sanitizar input do usuário: remover `%%PEDIDO%%` e `%%FIM%%` do texto antes de enviar ao Gemini

2. **[1h] Implementar validação HMAC-SHA256 do webhook Meta** (ver snippet no análise Security)

3. **[2h] Migration e tabelas:**
   ```sql
   -- whatsapp_sessions
   ALTER TABLE whatsapp_sessions ADD COLUMN status text NOT NULL DEFAULT 'active';
   ALTER TABLE whatsapp_sessions ADD COLUMN assigned_agent_phone text;
   ALTER TABLE whatsapp_sessions ADD COLUMN handoff_requested_at timestamptz;
   ALTER TABLE whatsapp_sessions ADD COLUMN collected_lead_data jsonb;

   -- sellers
   CREATE TABLE sellers (id uuid PK, name text, whatsapp_number text, status text DEFAULT 'available', updated_at timestamptz);

   -- order_intents
   CREATE TABLE order_intents (id uuid PK, session_id uuid FK, phone text, client_name text, items jsonb, forma_pagamento text, status text DEFAULT 'pending', created_at timestamptz);

   -- promotions
   CREATE TABLE promotions (id uuid PK, title text, description_for_bot text, product_id uuid nullable FK, sku text, discount_type text, discount_value numeric, starts_at timestamptz, ends_at timestamptz, active boolean DEFAULT true);
   ```

4. **[3h] Migrar webhook para Gemini Function Calling** com 4 tools:
   - `check_stock(sku)` → consulta `stock_items`, retorna `{available, quantity, message}`
   - `get_active_promotions(sku?)` → consulta `promotions` WHERE now() BETWEEN starts_at AND ends_at
   - `create_order_intent(client_name, items[], forma_pagamento)` → INSERT em `order_intents`
   - `escalate_to_human(reason)` → UPDATE `whatsapp_sessions.status = 'handoff'` + notifica vendedora via WA

5. **[2h] Frontend — painel de handoffs:**
   - Badge no menu "WhatsApp" com contagem de conversas aguardando vendedora
   - Subscricão Supabase Realtime no AdminLayout para notificação em tempo real
   - Tab "Fila" em `/admin/whatsapp` com botão "Assumir"

6. **[1h] Frontend — CRUD de promoções** em `/admin/promocoes` (form simples: produto, descrição para bot, preço, validade)

---

### Perguntas abertas consolidadas

- As vendedoras têm WhatsApp nos números pessoais delas, ou em um número empresarial separado? (Impacta como o handoff envia a notificação)
- Há horário de atendimento definido? O bot precisa saber quando dizer "próximo dia útil" vs "em minutos"
- O repositório é público ou privado? (Se público, verify token e lógica do bot estão expostos)
- A view `products_with_cost` retorna custo unitário além do preço de venda? (Risco de vazamento de margem via jailbreak)
- Supabase está no Free ou Pro tier atualmente?
- As promotions existem em algum formato estruturado no banco ou só no system prompt como texto livre?
- Qual volume esperado de conversas WA/mês em 6 meses? (Determina necessidade de queue async antes de 5s timeout)
- Clientes B2B recorrentes estão na tabela `clientes` com o telefone? (Permitiria IA personalizar abordagem)

---

## Análises individuais dos 6 agentes

### dev-backend
[análise completa arquivada — 22k tokens]
Principais: Function Calling em loop de 3 iterações max, tabelas order_intents + promotions + sellers, dedup por wamid, check_stock obrigatório antes de create_order_intent (server-side), notificação handoff via WA para vendedora.

### dev-frontend
[análise completa arquivada — 32k tokens]
Principais: Supabase Realtime no AdminLayout para notificação global, refatorar WhatsAppPage em sub-componentes antes de adicionar features, rota /admin/handoffs para acesso restrito vendedoras, rota /admin/promocoes para CRUD, painel de order_intents como coluna lateral no WhatsApp.

### dev-uiux
[análise completa arquivada — 15k tokens]
Principais: microcopy exato para cada situação (produto sem estoque, handoff, confirmação de pedido), protocolo numerado (#EGP-8F2K), tom B2B profissional com 0-1 emoji por mensagem, SLA visível no painel de vendedoras, modo co-piloto onde IA sugere respostas para a vendedora humana.

### dev-qa
[análise completa arquivada — 26k tokens]
Principais: 3 bugs críticos atuais (injection, dbUpdate vazio, concorrência de webhooks), suíte de testes ausente (sem jest/vitest), critérios de aceite para os 3 fluxos principais, smoke test pós-deploy obrigatório.

### dev-security
[análise completa arquivada — 21k tokens]
Principais: validação HMAC-SHA256 Meta obrigatória, verify token rotacionar imediatamente, separar view products_public_info (sem custo), LGPD com TTL de 90 dias nas mensagens, rate limiting por telefone.

### dev-devops
[análise completa arquivada — 19k tokens]
Principais: custo estimado $25-45/mês para volume atual, timeout crítico de 5s do WhatsApp (pattern de queue como next step), sem rollback nativo de Edge Function (manter branch edge/stable), CI/CD para auto-deploy da Edge Function via GitHub Actions, observabilidade com BetterStack + Sentry.
