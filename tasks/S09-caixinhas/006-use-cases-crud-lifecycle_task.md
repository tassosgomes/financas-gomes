# T06 — CRUD e ciclo de vida da Caixinha

- Status: Concluída
- Onda: 2
- Dependências: T03, T04 e T05
- Paralelização: Com acabamento de T07, T08, T09 e T13

## Objetivo

Entregar os commands de criação, edição e encerramento, preservando a vigência
e o histórico da Caixinha.

## Escopo

- Implementar `CreateBudget`/`CreateBox`, edição de metadados e
  `CloseBudget`/`CloseBox` conforme o vocabulário fechado em T01.
- Validar nome, categoria, meta, data-alvo, `activeFrom`, `closedOn`, status e
  unicidade de Caixinha ativa antes de gravar.
- Permitir reconfiguração futura sem reinterpretar movimentos ou gastos
  históricos; se reabertura for necessária, usar transição explicitamente
  versionada, não mutação silenciosa do passado.
- Executar cada write em uma transaction com `application_commands`,
  `commandId`, hash de payload e resultado idempotente.
- Resolver `FinancialContext` no servidor e nunca aceitar `householdId` como
  autoridade do input; retornar erros esperados com códigos estáveis.
- Revalidar as páginas de Caixinhas, detalhe, dashboard e Spendable após
  sucesso, sem recalcular saldo na Server Action.

## Subtarefas

### Contratos e validação

- [x] Definir schemas Zod de command e mapeamento para o domínio de T02/T04.
  Evidência: `contracts.ts` publica schemas strict para create/update/close;
  `use-cases.ts` expõe parsers que convertem falhas Zod em códigos de domínio
  estáveis e normaliza nome, command ID, datas e meta antes da persistência.
- [x] Definir códigos estáveis, envelopes serializáveis de sucesso/erro e
  normalização server-side.
  Evidência: `BudgetDomainError`, `BudgetResult`, `budgetFailure` e
  `BudgetBoundary` são usados pela camada de aplicação; o resultado persistido
  é validado novamente pelo schema antes de ser devolvido num retry.

### Persistência e ciclo de vida

- [x] Implementar use cases e repositories com transaction boundary única.
  Evidência: `createBudgetUseCases` executa create/update/close numa única
  `database.transaction`; helpers tenant-scoped de claim, leitura bloqueada,
  persistência e conclusão de command ficam dentro da mesma transação.
- [x] Implementar proteção contra retry e contra reutilização de command ID
  com payload diferente.
  Evidência: `(household_id, commandId)` é reivindicado com hash canônico e o
  `result` serializável é gravado em `application_commands`; retry retorna o
  mesmo resultado e hash/operação diferentes retornam `COMMAND_ID_REUSED`.
- [x] Implementar encerramento efetivo e consulta histórica sem hard delete.
  Evidência: close faz transição `ACTIVE → CLOSED`, preserva `closedOn`,
  referências e a linha; não há comando de delete. A migration T03 reforça
  `RESTRICT`/append-only e o teste T06 confirma a linha encerrada preservada.

### Integração server-side

- [x] Criar actions finas em `src/app/actions/` e contratos de resultado para
  a UI de T11.
  Evidência: `src/app/actions/budgets.ts` expõe somente wrappers assíncronos
  serializáveis para create/update/close e aliases Box.
- [x] Resolver `FinancialContext` pela sessão e revalidar as rotas exigidas,
  sem transportar regra de negócio para a action.
  Evidência: `getBudgetActionHandlers` usa `requireFinancialContext`; a action
  revalida `/budgets`, detalhe, `/app`, `/spendable` e breakdown após sucesso,
  enquanto SQL e regras permanecem no use-case.

### Verificação

- [x] Cobrir validação, isolamento, concorrência necessária e rollback.
  Evidência: `actions.test.ts` tem 5 testes de boundary/contexto e
  `use-cases.test.ts` tem 3 testes de parsing; o teste PostgreSQL T06 tem 5
  testes cobrindo validação, claims transacionais,
  idempotência, retry após edição posterior, isolamento, close, overlap,
  rollback sem claim e create concorrente (um sucesso, um conflito).
- [x] Executar testes focados, typecheck, ESLint focado, `git diff --check` e
  PostgreSQL opt-in quando disponível.
  Evidência: testes de `src/modules/budgets` passaram `48/48` (7 opt-in
  skipped sem flag); `T06_INTEGRATION=1` no PostgreSQL dedicado
  `financas_gomes_t06_final` passou `5/5`; `tsconfig.t06` transitório passou
  typecheck focado; ESLint direcionado passou; `git diff --check` e auditoria
  de whitespace dos arquivos T06 passaram. O typecheck global foi reexecutado
  em 2026-09-03 e passou com exit 0 após correções somente nos dois testes de
  componentes fora do write set T06.

## Critérios de aceite

- [x] Criar/editar/encerrar é atômico e idempotente; retry não duplica
  Caixinha nem altera a resposta de uma operação já aplicada.
- [x] Caixinha usada não é apagada e sua data de encerramento não elimina
  movimentos ou explicações históricas.
- [x] Categoria/household inválido, meta negativa, data impossível e
  sobreposição proibida são rejeitados no servidor.
- [x] Nenhuma action contém regra de saldo, SQL espalhado ou confiança em
  IDs/valores vindos do browser.

Evidência dos critérios: `use-cases.integration.test.ts` valida retry com
resultado persistido, conflito de categoria/household, categoria arquivada e
de receita, meta inválida, vigência adjacente/sobreposta, fechamento efetivo e
concorrência; o adapter rejeita `householdId` forjado antes de resolver o
contexto. A action não calcula saldo, não acessa SQL e recebe apenas comandos
strict; a posição continua sendo responsabilidade dos reads T05.

## Entregáveis e evidência esperada

- [x] `src/modules/budgets/use-cases.ts`/`application.ts` com CRUD/lifecycle.
- [x] Actions server-side e contratos Zod/result.
- [x] Testes de boundary, idempotência, rollback e tenant isolation.
- [x] Lint, typecheck e `git diff --check` focados.

## Evidências executadas — 2026-09-02

- `rtk npm exec vitest -- run src/modules/budgets --config vitest.config.mts
  --reporter=dot`: 6 arquivos unitários aprovados, `48/48` testes; os dois
  arquivos de integração de budgets ficaram skipped sem opt-in.
- `rtk env DATABASE_URL=postgresql://postgres:postgres@localhost:5433/financas_gomes_t06_final T06_INTEGRATION=1 npm exec vitest -- run src/modules/budgets/use-cases.integration.test.ts --config vitest.integration.config.mts --reporter=dot`:
  `5/5` testes PostgreSQL aprovados, incluindo concorrência e rollback.
- `rtk npm exec vitest -- run src/modules/budgets/actions.test.ts
  --config vitest.config.mts --reporter=dot`: `5/5` testes de boundary.
- `rtk npm exec eslint -- src/modules/budgets/use-cases.ts
  src/modules/budgets/actions.ts src/modules/budgets/routes.ts
  src/modules/budgets/application.ts src/modules/budgets/actions.test.ts
  src/modules/budgets/use-cases.integration.test.ts src/modules/budgets/index.ts
  src/app/actions/budgets.ts --max-warnings=0`: aprovado.
- `rtk npm exec tsc -- --project tsconfig.t06.json --pretty false` com
  configuração transitória restrita ao write set T06: aprovado (`ok`); o
  arquivo transitório foi removido após a verificação.
- `rtk git diff --check`: aprovado; `rtk rg -n "[[:blank:]]+$"` nos arquivos
  próprios: nenhuma linha com whitespace terminal.

## Handoff e limites

T06 não implementa aportes/retiradas/transferências (T07), provider S08
(T08), observabilidade transversal (T09), UI final (T11) ou alteração de
forecast. T07 deve reutilizar `budgetUseCases`, `BUDGET_COMMAND_OPERATIONS`,
os envelopes de erro e o padrão de claim/hash/result; movimentos continuam
append-only e a derivação de saldo permanece nos reads T05/T08.

## Fora de escopo

Aporte/retirada, provider S08, tela final e alteração da fonte de forecast.
