# T01 — Contrato do slice e gate de dependências

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — contrato aprovado e gate S01/S02 verificado em 2026-08-29.
- Onda: 0
- Dependências: S01 e S02 concluídos
- Paralelização: Não; é o gate que desbloqueia as demais tasks

## Objetivo

Fechar as decisões que estão implícitas ou conflitantes entre PRD, TechSpec e S03 antes de criar schema, use cases e UI.

## Escopo

- Confirmar que S01 fornece `requireFinancialContext`, isolamento e geração de UUIDv7.
- Confirmar que S02 fornece contas/categorias com status ativo/inativo, `tracking_started_on` da conta e tenant consistente.
- Verificar se o ledger básico da TechSpec já existe. Se não existir, registrar que a T03 inclui sua fundação mínima.
- Formalizar o mapeamento, respeitando a ADR-001:
  - `transactions` como módulo/rota/UI;
  - `FinancialEvent` como fato econômico;
  - `AccountEntry` como efeito sobre a conta;
  - `Household/household_id` como nomenclatura canônica persistida; “Espaço financeiro” apenas na UI; `financial_space_id` não deve virar alias de banco.
- Definir o contrato mínimo do lançamento manual: tipo, valor, data, descrição, conta, categoria opcional, status `POSTED` e origem `MANUAL`.
- Definir a taxonomia de origem para eventos compensatórios (`MANUAL`, `SYSTEM` ou equivalente) sem confundir o evento original com o reversal.
- Confirmar regras: valor maior que zero, data não futura para lançamento `POSTED`, categoria do mesmo tipo e entidades do mesmo tenant.
- Confirmar que `accounts.tracking_started_on` existe após S02/Slice 1 ou decidir formalmente onde a extensão será entregue antes da T05.
- Formalizar a política de histórico:
  - edição direta de descrição/categoria;
  - nenhuma sobrescrita silenciosa de valor, conta, data ou tipo;
  - cancelamento sem hard delete, com efeito compensatório/reversal e histórico consultável.
- Definir o shape serializável dos commands, códigos de erro esperados e comportamento de reuso de `commandId`.
- Registrar as decisões em ADR/decision record referenciado pelas tasks seguintes.

## Resultado do gate

O contrato normativo desta task está em [ADR-004 — Contrato da transação
manual do S03](../../docs/adr/004-s03-transacao-manual-contract.md). Ele
resolve a nomenclatura, a fonte de verdade, o contrato de escrita e a
política de histórico que T02–T15 devem consumir.

### Dependências confirmadas

- S01 fornece `requireFinancialContext()` server-only, retornando o
  `FinancialContext` validado (`userId` + `householdId`) a partir da sessão e
  da membership persistida; `withFinancialContext`/`assertFinancialContext`
  e as queries protegidas mantêm o isolamento por `household_id`. Evidências:
  [`context.ts`](../../src/modules/households/context.ts:164),
  [`tenant-scoped.ts`](../../src/modules/households/tenant-scoped.ts:13) e
  [`protected-resource.ts`](../../src/modules/households/protected-resource.ts:112).
- S01 fornece o gerador único de UUIDv7 em
  [`src/lib/uuidv7.ts`](../../src/lib/uuidv7.ts:153), reutilizável antes do
  `INSERT`, com testes automatizados.
- S02 fornece `accounts` e `categories` tenant-scoped, status persistido
  `ACTIVE | ARCHIVED` (não existe enum `INACTIVE`), `tracking_started_on`
  como `DATE NULL`, FKs para `households` e a tabela compartilhada
  `application_commands`. Evidências:
  [`accounts-categories-schema.ts`](../../src/db/accounts-categories-schema.ts:61)
  e [contrato do S02](../../tasks/S02-contas-categorias/01-contrato-do-slice_task.md:5).
- O ledger básico ainda não está implementado no schema/migrations/módulos do
  repositório. T03 é, portanto, responsável pela fundação mínima de
  `financial_events` + `account_entries`, relação de reversal, constraints e
  índices; não deve criar tabela `transactions` nem `accounts.balance`.

### Contrato fechado

- `transactions` é somente o módulo/rota/UI; a fonte persistida é
  `financial_events` (`FinancialEvent`, fato econômico) + `account_entries`
  (`AccountEntry`, efeito assinado sobre a conta).
- `Household`/`households`/`household_id` é a nomenclatura canônica. “Espaço
  financeiro” fica restrito à UI; `financial_space_id` e aliases de banco são
  proibidos.
- `CreateExpense` e `CreateIncome` recebem somente
  `commandId`, `amountCents` (string de centavos), `occurredOn` (`YYYY-MM-DD`),
  `description`, `accountId` e `categoryId` opcional/null. O tipo da operação
  fixa `EXPENSE` ou `INCOME`; o servidor define `POSTED`, `origin=MANUAL`, o
  tenant e o sinal do entry.
- `FinancialEvent.amount_cents` é positivo/absoluto; o entry de despesa é
  negativo e o de receita positivo. A data `POSTED` não pode ser futura e,
  quando preenchida, não pode preceder `accounts.tracking_started_on`.
  Categoria informada deve ser `ACTIVE`, do mesmo tenant e do mesmo tipo do
  evento; conta deve ser `ACTIVE` e do tenant resolvido.
- A taxonomia separa fato e produtor: lançamento original = seu tipo
  (`EXPENSE`/`INCOME`) + `origin=MANUAL`; cancelamento = novo evento
  `kind=REVERSAL`, `origin=SYSTEM`, `status=POSTED`, relacionado pelo
  `reversal_of_event_id`. O original muda para `CANCELLED`, mas o evento e o
  entry original permanecem consultáveis; o entry do reversal possui sinal
  oposto e neutraliza o saldo. Não há hard delete.
- T07 implementará apenas `UpdateManualTransaction` para descrição e
  categoria (incluindo `categoryId: null`) e `CancelManualTransaction` com
  reversal atômico. Valor, conta, data e tipo não são sobrescritos nem
  corrigidos atomicamente em S03; exigem futura correção explícita ou
  cancelar-e-lançar novamente.
- Writes retornam `Result<T, E>`, usam commands serializáveis e uma única
  transaction PostgreSQL. `application_commands` registra as operações
  `transactions.create.expense`, `transactions.create.income`,
  `transactions.update.manual` e `transactions.cancel.manual`; o mesmo
  `(household_id, commandId)` com operação/payload canônicos repete o mesmo
  resultado, e reuso incompatível retorna `COMMAND_ID_REUSED`.
- Códigos esperados incluem autenticação, validação de command/valor/data/
  descrição, conta/categoria/evento não encontrado (incluindo cross-tenant),
  `RESOURCE_ARCHIVED`, `TRACKING_START_DATE_VIOLATION`,
  `CATEGORY_KIND_MISMATCH`, `NON_EDITABLE_FIELD`, conflitos de estado e
  `COMMAND_ID_REUSED`; detalhes de banco não atravessam a boundary.

## Subtarefas concluídas

- [x] Confirmado o gate de S01: contexto financeiro server-side, isolamento
  por `household_id` e geração centralizada de UUIDv7.
- [x] Confirmado o gate de S02: `accounts`/`categories` tenant-scoped,
  estados `ACTIVE | ARCHIVED`, `tracking_started_on` nullable e
  `application_commands` reutilizável.
- [x] Verificada a lacuna do ledger na implementação atual e atribuída a
  fundação mínima de `financial_events`/`account_entries` à T03.
- [x] Resolvido o mapeamento `transactions` (módulo/UI) →
  `FinancialEvent` (fato) → `AccountEntry` (efeito), sem tabela paralela ou
  `accounts.balance`.
- [x] Fixada a nomenclatura canônica `Household`/`households`/
  `household_id`; “Espaço financeiro” ficou somente na UI e
  `financial_space_id` foi proibido como alias persistido.
- [x] Fechado o contrato mínimo de receita/despesa manual, com valor em
  centavos, data civil, descrição, conta obrigatória e categoria opcional.
- [x] Fechadas as regras de positividade, data não futura, âncora de
  `tracking_started_on`, tenant, conta/categoria ativa e compatibilidade de
  tipo da categoria.
- [x] Separadas as origens `MANUAL` e `SYSTEM`; reversal é um novo evento
  `REVERSAL` relacionado ao original, não uma mutação do fato original.
- [x] Formalizada a política de histórico: edição direta somente de
  descrição/categoria; cancelamento preserva evento/entries e neutraliza por
  reversal sem hard delete.
- [x] Definido que T07 cobre metadata update + cancelamento; correção atômica
  de valor, conta, data ou tipo fica fora do S03.
- [x] Definidos commands serializáveis, read model, códigos de erro e
  idempotência por `commandId` dentro do tenant.
- [x] Registradas as decisões no [ADR-004](../../docs/adr/004-s03-transacao-manual-contract.md),
  com handoff explícito para T02–T15.

## Critérios de aceite

- [x] Não há uso misturado de `transactions`, `FinancialEvent` e
  `financial_events` como fontes de verdade diferentes; o mapeamento único
  está no ADR-004.
- [x] O tenant canônico e seus nomes de tabela/coluna estão documentados.
- [x] `household_id` é usado de forma consistente com S01/S02 e a ADR-001.
- [x] Está explícito que somente descrição e categoria são editáveis no S03.
- [x] Cancelar um evento `POSTED` não remove o evento nem seu histórico;
  cria reversal compensatório e mantém os entries originais.
- [x] Está definido que T07 implementará metadata update e cancelamento,
  sem correção atômica de valor, conta, data ou tipo.
- [x] O gate de S01/S02 e a lacuna do ledger estão registrados, com T03 como
  dona da fundação mínima do ledger.
- [x] T02–T15 têm handoff, payloads, erros, invariantes e nomes estáveis no
  ADR-004, sem nova decisão estrutural necessária.

## Verificações

- [x] `npm test -- --run src/lib/uuidv7.test.ts
  src/modules/households/context.test.ts
  src/modules/households/protected-resource.test.ts
  src/modules/accounts-categories/validation.test.ts`: 89 testes passaram;
  3 testes de fixture de recurso protegido foram pulados por dependerem de
  integração opcional.
- [x] `npm test`: 126 testes passaram; 18 testes de integração foram pulados
  por dependerem de PostgreSQL/ambiente de integração opcional.
- [x] `npm run typecheck`: concluído sem erros.
- [x] `npm run db:check:files`: concluído; não há divergência detectada pelo
  Drizzle entre schema, journal e migrations existentes.
- [x] Busca estática em `src/` e `drizzle/` confirmou ausência de
  `financial_events`, `account_entries` e implementação do ledger; os
  artefatos de S01/S02 citados acima estão presentes.
- [!] `npm run db:migrate:status` não foi executável neste ambiente por falta
  de `MIGRATION_DATABASE_URL`/`DATABASE_URL`; a validação PostgreSQL real do
  S02 permanece registrada na task correspondente e a execução do ledger fica
  para T03/T15.

## Fora de escopo

Não implementar aqui cartões, transferências, parcelas, recorrências, importação, tags, distribuição de renda ou forecast.
