# T07 — Edição segura e cancelamento

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — implementação, suíte T07 e integração T03–T05 verificadas em 2026-08-29.
- Onda: 4
- Dependências: T03, T04 e T05; decisões da T01
- Paralelização: Não no caminho principal; desbloqueia a UI de manutenção e o E2E completo

## Subtarefas

- [x] Implementado `UpdateManualTransaction` com edição exclusiva de descrição/categoria, tenant e idempotência em `use-cases.ts`.
- [x] Implementado `CancelManualTransaction` atômico com reversal único, preservação do histórico e retry idempotente em `use-cases.ts`.
- [x] Cobertos contrato, isolamento, rollback, neutralização do ledger e conflitos em `maintenance.integration.test.ts` (4 cenários PostgreSQL).
- [x] Documentados o port de manutenção e o contrato de integração para T08/T12; critérios e verificações abaixo registram as evidências.

## Objetivo

Permitir manutenção do lançamento sem apagar histórico nem sobrescrever silenciosamente efeitos financeiros já postados.

## Escopo

- Implementar `UpdateManualTransaction` apenas para campos autorizados pela T01:
  - descrição;
  - categoria, inclusive remoção para `NULL`, respeitando tenant, status ativo e tipo.
- Manter valor, conta, data e tipo não editáveis por `UPDATE` direto quando o evento está `POSTED`.
- Se o produto exigir alteração de campo financeiro no S03, implementar uma operação explícita de correção/cancelar-e-substituir compatível com `REVERSAL`; não ampliar para refunds ou parcelamentos.
- Implementar `CancelManualTransaction`/equivalente:
  - verificar que o evento é manual, do tenant atual e ainda cancelável;
  - impedir cancelamento duplicado;
  - preservar evento e entries originais;
  - registrar o efeito compensatório como evento/entry de reversal conforme o contrato da T01;
  - atualizar o estado de ciclo de vida sem apagar o histórico;
  - executar tudo em uma transaction e aceitar retry idempotente.
- Expor histórico suficiente para a tela distinguir lançamento original e efeito compensatório.
- Rejeitar operação sobre evento já cancelado, não manual ou inexistente com erro esperado.
- Não implementar refund parcial, reversal genérico, correção de parcelamento ou reparenting de categoria.

## Critérios de aceite

- [x] Descrição pode ser editada sem alterar valor/ledger — integração confirma descrição normalizada, `amount_cents` e entry inalterados.
- [x] Categoria pode ser alterada ou removida somente quando válida para o tipo do evento — integração cobre categoria ativa, `NULL`, cross-tenant, arquivada e incompatível.
- [x] Nenhum evento `POSTED` tem valor, conta, data ou tipo sobrescritos silenciosamente — schema estrito rejeita campos protegidos com `NON_EDITABLE_FIELD`; o update só grava metadata.
- [x] Cancelamento não faz hard delete — evento/entry originais permanecem `CANCELLED`/`POSTED` e o reversal é um novo evento.
- [x] O ledger fica líquido/neutralizado pelo efeito compensatório — entry do reversal usa sinal oposto e o saldo PostgreSQL testado resulta em `0`.
- [x] Um segundo cancelamento não cria novo reversal — novo command retorna `EVENT_ALREADY_CANCELLED`; retry do mesmo command retorna o mesmo read model.
- [x] Falha durante o cancelamento faz rollback completo — trigger PostgreSQL no insert do reversal entry deixa status, events, entries e command sem alteração parcial.
- [x] A decisão sobre correção de campos financeiros está refletida na API e nos testes — não há correction em S03; valor/conta/data/tipo não pertencem ao command e a boundary rejeita campos adicionais.

## Implementação e contrato de integração

- `TransactionsUseCases` mantém `createExpense`/`createIncome` de T05 e agora expõe `updateManualTransaction` e `cancelManualTransaction`; `TransactionsMaintenanceUseCasePort` é o port mínimo para os adapters de T08/T12. Os aliases `update`/`cancel` existem para adapters genéricos sem alterar o contrato serializável.
- `UpdateManualTransactionCommand` aceita somente `commandId`, `financialEventId`, `description?` e `categoryId?`; `categoryId: null` remove a categoria. O parser Zod é estrito e rejeita valor, conta, data, tipo, status, origem, entry ou reversal como `NON_EDITABLE_FIELD`.
- O update bloqueia o `FinancialEvent` no `household_id` resolvido, exige evento manual `POSTED`, relê e bloqueia a categoria selecionada, valida `ACTIVE`/tenant/tipo e atualiza somente descrição, categoria e `updated_at`. O valor e o entry nunca são tocados.
- `CancelManualTransactionCommand` aceita somente `commandId` e `financialEventId`. O use case reserva `transactions.cancel.manual` em `application_commands` com o ID do reversal, bloqueia o original, exige evento manual `POSTED` sem reversal, preserva o original e seu entry, cria `REVERSAL`/`SYSTEM`/`POSTED` com `reversal_of_event_id`, cria entry assinado oposto na mesma conta/data, muda o original para `CANCELLED` e retorna o read model com `reversal` identificável.
- Os dois writes usam uma única `db.transaction()` e a chave `(household_id, commandId)`: retry do mesmo payload reidrata o recurso, payload/operação divergente retorna `COMMAND_ID_REUSED`, e erros de domínio permanecem em `S03Result`. Falhas técnicas escapam para o adapter de T08 (`logS03TransactionOperation`/`reportS03UnexpectedError`).
- Para T12, use `updateManualTransaction(context, command)` e `cancelManualTransaction(context, command)` (ou os aliases `update`/`cancel`); após sucesso, o retorno contém o original e, no cancelamento, `reversal.id`, `amountCents`, `origin=SYSTEM`, `status=POSTED` e `occurredOn`. Não há ação de hard delete nem operação de correção financeira no S03.

## Verificações e evidências

- [x] `T07_INTEGRATION=1 ... npm test -- --run src/modules/transactions/maintenance.integration.test.ts --config vitest.integration.config.mts`: 4 testes passaram em PostgreSQL 16 descartável (edição/idempotência, cancelamento/neutralização, rollback e isolamento).
- [x] `T03_INTEGRATION=1 T04_INTEGRATION=1 T05_INTEGRATION=1 T07_INTEGRATION=1 ... npm test -- --run` com as quatro suítes S03: 15 testes passaram.
- [x] `npm test`: 191 testes passaram; suítes PostgreSQL opcionais permaneceram puladas sem as flags de integração.
- [x] `npm run lint`: concluído sem warnings/erros.
- [x] `npm run typecheck`: concluído sem erros.
- [x] `npm run db:check:files`: concluído sem divergências; T07 reutiliza a relation/index de reversal entregues por T03 e não adiciona migration.
