# T07 — Confirmação transacional e criação no ledger

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — confirmação atômica, consumo de staging, retry por command e testes validados em 2026-08-30.
- Onda: 2
- Dependências: T02, T06 e S03
- Paralelização: Preparação pode ocorrer com T08/T09

## Subtarefas

- [x] Definir o port de confirmação e o adapter da Server Action aceitando somente `commandId` e `previewToken`.
- [x] Revalidar staging, token, conta ativa, âncora temporal e fingerprint dentro de uma única transaction.
- [x] Criar lote, eventos `IMPORT`, entries `POSTED`, itens de linhagem e `application_commands` atomicamente.
- [x] Implementar retry idempotente e rollback seguro, mantendo o token disponível quando a transaction falhar.
- [x] Cobrir confirmação, isolamento, invariantes do ledger e rollback com testes unitários/integração.

## Objetivo

Confirmar uma prévia válida criando seus lançamentos no modelo financeiro canônico em uma única transaction.

## Escopo

- Criar use case `ConfirmTransactionImport` que recebe apenas `commandId` e token de prévia, deriva contexto e revalida vínculo/expiração.
- Aplicar a estratégia parcial: persistir todas as linhas válidas da prévia; excluir as inválidas já reportadas; refletir isso no relatório.
- Na mesma `db.transaction()`, criar lote, `FinancialEvent` por linha, `AccountEntry` com sinal e `application_commands` conforme S03.
- Reutilizar invariantes de S03: valor absoluto positivo no evento, `POSTED`, `occurred_on`/`posted_on`, conta e household corretos, saldo derivado.
- Consumir/invalidar token somente com sucesso da transação ou definir retry seguro de forma explícita com T08.

## Critérios de aceite

- [x] Linhas válidas entram na conta escolhida e aparecem na listagem de transações.
- [x] Falha em qualquer insert ou constraint faz rollback de lote, eventos, entries e command.
- [x] A confirmação não aceita conta, tenant, tipo ou valores fornecidos pelo client.
- [x] Resultado informa quantidade importada e quantidade inválida/ignorada.

## Entregas e evidências

- [x] Criado [`confirmation-use-cases.ts`](../../src/modules/transaction-imports/confirmation-use-cases.ts), com `ConfirmTransactionImport`, token hash-only, staging tenant-scoped, revalidação de conta/âncora/datas, fingerprint e transaction única.
- [x] Criados adapters/aliases em [`adapters.ts`](../../src/modules/transaction-imports/adapters.ts) e actions em [`transaction-imports.ts`](../../src/app/actions/transaction-imports.ts), com allow-list estrita dos dois campos da confirmação.
- [x] Persistidos atomicamente `transaction_imports`, `FinancialEvent` (`IMPORT`/`POSTED`), `AccountEntry` assinado (`POSTED`), `transaction_import_items` e `application_commands`; staging é apagado somente no commit.
- [x] Retry do mesmo `(household, commandId, previewToken)` reidrata o lote original; erro de inserts/constraint mantém staging e não deixa lote/eventos/entries/command parciais. Outro command para token consumido recebe `PREVIEW_ALREADY_CONSUMED` pelo hash do command.
- [x] Adicionados [`confirmation-adapters.test.ts`](../../src/modules/transaction-imports/confirmation-adapters.test.ts) e [`confirmation.integration.test.ts`](../../src/modules/transaction-imports/confirmation.integration.test.ts), cobrindo autoridade mínima, isolamento, expiração, conta arquivada, retry e rollback injetado.

## Handoff para T08, T10 e T12

- [x] T08: usar `csvImportConfirmationUseCase`/`createCsvImportConfirmationUseCase` ou `confirmTransactionImport`; `DUPLICATE_DATASET` é retornado com `ignoredDuplicate = valid`, e corrida de fingerprint `23505` é convertida em resultado duplicado sem efeitos novos.
- [x] T10: usar `confirmCsvImportAction`/`confirmTransactionImportAction` com `{ commandId, previewToken }` apenas; `confirmResult` do adapter fornece envelope seguro para erros esperados quando necessário.
- [x] T12: executar `T07_INTEGRATION=1` contra PostgreSQL descartável; a suíte verifica ledger canônico, contagens parciais, tenant isolation, token/command, retry e rollback.

## Verificações

- [x] `rtk npm test -- --run src/modules/transaction-imports/confirmation-adapters.test.ts src/modules/transaction-imports/ui-contracts.test.ts src/modules/transaction-imports/preview-adapters.test.ts src/modules/transaction-imports/csv-parser.test.ts` — 25 testes passaram.
- [x] `DATABASE_URL=... MIGRATION_DATABASE_URL=... T02_INTEGRATION=1 T06_INTEGRATION=1 T07_INTEGRATION=1 rtk npx vitest run --config vitest.integration.config.mts src/db/transaction-imports.integration.test.ts src/modules/transaction-imports/preview.integration.test.ts src/modules/transaction-imports/confirmation.integration.test.ts` — 16 testes passaram.
- [x] `rtk npx tsc --noEmit --pretty false` — aprovado.
- [x] ESLint local nos arquivos alterados — aprovado com `--max-warnings=0 --no-cache`.
