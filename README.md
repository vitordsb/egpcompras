# EGP Compras

App interno da EGP Tecnologia para automatizar cotação de componentes com fornecedores.

## Fluxo

1. Admin cadastra **componentes** e **produtos** com sua **BOM** (lista de materiais + targets em BRL)
2. Cria uma **cotação** a partir de um produto e seleciona **fornecedores**
3. Sistema gera **link único por fornecedor** e dispara email
4. Fornecedor preenche preços (BRL ou USD) + IPI/PIS/COFINS/ST + OBS — itens em branco = não cotados
5. Comparativo destrava com **≥2 fornecedores respondidos**, mostra **vencedor por linha** pelo **preço efetivo BRL**

## Stack

- React 18 + Vite + TypeScript + Tailwind
- Supabase (Postgres + Auth + Edge Functions)
- AwesomeAPI (cotação USD/BRL, free)
- Resend (email — a integrar)
- Gemini 2.5 Flash (parsing de BOM e sanity-check — a integrar)

## Setup

```bash
pnpm install
cp .env.example .env
# preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
pnpm dev
```

### Banco

No Supabase Studio do projeto, abra o SQL Editor e rode:

```
supabase/migrations/0001_init.sql
```

Cria todas as tabelas, índices e duas views úteis:
- `quotation_comparison` — uma linha por (item × resposta) com **preço efetivo BRL** já calculado
- `quotation_winners` — vencedor por item (só retorna quando ≥2 fornecedores responderam)

### Cálculo do preço efetivo

```
effective_unit_price_brl = unit_price
                         × (1 + ipi_pct + pis_pct + cofins_pct + st_pct)
                         × (currency = 'USD' ? usd_brl_rate_used : 1)
```

## Status

| Módulo | Estado |
|---|---|
| Schema SQL completo | ✅ |
| Cadastro de produto + BOM | ✅ |
| Catálogo de componentes (UI) | ⏳ (insira via Studio por ora) |
| CRUD de fornecedores | ⏳ |
| Criar cotação + gerar tokens | ⏳ |
| Envio de email (Resend) | ⏳ |
| Portal público do fornecedor | ⏳ (rota e stub prontos) |
| Comparativo + vencedores | ⏳ (views SQL prontas) |
| Integração Gemini | ⏳ |

## Estrutura

```
src/
  components/         UI primitives e layout
  lib/                supabase client, helpers de moeda/formatação
  routes/
    admin/            telas internas (auth obrigatória — a configurar)
    public/           portal do fornecedor por token
  types/              tipos do banco
supabase/migrations/  SQL versionado
```

## Próximos passos sugeridos

1. Tela de **catálogo de componentes** (CRUD)
2. Tela de **fornecedores** (CRUD)
3. Wizard de **criar cotação** → snapshot de itens, gerar invites com tokens
4. Edge Function `send-invite` integrando Resend
5. Implementar `SupplierQuotePage` lendo via Edge Function `get-quote-by-token`
6. Tela de **comparativo** consumindo a view `quotation_comparison`
7. Auth (Supabase) + RLS nas tabelas internas
8. Edge Function chamando Gemini pra parsear BOM colada como texto/Excel
