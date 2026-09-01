# T05 — CreateExpense e CreateIncome

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — use cases, escrita transacional, idempotência e rollback verificados em 2026-08-29.
- Onda: 3
- Dependências: T02, T03 e T04
- Paralelização: Pode ser desenvolvida em paralelo com T06; integrações de observabilidade continuam em paralelo com T08

## Objetivo

Implementar a escrita vertical de receita e despesa manual, com validação, idempotência e atomicidade.

## Escopo

- Criar use cases explícitos `CreateExpense` e `CreateIncome`, compartilhando apenas a lógica realmente comum.
- Aceitar commands serializáveis contendo `commandId`, valor em centavos como string, data `YYYY-MM-DD`, descrição, `accountId` e `categoryId` opcional.
- Revalidar Zod no servidor e converter para tipos de domínio antes de persistir.
- Validar valor, data, conta, categoria, tenant e `tracking_started_on` conforme T02/T04.
- Criar, na mesma transaction:
  1. `FinancialEvent` com amount absoluto, origem manual e status `POSTED`;
  2. `AccountEntry` com sinal correto e `posted_on`;
  3. registro de `application_commands`.
- Usar `db.transaction()` controlada pelo use case; repositories não abrem transactions independentes.
- Tornar retry idempotente por `(tenant, commandId)` e definir resposta para command repetido/conflictante.
- Retornar `Result` com recurso criado ou erro de domínio; exceções inesperadas seguem para observabilidade.
- Não criar efeitos de cartão, parcelas, recorrências, orçamento ou distribuição automática de Caixinhas.

## Critérios de aceite

- [x] Despesa válida cria evento `EXPENSE`/`MANUAL` `POSTED` e entry negativo; coberto por `use-cases.integration.test.ts`.
- [x] Receita válida cria evento `INCOME`/`MANUAL` `POSTED` e entry positivo; coberto por `use-cases.integration.test.ts`.
- [x] Evento tem `amount_cents` positivo/absoluto e entry possui sinal; asserts do read model e consulta PostgreSQL confirmam `bigint`/sinais `-123456` e `98765`.
- [x] Lançamento `POSTED` no futuro é rejeitado com `DATE_IN_FUTURE` antes da persistência.
- [x] Conta/categoria inválidas, arquivadas ou cross-tenant são rejeitadas sem command/event/entry parcial; cross-tenant e arquivada estão cobertos na integração T05 e as invariantes de categoria são revalidadas pelo helper T04.
- [x] Retry com o mesmo `(household_id, commandId)` retorna o mesmo read model sem duplicar evento/entry; payload divergente retorna `COMMAND_ID_REUSED`, enquanto o mesmo ID em outro tenant é independente.
- [x] Falha entre inserts faz rollback de `application_commands`, `financial_events` e `account_entries`; trigger PostgreSQL injetado no teste comprova a atomicidade.
- [x] O use case recebe `FinancialContext` resolvido pelo servidor e os schemas estritos rejeitam `householdId`/status/origem/sinal enviados pelo cliente.

## Subtarefas e evidências

- [x] Criado [`use-cases.ts`](../../src/modules/transactions/use-cases.ts) com os ports explícitos `createExpense`/`createIncome` e aliases `CreateExpense`/`CreateIncome`; a operação fixa o tipo e o sinal não é aceito do command.
- [x] Revalidados os commands pelos schemas Zod T02 no servidor; `Money` converte centavos para `bigint` somente dentro do use case e a data é serializada como `YYYY-MM-DD`.
- [x] Reutilizado `validateManualTransactionReferencesForContext`/inserts tenant-scoped de T04 para conta ativa, categoria opcional ativa e compatível, data de acompanhamento e derivação server-side de `household_id`.
- [x] Reservado `(household_id, commandId)` dentro da mesma transaction, com hash canônico que inclui operação e campos efetivos; retries idempotentes e conflitos são diferenciados por `COMMAND_ID_REUSED`.
- [x] Persistidos atomicamente um `FinancialEvent` absoluto `POSTED`/`MANUAL`, um `AccountEntry` assinado `POSTED`/`posted_on` e o `application_commands.resource_id`; não são criados efeitos de cartões, parcelas ou recorrências.
- [x] Adicionada integração [`use-cases.integration.test.ts`](../../src/modules/transactions/use-cases.integration.test.ts) para receita/despesa, referências, isolamento, idempotência e rollback entre inserts.
- [x] O port mantém falhas técnicas fora do envelope de domínio para que T08 capture-as no adapter, sem payload financeiro em observabilidade.

## Verificações

- [x] `T05_INTEGRATION=1 DATABASE_URL=... MIGRATION_DATABASE_URL=... npm test -- --run src/modules/transactions/use-cases.integration.test.ts --config vitest.integration.config.mts`: 4 testes passaram em PostgreSQL 16.
- [x] `npm test -- --run src/modules/transactions/use-cases.integration.test.ts`: 4 testes de integração foram reconhecidos e pulados sem `T05_INTEGRATION`, preservando o suite padrão sem banco.
- [x] `npm run typecheck`: concluído sem erros.
- [x] `./node_modules/.bin/eslint src/modules/transactions/use-cases.ts src/modules/transactions/use-cases.integration.test.ts`: concluído sem warnings/erros.
- [x] Testes T02–T04 focados (`domain`, `validation`, `references`): 30 testes passaram.
