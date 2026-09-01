# T06 — Reads, listagem, detalhe e saldo derivado

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — leituras tenant-scoped, detalhe/histórico, filtros, extrato e saldo derivado implementados e verificados em 2026-08-29.
- Onda: 3
- Dependências: T03 e T04
- Paralelização: Pode ser desenvolvida em paralelo com T05

## Objetivo

Disponibilizar as leituras necessárias para a tela de transações e provar que a movimentação criada afeta o ledger sem armazenar saldo calculado.

## Escopo

- Criar query tenant-scoped para listar eventos manuais com seu entry, conta e categoria.
- Ordenar de forma determinística por data efetiva decrescente e desempate por UUIDv7/ID.
- Suportar filtros mínimos úteis:
  - período;
  - conta;
  - categoria;
  - tipo;
  - status.
- Manter os filtros serializáveis para uso em `searchParams`; origem manual pode ser um filtro fixo neste slice.
- Criar leitura de detalhe para `/transactions/[id]`, incluindo evento econômico, entry, status e relação de cancelamento/reversal quando houver.
- Retornar “não encontrado” para ID de outro tenant.
- Implementar ou completar leitura de saldo por conta como soma dos `POSTED account_entries` até uma data, sem `accounts.balance`.
- Expor movimentações da conta em formato compatível com o fluxo de S02.
- Usar consultas/joins/read models simples e índices reais; não introduzir CQRS ou estado global.

## Critérios de aceite

- [x] Um evento persistido aparece na lista por query de aplicação, com joins de
  evento/entry/conta/categoria, sem consulta administrativa ao banco.
- [x] Receita e despesa exibem amount absoluto do evento e sinal correto no
  `entry.amountCents` (`+3000` e `-1250`) no read model.
- [x] Filtros combinados de período, conta, categoria, tipo e status mantêm o
  predicado `household_id` em evento e joins; filtro cross-tenant retorna lista
  vazia.
- [x] Evento cancelado permanece consultável como `CANCELLED`, e o detalhe
  expõe o reversal `SYSTEM` relacionado.
- [x] Saldo é `SUM(account_entries.amount_cents)` dos entries `POSTED` até a
  data; a suíte verifica neutralização do entry cancelado pelo reversal.
- [x] Query de detalhe por evento de outro tenant retorna `EVENT_NOT_FOUND`,
  sem revelar dados ou existência do registro.
- [x] As queries usam os índices reais de T03: eventos por tenant/data e
  tenant/categoria/data, entries por tenant/conta/data de postagem.

## Subtarefas e evidências

- [x] Criado [`reads.ts`](../../src/modules/transactions/reads.ts) com queries
  tenant-scoped para lista manual, detalhe, reversal, saldo e movimentações de
  conta; o executor aceita o mesmo contexto transacional de T04.
- [x] Criados contratos serializáveis em
  [`contracts.ts`](../../src/modules/transactions/contracts.ts), incluindo
  filtros URL/searchParams, read models com referências S02 e statement `{ items
  }` com saldo derivado.
- [x] A lista ordena `occurred_on DESC, id DESC` e fixa `origin=MANUAL`; o
  detalhe carrega o reversal por `reversal_of_event_id` no mesmo household.
- [x] O saldo valida a conta no tenant atual e soma somente entries `POSTED`
  até `asOf`, sem coluna ou estado `accounts.balance`.
- [x] Adicionados aliases de composição/result para Server Actions e uma
  fachada opcional que resolve `requireFinancialContext`, sem tenant no
  payload do browser.
- [x] Adicionados testes unitários em [`reads.test.ts`](../../src/modules/transactions/reads.test.ts)
  para normalização de filtros/aliases, status, reversal e períodos inválidos.
- [x] Adicionada suíte PostgreSQL opt-in em
  [`reads.integration.test.ts`](../../src/modules/transactions/reads.integration.test.ts),
  cobrindo joins, ordenação, filtros combinados, isolamento, detalhe com
  cancelamento, sinais, saldo líquido e movimentações S02.

## Verificações

- [x] `npm run typecheck`: concluído sem erros.
- [x] `./node_modules/.bin/eslint src/modules/transactions/reads.ts
  src/modules/transactions/reads.test.ts
  src/modules/transactions/reads.integration.test.ts
  src/modules/transactions/contracts.ts src/modules/transactions/index.ts
  --max-warnings=0`: concluído sem warnings/erros.
- [x] `npm test -- --run src/modules/transactions/reads.test.ts
  src/modules/transactions/reads.integration.test.ts`: 4 testes unitários
  passaram; a suíte de integração ficou skip sem flag.
- [x] `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_test
  T06_INTEGRATION=1 npm test -- --config vitest.integration.config.mts --run
  src/modules/transactions/reads.integration.test.ts`: 6 testes passaram em
  PostgreSQL 16 real.
