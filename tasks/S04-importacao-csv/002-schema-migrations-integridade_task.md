# T02 — Schema, migrations e integridade da importação

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — schema, migrations, integridade e testes PostgreSQL verificados em 2026-08-30.
- Onda: 1
- Dependências: T01, S01–S03
- Paralelização: Código pode avançar com T03–T05; aplicar migration é serial

## Subtarefas

- [x] Modelar `transaction_imports`, staging de preview e linhagem de itens com FKs compostas tenant-safe.
- [x] Estender a origem `IMPORT` do ledger e aplicar constraints, índices, unicidades e invariantes de contagem definidos no ADR-005.
- [x] Gerar migration Drizzle forward-only e atualizar o schema composto sem saldo derivado ou valores em float.
- [x] Cobrir isolamento, unicidade de fingerprint, retenção/consumo do staging e vínculos de eventos em PostgreSQL.
- [x] Executar typecheck, lint, testes unitários e integração PostgreSQL; registrar evidências e handoff para T06–T08.

## Objetivo

Criar o modelo mínimo para rastrear lotes, proteger preview/confirm e garantir idempotência sem armazenar saldo derivado.

## Escopo

- Criar `transaction_imports` tenant-scoped com conta, status, fingerprint de conjunto, totais, timestamps e referência ao usuário iniciador quando útil.
- Modelar staging/preview server-side ou token assinado com expiração, vinculando-o a `household_id`, `account_id`, fingerprint e conteúdo validado; não aceitar uma lista de linhas manipulável na confirmação.
- Vincular eventos importados ao lote por FK/metadata de origem, respeitando FKs compostas e `RESTRICT` onde houver significado histórico.
- Criar unique constraint para `(household_id, account_id, dataset_fingerprint)` e índices que suportem busca do lote/resultado sem acesso cross-tenant.
- Usar UUIDv7, migration Drizzle reversível quando suportado e checks de status/contagens coerentes.

## Critérios de aceite

- [x] Um lote não pode referenciar conta de outro household — FK composta `transaction_imports_account_household_fkey`; staging também usa a mesma barreira.
- [x] O mesmo conjunto para a mesma conta não possui dois lotes concluídos — índice único parcial `transaction_imports_household_account_fingerprint_uq` para `status=CONFIRMED`.
- [x] Eventos persistidos permitem identificar origem/importação sem criar fonte de verdade paralela — `financial_events.origin=IMPORT` e `transaction_import_items` fazem a linhagem tenant-safe.
- [x] Migration e schema passam typecheck e teste de integração PostgreSQL — migrations aplicadas em banco limpo/existente e suíte T02 verde.
- [x] Não há `accounts.balance` nem armazenamento de valores em float — valores de candidatos permanecem strings JSONB; nenhuma coluna financeira nova usa float.

## Subtarefas e evidências

- [x] Criado [`transaction-imports-schema.ts`](../../src/db/transaction-imports-schema.ts), com `transactionImports`, `transactionImportStaging` e `transactionImportItems`, IDs UUIDv7 e tipos inferidos de insert/select.
- [x] `transaction_imports` retém somente resumo auditável, fingerprint SHA-256, metadados técnicos, timestamps, status `CONFIRMED` e erros sanitizados; não armazena arquivo bruto nem saldo.
- [x] `transaction_import_staging` retém hash do token, contexto tenant/conta, candidatos normalizados e erros JSONB enquanto o preview está vivo; índices suportam token/expiração e a confirmação pode apagar a linha.
- [x] `transaction_import_items` mantém `row_number`, `external_id` e `financial_event_id`, com FKs compostas para lote/evento, unicidade por `(import_id, row_number)` e `RESTRICT` histórico.
- [x] Estendida a enumeração do ledger com `origin=IMPORT`; o check de forma mantém reversals `SYSTEM`, manuais canceláveis e importações somente `POSTED` não-reversal.
- [x] Aplicados checks de fingerprint/token hash (64 hex), versão, limites de 5 MiB/10.000 registros, partição de contagens, candidatos JSONB e status confirmado.
- [x] Integrada a migration Drizzle [`20260830133949_common_shen.sql`](../../drizzle/20260830133949_common_shen.sql), com ajustes de ordem/FK e casts necessários para `ALTER TYPE ... ADD VALUE` no PostgreSQL; as migrations incrementais [`20260830134031_hard_dragon_lord.sql`](../../drizzle/20260830134031_hard_dragon_lord.sql), [`20260830134235_married_professor_monster.sql`](../../drizzle/20260830134235_married_professor_monster.sql) e [`20260830135222_bumpy_stone_men.sql`](../../drizzle/20260830135222_bumpy_stone_men.sql) estabilizam os checks gerados.
- [x] Atualizado [`schema.ts`](../../src/db/schema.ts) e o contrato de origens do ledger para que consumidores de T06–T08 possam ler/persistir `IMPORT` sem enfraquecer os comandos manuais de S03.
- [x] Adicionada suíte opt-in [`transaction-imports.integration.test.ts`](../../src/db/transaction-imports.integration.test.ts), cobrindo migration/índices, lote/staging/linhagem, FKs cross-tenant, fingerprint único, token por household, checks de contagem, shape de evento e ausência de saldo/float.

## Handoff para T06–T08

- [x] T06 deve gravar em `transactionImportStaging`: `tokenHash`, `householdId`, `accountId`, `datasetFingerprint`, `formatVersion`, metadados de arquivo, `processedRows`/`validRows`/`invalidRows`, `errors`, `candidateRows`, `expiresAt`; leia sempre combinando `householdId` com hash e apague após confirmação/expiração.
- [x] T07 deve criar `transactionImports` na mesma transaction dos eventos/entries, preenchendo contagens, `errors`, `initiatedByUserId` opcional e `confirmedAt`; cada evento usa `origin=IMPORT`, e cada item usa `importId`, `rowNumber`, `externalId` e `financialEventId`.
- [x] T08 pode tratar conflito `23505` do índice `transaction_imports_household_account_fingerprint_uq` como conjunto já importado; retry de command continua usando `application_commands` de S03, enquanto token consumido deve ser removido do staging na transaction de sucesso.

## Verificações

- [x] `npm run db:check:files`: concluído sem divergências.
- [x] `npm run db:generate`: sem alterações pendentes após as migrations.
- [x] `npm run typecheck`: concluído sem erros.
- [x] `npm run lint`: concluído sem warnings/erros.
- [x] `npm test`: 214 testes passaram; 44 testes de integração foram pulados por opt-in.
- [x] `T02_INTEGRATION=1 DATABASE_URL=... npm exec vitest run src/db/transaction-imports.integration.test.ts --config vitest.integration.config.mts`: 4 testes passaram em PostgreSQL 16.
- [x] `DATABASE_URL=... npm run test:integration`: 44 testes passaram, incluindo T02 e as suítes de S01–S03; fixtures removidas pelos hooks.
- [x] Banco PostgreSQL limpo temporário: 10 migrations aplicadas, 0 pendentes/0 divergentes; T02 executou 4/4 testes e o banco foi removido após a verificação.
