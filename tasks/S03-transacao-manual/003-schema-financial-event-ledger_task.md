# T03 — Schema de FinancialEvent, AccountEntry e idempotência

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — schema, migration, constraints, índices e testes PostgreSQL verificados em 2026-08-29.
- Onda: 2
- Dependências: T01 e T02; schema base de S01/S02
- Paralelização: O desenho pode ocorrer em paralelo com T08/T09; a migration final deve ser integrada serialmente

## Objetivo

Persistir o fato econômico e seu efeito sobre a conta com constraints que preservem precisão, tenant e histórico.

## Escopo

- Criar ou completar `financial_events` com, no mínimo:
  - UUIDv7;
  - `household_id` canônico;
  - `kind` (`INCOME`/`EXPENSE`, mantendo extensibilidade para a TechSpec);
  - `status`;
  - origem;
  - `amount_cents` absoluto e positivo;
  - `occurred_on` como `DATE`;
  - descrição;
  - `category_id` anulável;
  - timestamps técnicos.
- Criar ou completar `account_entries` com:
  - UUIDv7;
  - `financial_event_id`;
  - `account_id`;
  - `household_id`;
  - `amount_cents` assinado;
  - `status`, `expected_on`, `posted_on` e timestamps quando aplicável.
- Representar a conta do lançamento manual no entry, preservando a separação entre evento econômico e efeito de ledger.
- Criar ou garantir `application_commands` com unicidade `(household_id, command_id)` e referência ao recurso criado.
- Aplicar FKs compostas para evitar evento/entry associado a conta, categoria ou tenant diferente.
- Se `accounts.tracking_started_on` não estiver disponível no schema de S02/Slice 1, adicioná-lo de forma forward-oriented ou concluir a decisão de não permitir lançamentos anteriores à data de criação.
- Aplicar checks para valor do evento maior que zero e entry não nulo/zero quando a tecnologia permitir.
- Aplicar índices iniciais para listagem e saldo:
  - eventos por tenant/data;
  - eventos por tenant/categoria/data;
  - entries por tenant/conta/data de postagem.
- Manter `RESTRICT` como default para entidades com significado histórico; não criar cascade que apague ledger.
- Gerar migration Drizzle versionada e executável em PostgreSQL real.
- Preparar campos/relações necessários ao reversal da T07 sem criar um modelo completo de refunds/parcelas.

## Subtarefas e evidências

- [x] Criado [`financial-events-schema.ts`](../../src/db/financial-events-schema.ts), com `financial_events` e `account_entries`, IDs UUIDv7 gerados pelo ponto único de S01, centavos em `bigint`, `DATE`, timestamps e tipos de status/origem.
- [x] Reutilizados `accounts.tracking_started_on` e `application_commands` de S02; não foram criadas coluna `accounts.balance`, tabela `transactions` ou tabela paralela de idempotência.
- [x] Aplicadas FKs compostas `(category_id, household_id)`, `(financial_event_id, household_id)` e `(account_id, household_id)`, todas com `ON DELETE RESTRICT`, além da relação de reversal tenant-safe.
- [x] Aplicados checks de valor positivo do evento, valor não nulo/zero do entry, descrição válida, shape de evento reversal e shape de entry `POSTED`.
- [x] Aplicados índices de eventos por tenant/data e tenant/categoria/data, entries por tenant/conta/data de postagem, e unicidade parcial de reversal por evento original.
- [x] Gerada e integrada a migration [`20260830011508_goofy_dragon_man.sql`](../../drizzle/20260830011508_goofy_dragon_man.sql); a ordem do índice composto de `financial_events` foi ajustada para permitir a criação dos FKs no PostgreSQL.
- [x] Adicionada suíte opt-in [`financial-events.integration.test.ts`](../../src/db/financial-events.integration.test.ts), cobrindo migration, precisão/sinal, FKs cross-tenant, checks, reversal único e bloqueio de exclusão histórica.

## Critérios de aceite

- [x] Não existe tabela de saldo ou `accounts.balance` como source of truth — confirmado por inspeção do schema limpo e consulta de `information_schema`.
- [x] Nenhum `AccountEntry` existe sem `FinancialEvent` — FK composta `account_entries_financial_event_household_fkey`, exercitada pela suíte PostgreSQL.
- [x] O banco impede referência cross-tenant para conta/categoria/evento — FKs compostas exercitadas pelos casos negativos da suíte.
- [x] O valor persistido não usa `float` — `amount_cents` é `bigint` em ambas as tabelas e a suíte valida `bigint` absoluto/assinado.
- [x] A migration sobe em banco PostgreSQL limpo e sobre o schema de S01/S02 — `npm run db:migrate` e `npm run db:migrate:status` retornaram 6 aplicadas, 0 pendentes, 0 divergentes nos dois cenários.
- [x] Reuso do mesmo `commandId` no tenant é barrado pela constraint — chave primária `(household_id, command_id)` existente e preservada em `application_commands` de S02.
- [x] Exclusão acidental de evento/entry utilizado é bloqueada — `ON DELETE RESTRICT` nas relações históricas; a suíte confirma bloqueio da exclusão do evento referenciado por entry/reversal.

## Verificações

- [x] `npm run db:check:files`: concluído sem divergências.
- [x] `npm run db:generate`: sem alterações pendentes após a migration.
- [x] `npm run typecheck`: concluído sem erros.
- [x] `./node_modules/.bin/eslint src/db/financial-events-schema.ts src/db/financial-events.integration.test.ts src/db/schema.ts`: concluído sem warnings/erros.
- [x] `npm test`: 167 testes passaram; 22 testes de integração foram pulados por opt-in.
- [x] `T03_INTEGRATION=1 DATABASE_URL=... npm test -- --run src/db/financial-events.integration.test.ts`: 4 testes passaram em PostgreSQL 16.
- [x] Banco descartável S01/S02 existente: migration aplicada, 6 aplicadas/0 pendentes/0 divergentes; fixtures T03 limpas ao final.
- [x] Banco PostgreSQL limpo temporário: todas as 6 migrations aplicadas, tabelas `accounts`, `categories`, `application_commands`, `financial_events` e `account_entries` presentes e `accounts.balance` ausente; banco removido após a verificação.
