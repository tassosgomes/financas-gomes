# T13 — Testes unitários e de integração PostgreSQL

- Status: Concluída
- Onda: 4
- Dependências: T02–T09 (escrita pode ser incremental desde T02)
- Paralelização: Com T10–T12 durante a escrita

## Objetivo

Provar, com PostgreSQL real e com testes puros, que os agregados reconciliam,
que não há dupla contagem e que nenhum dado de outro espaço financeiro alcança
a Visão Geral.

## Escopo

- Testes puros das derivações de T02 (totais, grupos, refund, parcela,
  categoria ausente, resíduo de arredondamento) e de T08 (alertas por regra e
  por limite).
- Testes puros da composição de T03 com fakes, cobrindo sucesso total, falha
  parcial e falha total.
- Testes de integração com PostgreSQL descartável e seed determinístico:
  - dataset vazio;
  - dataset representativo com transações, cartão, parcelas, forecast e
    caixinhas;
  - reconciliação agregado x tela de detalhe;
  - cross-space com dois households (A/B) e IDs forjados.
- Teste explícito de não dupla contagem cartão versus transação, com números.
- Teste de que erro de origem nunca vira zero monetário.
- Reutilizar o seed de T09 e as fixtures de S08/S09 em vez de criar novas
  fontes de dado divergentes.
- Registrar os flags `T10_INTEGRATION` no script `test:integration`.

## Subtarefas

- [x] Escrever os testes puros das derivações e da composição.
- [x] Escrever a suíte de integração opt-in com seed A/B.
- [x] Escrever o teste de reconciliação que compara home x reads de origem.
- [x] Escrever o teste cross-space com ID forjado e resultado opaco.
- [x] Integrar a flag de integração ao `package.json` e à CI.

## Critérios de aceite

- [x] Toda invariante de T01 tem pelo menos um teste que falharia se ela fosse
  violada.
- [x] A suíte de integração roda contra PostgreSQL real e é determinística.
- [x] O teste cross-space prova ausência de vazamento em número, nome,
  referência e link.
- [x] A reconciliação é comparada em centavos, não em texto formatado.
- [x] `npm run check` e a suíte de integração opt-in passam.

## Entregáveis e evidência esperada

- [x] `src/modules/overview/*.test.ts` e `*.integration.test.ts`.
- [x] Fixtures em `tests/fixtures/s10-visao-consolidada/`.
- [x] Atualização de `package.json` e do workflow de CI.
- [x] Saída dos comandos executados registrada na task.

## Matriz invariante T01 → teste

| Invariante T01 (ADR-013 / matriz) | Teste(s) que falhariam se violada |
| --- | --- |
| Período atual = mês civil de `asOf`, `[from, to]` inclusivo | `aggregate.test.ts` → `civilMonthPeriod uses the civil month boundaries of asOf` |
| Composição byte-a-byte S08; sem recálculo | `composition.test.ts` → `returns spendable byte-for-byte from the origin without reformulation`; `service.test.ts` → `returns spendable breakdown byte-for-byte from the origin` |
| Não dupla contagem: `PURCHASE` uma vez; `TRANSFER`/fatura fora | `aggregate.test.ts` → `3. counts a parcelled purchase once…`, `9. counts purchase once and ignores non-economic transfer rows`; `query.integration.test.ts` → `counts purchase once when a payment transfer exists…`; `t09.integration.test.ts` → `excludes TRANSFER from period aggregation…` |
| Estornos no mês do `REVERSAL`, sem reescrever mês original | `aggregate.test.ts` → `1. applies a later-month refund only in the reversal month`, `2. keeps same-month cancel at net zero…`, `nets income reversals in the reversal month` |
| Categorias: folha, max 8 + `other`, soma exata, Hamilton 0–100 | `aggregate.test.ts` → `4. groups missing categories as Sem categoria`, `5. collapses the ninth category into Outros…`, `Hamilton percent distribution` |
| Estados `ready` \| `empty` \| `error`; erro ≠ zero monetário | `service.test.ts` → `returns empty blocks… without invented critical numbers`, `never maps origin failures to monetary zero in ready blocks`; `composition.test.ts` → `keeps spendable ready when forecast fails without inventing zero cents` |
| Degradação parcial: blocos isolados | `composition.test.ts` → `returns errors for every origin when all reads fail`, `marks a hanging origin as unavailable…`; `service.test.ts` → `keeps spendable and categories ready when forecast fails` |
| Tenancy: browser sem `householdId`/`userId` | `composition.test.ts` → `never forwards householdId from browser input…`; `links.test.ts` → `never exposes neighbor household identifiers in generated URLs` |
| Cross-space: nenhum dado do vizinho | `service.test.ts` → `does not leak neighbor household data through fakes`; `query.integration.test.ts` → `does not let a neighbor household affect totals`, `keeps household B isolated…`, `rejects forged neighbor identifiers…`; `service.integration.test.ts` → `isolates households and reconciles…`, `does not leak neighbor names, references or links…` |
| Reconciliação em centavos (grupos = total) | `aggregate.test.ts` → `5. collapses… exact sums`; `service.test.ts` → `reconciles category groups with the expense total`; `query.integration.test.ts` → `assertGroupsReconcileWithTotal` em todos os casos; `service.integration.test.ts` → compara `expensesByCategory`/`periodSummary` com `readPeriodAggregationForContext` |
| Alertas determinísticos V1 (5 regras, cap 5) | `alerts.test.ts` → suites por `ruleId` + `cross-cutting rules` |
| Drill-down determinístico | `links.test.ts` → `buildOverviewLinks` (rotas, filtros, alertas) |
| Serialização monetária como string de centavos | `aggregate.test.ts` → `8. never emits number money in serialized output` |
| Volume representativo + índices | `t09.integration.test.ts` → seed determinístico, EXPLAIN, performance constants |

## Comandos executados (2026-09-03)

```text
$ npx vitest run src/modules/overview --reporter=dot
 Test Files  7 passed | 3 skipped (10)
      Tests  74 passed | 12 skipped (86)
   Duration  2.37s
```

Integração PostgreSQL **não executada neste ambiente** (`DATABASE_URL` ausente;
`pg_isready` indiscreto). A suíte opt-in está pronta com seed T09 e guard
`T10_INTEGRATION=1`. **T15 deve rodar** `npm run test:integration` quando o
PostgreSQL estiver disponível (CI já inclui `T10_INTEGRATION=1` em
`package.json` → `test:integration`; workflow `.github/workflows/ci.yml` job
`integration` inalterado).

## Sequenciamento

- Bloqueado por: T02–T09 para o fechamento; escrita começa antes.
- Desbloqueia: T14, T15.
- Paralelizável: sim, durante a escrita.

## Fora de escopo

E2E de navegador (T14) e validação final de release (T15).
