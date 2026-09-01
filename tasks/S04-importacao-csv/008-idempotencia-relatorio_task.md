# T08 — Idempotência de conjunto e relatório final

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — idempotência de conjunto, relatório tenant-safe e testes verificados em 2026-08-30.
- Onda: 2
- Dependências: T02 e T07
- Paralelização: Com T09 e T10

## Subtasks

- [x] Revisar contrato ADR-005 e integração de T02/T07
- [x] Garantir retry idempotente por `(household_id, commandId)` com resultado original
- [x] Garantir unicidade concorrente do fingerprint por household/conta
- [x] Persistir e consultar relatório final tenant-safe, sem arquivo bruto
- [x] Cobrir retry, concorrência, reordenação, duplicidade de linhas e isolamento em testes
- [x] Validar suíte, atualizar checklist e preparar handoff para T11/T12/T13

## Objetivo

Evitar duplicação por retry ou reenvio do mesmo conjunto e consolidar o resultado persistido da importação.

## Escopo

- Fazer `commandId` retornar o resultado original em retry, sem novo lote ou entries.
- Garantir atomicamente a unicidade do fingerprint por household/conta e tratar conflito concorrente sem duplicar silenciosamente.
- Exibir conjunto repetido como bloqueado/resultado existente, com link tenant-scoped para o lote quando apropriado.
- Persistir e consultar relatório com contagens, status e erros sanitizados por linha; não reter arquivo bruto sem decisão explícita de T01.
- Diferenciar duplicidade de conjunto de duas linhas economicamente iguais que devem permanecer importáveis no mesmo arquivo.

## Critérios de aceite

- [x] Double-click, retry de rede e duas confirmações concorrentes não criam duplicatas.
- [x] Reimportar o mesmo conjunto em ordem diferente não duplica silenciosamente.
- [x] Household distinto não descobre fingerprint, lote ou resultado de outro household.
- [x] Relatório final é consistente com o que foi persistido.

## Entregas e evidências

- [x] Confirmações novas e conflitos `DUPLICATE_DATASET` reservam o command
  tenant-scoped em `application_commands`; o snapshot JSONB mantém o resultado
  serializável exato para retry mesmo após a expiração/limpeza do staging.
- [x] A unicidade de `(household_id, account_id, dataset_fingerprint)` continua
  sendo decidida pelo índice parcial de T02; a confirmação mantém uma única
  transaction para command, lote, ledger, linhagem e consumo do staging.
- [x] Criada a consulta `find/getCsvImportReport(ForContext)`, com predicados
  compostos de household, validação de contagens/linhagem e sanitização das
  mensagens de erro; aliases de transaction-import e a facade
  `csvImportReportAccess` estão disponíveis para T11.
- [x] Adicionadas as actions `findCsvImportReportAction` e
  `getCsvImportReportAction`; o payload de leitura carrega apenas status, IDs,
  contagens e erros por linha, sem arquivo, fingerprint, token ou metadata
  bruto.
- [x] Cobertura em [`reports.test.ts`](../../src/modules/transaction-imports/reports.test.ts)
  para sanitização/invariantes e em
  [`idempotency-report.integration.test.ts`](../../src/modules/transaction-imports/idempotency-report.integration.test.ts)
  para relatório, retry depois da limpeza do staging, reordenação, corrida,
  isolamento e ausência de eventos/lotes duplicados.
- [x] Migration [`20260830144631_icy_omega_sentinel.sql`](../../drizzle/20260830144631_icy_omega_sentinel.sql)
  adiciona o snapshot nullable de resultado ao command compartilhado, sem
  alterar commands de S02/S03.

## Verificações

- [x] `rtk npm run typecheck` — aprovado.
- [x] `rtk npm run lint -- --no-cache` — aprovado sem warnings/erros.
- [x] `rtk npm test -- --reporter=dot` — 293 testes passaram; 58 testes de
  integração opt-in permaneceram fora dessa execução.
- [x] `DATABASE_URL=... MIGRATION_DATABASE_URL=... rtk npm run test:integration`
  — 15 arquivos e 58 testes PostgreSQL passaram, incluindo T07/T08.
- [x] `rtk npm run db:check:files` e `rtk npm run db:migrate:status` — schema
  consistente; 11 migrations aplicadas, 0 pendentes e 0 divergentes.

## Handoff para T11/T12/T13

- T11 deve usar `toCsvImportResultViewModel` para o resultado da confirmação e
  `csvImportReportAccess.find/get(importId)` ou as actions de relatório para
  reidratar o sumário; `DUPLICATE_DATASET` mantém `existingImportId` opaco e
  tenant-scoped.
- T12 pode executar `T08_INTEGRATION=1` e consumir a suíte de idempotência para
  concorrência, retry após retenção, reordenação/multiconjunto e consulta
  cross-household. O relatório `IMPORTED` só é retornado quando a linhagem tem
  exatamente `imported` itens.
- T13 deve incluir a migration do snapshot de command, confirmar 0 pendências
  no status Drizzle, revisar que staging não guarda arquivo bruto e repetir o
  smoke de reenvio bloqueado com a fixture sintética.
