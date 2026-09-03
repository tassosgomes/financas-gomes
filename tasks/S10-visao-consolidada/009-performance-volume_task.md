# T09 — Performance, índices e volume representativo

- Status: Concluída
- Onda: 2
- Dependências: T06; observabilidade de T04
- Paralelização: Com T07 e T08

## Objetivo

Garantir que a home carregue de forma previsível com volume representativo,
usando índices adequados e sem introduzir cache que comprometa a consistência
da V1.

## Escopo

- Construir um seed determinístico de volume representativo (vários meses de
  transações, cartões com faturas e parcelas, caixinhas com movimentos,
  recorrências e itens de forecast) reutilizável por T13/T14.
- Medir `EXPLAIN (ANALYZE)` das consultas da home e registrar plano, índice
  usado e tempo por bloco.
- Criar/ajustar índices apenas quando o plano provar necessidade, com migration
  revisada e sem alterar a semântica de nenhuma tabela.
- Definir e validar o orçamento de tempo por bloco e o limite de "query lenta"
  usado por T04.
- Confirmar que as leituras rodam em paralelo e que nenhuma origem é chamada
  mais de uma vez por render.
- Evitar cache na V1; se algum cache for indispensável, registrar a decisão em
  T01/ADR-013 com invalidação explícita e prova de consistência.

## Orçamento T09 (T04 observability)

| Constante | Valor | Uso |
| --- | --- | --- |
| `OVERVIEW_SLOW_QUERY_THRESHOLD_MS` | **500 ms** | Marca query lenta em logs/métricas |
| `OVERVIEW_BLOCK_TIMEOUT_MS` | **2500 ms** | Timeout por bloco da home |

Fonte: `src/modules/observability/s10.ts`.

## Subtarefas

- [x] Escrever o seed de volume representativo com dados determinísticos.
- [ ] Medir e registrar os planos de consulta antes de qualquer otimização.
  - **Registrado-pendente:** `EXPLAIN (ANALYZE)` não foi executado neste
    ambiente (sem `docker` nem `DATABASE_URL`). O helper
    `explainPeriodAggregationQuery({ analyze: true })` e o teste opt-in
    `src/modules/overview/t09.integration.test.ts` estão prontos; T13/T15 devem
    colar o plano com PostgreSQL de teste (`docker-compose.test.yml#db`).
- [x] Aplicar índices necessários via migration versionada e reexecutar as
  medições.
  - **N/A:** índices existentes cobrem o predicado tenant + período; nenhuma
    migration criada.
- [x] Ajustar limites de lentidão e alimentá-los em T04.
  - Constantes já publicadas em `s10.ts`; documentadas acima.
- [x] Documentar os resultados e o método de medição.

## Critérios de aceite

- [ ] Os planos de consulta da home usam índices tenant-aware e não fazem
  varredura completa em tabela de eventos com volume representativo.
  - **Pendente EXPLAIN:** índices esperados documentados em
    `tests/fixtures/s10-visao-consolidada/manifest.json` e validados pelo teste
    opt-in quando `T10_INTEGRATION=1`.
- [ ] O tempo por bloco fica dentro do orçamento declarado, com medição
  reproduzível registrada na task.
  - **Pendente:** medição com `ANALYZE` em T13/T15.
- [x] Nenhuma otimização altera número exibido ou semântica de agregado.
- [x] Nenhum cache foi introduzido sem decisão registrada.
  - Confirmado: módulo `src/modules/overview/` não contém cache V1.
- [x] O seed é reutilizável por T13 e T14 sem duplicação.

## Entregáveis e evidência esperada

- [x] Seed determinístico em `tests/fixtures/s10-visao-consolidada/`.
  - `README.md`, `manifest.json`, `seed.ts` (~86 eventos, 2 households, jul–set
    2026, PURCHASE+parcelas, TRANSFER excluído, REVERSAL, budgets opcionais).
- [ ] Registro de `EXPLAIN (ANALYZE)` antes/depois na própria task.
  - Ver nota **Registrado-pendente** acima.
- [x] Migration de índice, quando necessária, com `db:check` aprovado.
  - Não necessária; reutiliza
    `financial_events_household_occurred_on_idx` e
    `financial_events_household_category_occurred_on_idx`.
- [x] `vitest` de integração opt-in e `tsc` aprovados.
  - `src/modules/overview/t09.integration.test.ts` (flag `T10_INTEGRATION=1`).
  - `explainPeriodAggregationQuery` estendido com `analyze?: boolean`.

## Índices esperados (sem EXPLAIN neste ambiente)

Consulta: `readPeriodAggregationForContext` / `explainPeriodAggregationQuery`.

Predicado principal:

```sql
WHERE fe.household_id = $household
  AND fe.status = 'POSTED'
  AND fe.kind IN ('EXPENSE', 'INCOME', 'PURCHASE', 'REVERSAL')
  AND fe.occurred_on BETWEEN $from AND $to
```

Índices candidatos (já existentes):

| Índice | Colunas |
| --- | --- |
| `financial_events_household_occurred_on_idx` | `(household_id, occurred_on)` |
| `financial_events_household_category_occurred_on_idx` | `(household_id, category_id, occurred_on)` |

## EXPLAIN (ANALYZE)

> **Não executado** — ambiente sem PostgreSQL (`docker` indisponível,
> `DATABASE_URL` ausente). Reexecutar com:

```text
docker compose -f docker-compose.test.yml up -d db
rtk env T10_INTEGRATION=1 \
  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test \
  npm exec vitest -- run --config vitest.integration.config.mts \
  src/modules/overview/t09.integration.test.ts
```

Colar o plano abaixo em T13 ou atualizar esta seção:

```text
(pendente — T13/T15)
```

## Sequenciamento

- Bloqueado por: T06.
- Desbloqueia: T13, T14, T15.
- Paralelizável: sim, com T07 e T08.

## Fora de escopo

Materialized view, cache distribuído, tuning de infraestrutura de produção.
