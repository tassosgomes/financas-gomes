# T02 — Domínio, saldo derivado e rollover

- Status: Concluída — domínio puro, saldo derivado, rollover, progresso e
  validações verificados em 2026-09-02.
- Onda: 1
- Dependências: T01
- Paralelização: Com T03, T04, T09 e T10

## Objetivo

Implementar as regras puras que representam uma Caixinha e derivam sua posição
em qualquer data, sem SQL, sessão, React ou saldo persistido.

## Escopo

- Criar tipos de domínio para Caixinha, movimento, saldo, vigência, meta,
  progresso e componente de reserva usando `Money`/`bigint` e
  `Temporal.PlainDate`.
- Validar nome, referências opacas, amount estritamente positivo, tipo de
  movimento, datas, relação movimento–Caixinha, duplicidade e encerramento.
- Derivar `balance(asOf) = contributions - withdrawals` e preservar saldo
  negativo; derivar `protectedAmount = max(balance, 0)` somente para a proteção
  global.
- Derivar saldo acumulado entre períodos, aporte/gasto do mês, progresso em
  relação ao alvo e valor faltante. Nenhum desses valores deve virar coluna de
  estado.
- Preservar ordenação determinística e identidade de cada movimento para que
  o provider possa deduplicar referências já refletidas pelo ledger/forecast.
- Modelar correção por movimento compensatório e transferência como par
  atômico de retirada/aporte, sem apagar ou editar silenciosamente um movimento
  financeiro já publicado.

## Subtarefas

- [x] Publicar contratos de domínio e boundary serializável conforme T01.
- [x] Implementar `deriveBoxBalance`/equivalente puro com cutoff inclusivo,
  `activeFrom` e `closedOn` efetivos.
- [x] Implementar rollover positivo e negativo e funções de progresso/alvo sem
  conversão para `number` monetário.
- [x] Implementar validações de movimento, transferência e correção, com
  erros de domínio estáveis.
- [x] Criar fixtures reutilizáveis com múltiplos aportes, retirada, saldo
  negativo, encerramento, virada de mês/ano e empates de datas.
- [x] Executar testes unitários focados e registrar a evidência.

## Critérios de aceite

- [x] A mesma coleção de movimentos em ordem diferente produz o mesmo saldo,
  componentes e ordem de referências.
- [x] A data de corte inclui movimentos efetivos em `asOf`, mas uma Caixinha
  encerrada deixa de proteger a partir de `closedOn`.
- [x] Saldo negativo é mantido no read model/histórico e sua proteção é zero.
- [x] Rollover não perde saldo não utilizado nem transforma saldo em limite
  mensal descartável.
- [x] Nenhuma função de domínio acessa banco, contexto de usuário, React,
  `Date`, `float` ou saldo armazenado.

## Entregáveis e evidência esperada

- [x] `src/modules/budgets/contracts.ts`, `domain.ts` e exports equivalentes
  com tipos de Caixinha e movimentos.
- [x] `src/modules/budgets/balance.ts`/equivalente com cálculo puro e testes.
- [x] Fixtures e matriz de testes do domínio para reutilização por T05, T07,
  T08 e T13.
- [x] `rtk npm exec vitest -- run src/modules/budgets` e typecheck/lint focados
  verdes, sem declarar cobertura de PostgreSQL nesta task.

## Handoff

T05 consumirá o cálculo puro a partir de leituras tenant-safe. T07 usará as
validações e a semântica de correção; T08 usará `protectedAmount`, saldo
assinado e referências sem reimplementar a regra.

## Evidências e fechamento (2026-09-02)

### Subtasks, critérios e entregáveis comprovados

As seis subtasks e os cinco critérios de aceite foram comprovados por
`src/modules/budgets/domain.test.ts`. A suíte prova boundary serializável,
nome/referência/amount/data, relação movimento–Caixinha, duplicidade e erros
estáveis; replay em ordem invertida; cutoff inclusivo, vigência e fechamento;
saldo assinado/proteção zero; rollover positivo/negativo e viradas de mês/ano;
progresso, faltante e sugestão com `bigint`; componente protegido; transferência
atômica e correção append-only.

Os contratos exportam somente strings/datas ISO na boundary e mantêm
`Money`/`bigint`/`Temporal.PlainDate` no domínio. A auditoria estática dos
artefatos não encontrou imports de banco/React, `Date` nativo, `float` ou
saldo persistido. Nenhum schema, query, command persistido, provider integrado,
observabilidade transversal ou UI foi criado por T02.

### Comandos e resultados

- [x] `rtk npm exec vitest -- run src/modules/budgets --reporter=dot` — 1
  arquivo e 15 testes passaram.
- [x] `rtk npm exec eslint -- src/modules/budgets --max-warnings=0` — passou
  sem erros ou warnings.
- [x] `rtk npm exec tsc -- --noEmit --pretty false` — passou.
- [x] `rtk git diff --check` — passou sem whitespace inválido.
- [x] `rtk rg -n '(^|[^A-Za-z])Date[[:space:]]*\\(|new[[:space:]]+Date|(^|[^A-Za-z])float([^A-Za-z]|$)|from "drizzle"|from "pg"|from "react"|persisted[[:space:]]+balance|balance[[:space:]]+persist' src/modules/budgets --glob '*.ts'` — exit 1 e sem
  matches; confirmou ausência de imports de banco/React, `Date` nativo,
  `float` e saldo armazenado. As únicas referências a `householdId` são
  opcionais e server-side no tipo interno de par, não atravessam
  `serializeBudget` nem a boundary pública.

### Arquivos alterados por T02

- [`src/modules/budgets/contracts.ts`](../../src/modules/budgets/contracts.ts)
- [`src/modules/budgets/domain.ts`](../../src/modules/budgets/domain.ts)
- [`src/modules/budgets/balance.ts`](../../src/modules/budgets/balance.ts)
- [`src/modules/budgets/fixtures.ts`](../../src/modules/budgets/fixtures.ts)
- [`src/modules/budgets/domain.test.ts`](../../src/modules/budgets/domain.test.ts)
- [`src/modules/budgets/index.ts`](../../src/modules/budgets/index.ts)
- Esta task (`002-dominio-saldo-rollover_task.md`)

### Handoff explícito

- **T04:** importar `Budget`, `BudgetMovement`, `BudgetGoal`, os contratos de
  boundary e as primitivas de data/amount; as regras de alocação devem
  permanecer em `allocation-rules.ts`, sem reimplementar saldo ou progresso.
- **T05:** usar `deriveBudgetBalance`/`deriveBoxBalance`,
  `deriveBudgetPeriodSummary`, `deriveMonthlyBudgetSummary`,
  `deriveBudgetProgress` e os serializers para compor reads tenant-safe;
  nenhum saldo deve ser persistido.
- **T07:** usar `normalizeBudgetMovement`,
  `assertBudgetCanReceiveMovement`, `createBudgetTransfer` e
  `correctBudgetMovement`; persistir o par/correção na própria transaction,
  preservando as referências e sem editar o movimento original.
- **T08:** usar `deriveBudgetReserveComponent` e os campos
  `protectedAmount`, `balance`, `movementReferenceIds` e
  `appliedMovementReferenceIds`; a proteção é zero para saldo negativo ou
  corte em/apos `closedOn`, e o provider deve continuar fora desta task.
- **T13:** reutilizar `budgetDomainFixtures`, a matriz de seis cenários e os
  testes puros; a evidência desta task é unitária e não promove cobertura
  PostgreSQL, isolamento de queries, provider integrado ou E2E.

### Gates posteriores não promovidos por T02

Permanecem pendentes, nos owners correspondentes, schema/migrations (T03),
regras de alocação e fontes econômicas (T04), reads tenant-safe (T05), CRUD e
movimentos persistidos (T06/T07), provider `s09.v1` integrado ao S08 (T08),
observabilidade/UI (T09–T12), PostgreSQL/E2E/release (T13–T15). Esses gates não
contradizem a conclusão do escopo puro da T02 e não foram falsamente marcados.
