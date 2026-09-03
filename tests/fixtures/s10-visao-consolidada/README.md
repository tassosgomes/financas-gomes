# Fixtures sintéticas do S10 — T09 (volume representativo)

Seed determinístico reutilizável por T13, T14 e T15 para medir a agregação de
período da Visão Geral com volume representativo (~86 eventos financeiros em
três meses civis, dois households A/B, ~86 eventos financeiros).

## Conteúdo

| Artefato | Função |
| --- | --- |
| `manifest.json` | Índice do seed, orçamento de performance e índices esperados |
| `seed.ts` | IDs UUIDv7-shaped, `seedS10VolumeFixtures` e `cleanupS10VolumeFixtures` |

O seed inclui:

- **10 categorias de despesa + 1 de receita** no household A (exercita `Outros`
  com mais de 8 grupos nomeados em setembro).
- **5 categorias de despesa + 1 de receita** no household B.
- Despesas e receitas recorrentes em **jul/ago/set 2026**.
- Um **PURCHASE** com plano de parcelas (S06) no household A.
- Um **TRANSFER** que não entra na agregação de período.
- Um **REVERSAL** de despesa de julho postado em setembro.
- Duas **Caixinhas** (budgets) opcionais para reuso em T13.

## Orçamento T09 (T04 observability)

| Constante | Valor |
| --- | --- |
| `OVERVIEW_SLOW_QUERY_THRESHOLD_MS` | 500 ms |
| `OVERVIEW_BLOCK_TIMEOUT_MS` | 2500 ms |

## Índices esperados

A consulta de agregação de período deve usar índices tenant-aware em
`financial_events`:

- `financial_events_household_occurred_on_idx` (`household_id`, `occurred_on`)
- `financial_events_household_category_occurred_on_idx`
  (`household_id`, `category_id`, `occurred_on`)

Nenhum cache V1 foi introduzido no módulo `overview`.

## Execução PostgreSQL (opt-in)

```text
rtk env T10_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test \
  npm exec vitest -- run --config vitest.integration.config.mts \
  src/modules/overview/t09.integration.test.ts
```

`explainPeriodAggregationQuery` em `src/modules/overview/query.ts` aceita
`analyze: true` para `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)`.

Quando PostgreSQL não estiver disponível no ambiente de escrita, o seed e os
testes documentam os índices esperados; o `EXPLAIN (ANALYZE)` completo fica
registrado em T13/T15 com o banco de teste (`docker-compose.test.yml#db`).
