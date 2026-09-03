# T05 — Reads tenant-safe, saldo e progresso

- Status: Concluída — reads server-side tenant-safe, observabilidade de acesso
  composta e isolamento/vigência/saldo derivados verificados em PostgreSQL
  opt-in.
- Retomada T05: 2026-09-02 — implementação server-side real, composição S09 e
  suíte PostgreSQL seedada persistidas e verificadas sob o write set desta task.
- Onda: 2
- Dependências: T02, T03, T04, S02 e contratos de ledger/forecast
- Paralelização: Com a preparação de T06, T09 e T13

## Objetivo

Construir as leituras server-side que apresentam Caixinhas e posições
derivadas, sempre dentro do household resolvido pela sessão.

## Escopo

- Implementar readers/repositories mínimos para listar Caixinhas ativas,
  encerradas e detalhe histórico, carregando movimentos e regras somente do
  household atual.
- Calcular saldo até `asOf`, saldo do período, aportes, retiradas, gasto
  líquido, rollover, meta, faltante, progresso e status de encerramento sem
  ler campo de saldo persistido.
- Expor read models serializáveis com strings de centavos, datas ISO, status,
  referências e links/ações autorizados pelo servidor.
- Consultar categorias/eventos/entries/parcelas apenas pelas relações e datas
  fechadas em T01/T04; não criar uma segunda fonte para forecast ou Spendable.
- Tratar household inexistente, Caixinha inexistente, categoria arquivada,
  origem removida e configuração ausente com resultado/erro opaco apropriado.
- Medir queries reais e manter índices/paginação compatíveis com a escala V1.

## Rastreabilidade / evidências (2026-09-02)

- A implementação real está persistida em `query.ts`, `read-contracts.ts`,
  `service.ts`, `reads.test.ts` e `reads.integration.test.ts`; a composição S09
  fica no acesso público de `service.ts` e os arquivos estão no write set de
  T05.
- `query.ts` aplica `household_id` nos filtros e joins de budgets, categorias,
  movimentos, regras e eventos; `service.ts` revalida o tenant das linhas
  retornadas antes de mapear qualquer DTO.
- `service.ts` usa `deriveBoxBalance`, `deriveBudgetProgress`,
  `deriveBudgetPeriodSummary` e os resolvers de T04 para efeitos financeiros,
  alocação e estado temporal. Não há escrita de snapshot ou campo `balance`.
- A paginação usa cursores keyset tenant-bound e busca separada dos dados
  necessários aos totais; o limite da página não trunca saldo, progresso ou
  reconciliação.

## Subtarefas

- [x] Criar `query.ts`, contratos de read model e serviço de leitura no módulo
  de Caixinhas. Prova: `reads.test.ts` passou 7/7; TypeScript e ESLint
  passaram em 2026-09-02.
- [x] Repetir `household_id` nos predicates e joins, validando FKs compostas e
  referências antes de retornar qualquer origem. Prova: teste de isolamento
  de lista/detalhe, suíte seedada PostgreSQL e teste de falha opaca passaram em
  2026-09-02.
- [x] Integrar `deriveBoxBalance` e os resolvers de T04; ordenar movimentos e
  referências de forma determinística. Prova: testes de saldo negativo,
  `closedOn`, rollover/efeito `PURCHASE` único e conjunto `src/modules/budgets`
  passaram 40/40.
- [x] Implementar paginação/limites para histórico sem truncar os totais
  derivados necessários à reconciliação. Prova: teste de limite, cursor e
  totais completos passou em `reads.test.ts`.
- [x] Cobrir queries lentas/ausência de dados com observabilidade de T09,
  sem registrar SQL ou dados financeiros. Prova: `createBudgetReadAccess` e
  `createBudgetReadUseCases` compõem `instrumentS09BudgetReadAccess`; o teste
  unitário confirma `budget.read`, correlação, resultado esperado/opaco e
  redaction, enquanto a medição de lentidão permanece coberta pela suíte S09.

## Critérios de aceite

- [x] Forjar um ID de outro household retorna ausência/erro opaco e nunca
  nome, saldo, progresso, movimento ou referência estrangeira. Prova:
  `reads.test.ts` valida detalhe estrangeiro como `BUDGET_NOT_FOUND` e também
  verifica que o JSON não contém IDs internos/tenant estrangeiro.
- [x] A mesma entrada e dados retornam read model determinístico, inclusive em
  saldo negativo, rollover e consulta antes/depois de `closedOn`. Prova:
  testes focados e a suíte de domínio de budgets passaram em 2026-09-02.
- [x] Todos os valores monetários do contrato são centavos serializados; o
  serviço não persiste snapshot nem `balance`. Prova: teste de JSON/DTO e
  inspeção do serviço de leitura sem operações de escrita passaram; o saldo é
  derivado por T02.
- [x] A consulta não soma compra, parcela, fatura e pagamento como fontes
  concorrentes e preserva referências necessárias ao provider S09. Prova:
  teste `PURCHASE` único e referências preservadas passou; as queries usam
  apenas eventos canônicos `EXPENSE`/`PURCHASE` POSTED e movimentos persistidos.

## Entregáveis e evidência esperada

- [x] `src/modules/budgets/query.ts`, `read-contracts.ts` e `service.ts`,
  consumindo os contratos/exports existentes de T02 sem editar T02.
- [x] Read models de lista, detalhe, histórico, saldo e progresso, com DTOs
  serializáveis, erros opacos e cursores vinculados aos filtros.
- [x] Testes unitários do mapeamento e testes PostgreSQL opt-in de isolamento,
  vigência e saldo derivado. Prova: `reads.test.ts` passou 7/7, incluindo regra
  efetiva, DTO em strings e composição de observabilidade; `reads.integration.test.ts`
  passou 2/2 com seed A/B real, regra efetiva, data de encerramento inclusiva
  no histórico, proteção zerada após encerramento e detalhe estrangeiro opaco.
- [x] Evidência de `EXPLAIN`/índices para lista, movimentos e regras: os três
  planos foram obtidos em 2026-09-02; movimentos usaram
  `budget_movements_household_budget_effective_on_id_idx`, regras usaram
  `budget_allocation_rules_household_effective_from_idx` e a consulta de
  budgets usou índice tenant-aware existente.

## Evidências executadas (2026-09-02)

- `rtk npm exec vitest -- run src/modules/budgets/reads.test.ts --reporter=dot`
  — 1 arquivo, 7 testes aprovados.
- `rtk env DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test
  MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test
  T05_INTEGRATION=1 npm exec vitest -- run --config vitest.integration.config.mts
  src/modules/budgets/reads.integration.test.ts --reporter=dot` — 1 arquivo,
  2 testes aprovados contra PostgreSQL descartável com seed A/B.
- `rtk npm exec vitest -- run src/modules/budgets --reporter=dot` — 4 arquivos,
  40 testes aprovados e 2 opt-in ignorados sem flag.
- `rtk npm exec vitest -- run src/modules/observability --reporter=dot` — 10
  arquivos, 70 testes aprovados.
- `rtk npm exec eslint -- src/modules/budgets/query.ts src/modules/budgets/read-contracts.ts src/modules/budgets/service.ts src/modules/budgets/reads.test.ts src/modules/budgets/reads.integration.test.ts --max-warnings=0`
  — aprovado (`ok`).
- `rtk npm exec tsc -- --noEmit --pretty false` — aprovado (`ok`).
- `rtk git diff --check` — aprovado, sem saída; como os cinco fontes ainda
  estão não rastreados no worktree, `rtk rg -n "[[:blank:]]+$"` nos cinco
  arquivos também não encontrou whitespace terminal.
- `rtk pg_isready -h localhost -p 5433` — PostgreSQL aceitando conexões.
- Smoke real com `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_t03_final`
  chamando `listBudgetRowsForContext` — query executada, `rows: 0`,
  `hasNextPage: false`, `nextCursor: null`.
- `rtk psql ... -X -v ON_ERROR_STOP=1 -c "EXPLAIN (COSTS OFF) ..."` para
  budgets, movimentos e regras — três planos aprovados, com os índices
  tenant-aware descritos acima.

## Pendências e gates explícitos

- T09 continua owner da observabilidade transversal de writes/provider e dos
  gates globais; T05 compõe o adapter de reads sem registrar SQL ou dados
  financeiros.
- A prova PostgreSQL seedada de T05 foi executada em `reads.integration.test.ts`;
  T13 pode reutilizar a mesma fixture/seed para composição end-to-end.
- Não foram alterados schema/migration, queries persistidas fora do write set,
  commands, provider, implementação transversal de observabilidade ou UI; a
  mudança de T05 apenas compõe o adapter S09 no acesso de leitura. A integração
  posterior com T04, T07, T08 e T13 permanece um gate de composição, não uma
  falha dos readers.

## Handoff

- T04: T05 consome `resolveEffectiveAllocationRules`,
  `resolveBudgetFinancialEffects` e `resolveBudgetTemporalState`; T04 pode
  integrar a persistência sem duplicar a derivação de saldo.
- T05: os consumidores devem usar os exports de `read-contracts.ts`, `query.ts`
  e `service.ts` com `FinancialContext` resolvido pelo servidor; `householdId`
  não entra por query pública.
- T07: use os mesmos `referenceId`, `sourceReference` e invariantes tenant-safe
  ao confirmar estado antes de writes; não trate DTO de saldo como snapshot.
- T08: derive `ReserveBox[]` a partir da fonte tenant-safe e das referências
  retornadas, sem receber `householdId` na porta pública.
- T13: reutilizar o teste PostgreSQL opt-in seedado e validar a composição
  end-to-end; as fixtures de domínio e o fake de `BudgetReadQueries` em
  `reads.test.ts` continuam reutilizáveis.
- T06 pode usar os readers para confirmar estado e referências antes de writes,
  sujeito aos gates acima.
