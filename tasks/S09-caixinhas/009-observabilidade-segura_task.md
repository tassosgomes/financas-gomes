# T09 — Observabilidade segura

- Status: Concluída — extensão S09, reads T05, writes/Server Actions T06,
  movimentos/distribuição T07 e provider/serialização T08 estão observados por
  boundaries próprias com redaction vertical comprovada. A promoção de release
  continua condicionada aos gates externos registrados em T15.
- Onda: 1, transversal
- Dependências: T01 e infraestrutura de observabilidade S01
- Paralelização: Com todas as tasks do slice

## Objetivo

Operar falhas de Caixinhas e do provider sem transformar logs, breadcrumbs ou
Sentry em uma cópia da vida financeira do usuário.

## Escopo

- Instrumentar reads, writes, distribuição, cálculo derivado, provider S09 e
  serialização com operação, etapa, versão, duração, resultado categórico,
  contagens agregadas e request/correlation ID.
- Classificar validação, household ausente, Caixinha encerrada e configuração
  inválida como erros esperados; capturar exceções técnicas e invariantes
  quebradas com código técnico seguro.
- Aplicar allow-list e redaction: nunca enviar centavos, saldo, meta, nome,
  descrição, categoria, referência de movimento, payload, SQL, cookies,
  tokens ou Authorization.
- Medir consultas lentas e falhas de transaction sem interpolar parâmetros ou
  dados financeiros; preservar relançamento de exceção quando necessário.
- Diferenciar ausência de Caixinha/proteção zero de falha técnica no provider,
  sem mascarar indisponibilidade como saldo zero no diagnóstico.

## Subtarefas

- [x] Mapear pontos de instrumentação e códigos allow-listed para todas as
  boundaries T05–T08 e Server Actions.
  - [x] T05 foi mapeada: `createBudgetReadAccess` (`list/detail/history/
    movements`), `createBudgetReadUseCases` e aliases públicos em
    `src/modules/budgets/service.ts`; o adapter está composto no acesso
    público e as consultas internas estão em `src/modules/budgets/query.ts`.
  - [x] T06 foi mapeada e composta: `create/update/close` atravessam a
    transaction boundary observada em `src/modules/budgets/use-cases.ts`; o
    adapter de Server Actions em `src/modules/budgets/actions.ts` observa
    parse, contexto, port, resultado e revalidação. O wrapper só recebe
    contexto operacional allow-listed e gera a correlação no servidor.
  - [x] T07 movimentos/distribuição e seus Server Actions foram integrados nas
    boundaries `write`/`distribution`, sem transportar payload, valores ou
    referências; a correlação é gerada no servidor.
  - [x] T08/provider e sua serialização S08 agora usam wrappers S09 próprios:
    `readReserveSnapshot` em `budget.provider.read` e
    `serializeReserveSnapshot` em `budget.serialize`; a boundary recebe apenas
    contexto normalizado e os eventos carregam categorias/contagens seguras.
- [x] Reutilizar o sanitizador S08 e publicar contexto específico do S09 sem
  aceitar campos arbitrários.
  - [x] A extensão reconstrói um allow-list S09 antes de usar as pontes
    compartilhadas addBreadcrumbSafely/captureServerException; a revisão de
    propagação no pipeline Sentry compartilhado foi executada em T15, sem
    publicação externa não autorizada.
- [x] Criar wrappers de observabilidade para `Result` e exceptions técnicas —
  `withS09BudgetObservability` preserva `Result`/relança exceptions, classifica
  `expected_error` e captura somente falhas técnicas; provado pela suíte S09.
- [x] Publicar o adapter das boundaries T05 —
  `instrumentS09BudgetReadBoundary`/`instrumentS09BudgetReadAccess` criam
  `budget.read` por invocação, medem lentidão, preservam o `BudgetReadResult`
  e relançam exceptions sem inspecionar argumentos ou payload.
- [x] Adicionar testes que tentem vazar valores, nomes, refs, SQL e payload —
  15 testes em `src/modules/observability/s09.test.ts` e 3 testes T06 em
  `src/modules/budgets/observability-s09.test.ts`, mais 9 testes T07 em
  `src/modules/budgets/movement-observability-s09.test.ts`, cobrem contexto,
  log, breadcrumb, envelope, wrapper, adapter T05, Server Actions, transaction
  e medição lenta.
- [x] Auditar integrações do provider e writes antes do gate de release.
  - [x] T06 CRUD/lifecycle e Server Actions foram auditados e integrados na
    etapa `write`, com `BUDGET_TRANSACTION_FAILED` para exceção técnica e
    preservação do relançamento.
  - [x] T07 movimentos/distribuição e Server Actions foram auditados e
    integrados em `src/modules/budgets/movements.ts` e
    `src/modules/budgets/actions.ts`, com contagens agregadas bounded,
    `BUDGET_TRANSACTION_FAILED` na transaction boundary e preservação do
    relançamento.
  - [x] T08 provider/serialização usam wrappers próprios S09; a leitura
    funcional, os estados `NO_BOXES`/`ZERO_PROTECTION`/`UNAVAILABLE`, a
    serialização pública e as falhas técnicas foram auditados no fechamento
    T15, sem alterar a semântica financeira.

## Critérios de aceite

- [x] Falhas técnicas identificam operação/etapa/versão e request ID, mas não
  carregam qualquer dado financeiro cru — exceção técnica do provider é
  verificada em `s09.test.ts`; as falhas de transaction T06/T07 em
  `budgets/observability-s09.test.ts` e
  `budgets/movement-observability-s09.test.ts` preservam o relançamento sem
  vazamento.
- [x] Erros esperados não geram alerta técnico falso nem confundem ausência
  com R$ 0 no read model de produto. A parte S09 de não alertar Result esperado
  e distinguir NO_BOXES/ZERO_PROTECTION/UNAVAILABLE está testada; a prova
  vertical T05/T08/T13 passou na matriz PostgreSQL e no E2E focado.
- [x] O sanitizador remove campos desconhecidos mesmo quando o caller tenta
  anexar objetos financeiros completos — `sanitizeS09BudgetLog` reconstrói
  operação/etapa/versões/regra e lê apenas contagens escalares allow-listed;
  redaction foi provada em `s09.test.ts`.

## Entregáveis e evidência esperada

- [x] Extensão S09 em `src/modules/observability` e integração nas boundaries.
  - [x] Extensão, allow-list, wrappers e adapter T05 estão em
    `src/modules/observability/s09.ts`; o caller T05 já compõe o adapter no
    acesso público.
  - [x] T06 compõe o wrapper S09 na transaction boundary de CRUD/lifecycle e
    na boundary dos Server Actions, sem enviar command, payload ou DTO
    financeiro ao emissor.
  - [x] T07 compõe o wrapper S09 nas transaction boundaries dos movimentos e
    distribuição e em seus Server Actions; somente contagens bounded e
    códigos técnicos allow-listed chegam ao emissor.
  - [x] T08/provider e serialização possuem boundaries observáveis próprias de
    T09 em `src/modules/spendable/reserve-adapter.ts`; somente metadados
    categóricos e contagens bounded chegam ao emissor.
- [x] Testes focados de classificação, redaction, correlação e lentidão.
- [x] Revisão estática dos eventos emitidos e evidência para T15; nenhum campo
  financeiro aparece no emissor S09, e os únicos sinks são o logger seguro e
  as pontes sanitizadas de breadcrumb/Sentry.

## Fora de escopo

Publicar dados em Sentry de produção sem autorização, tracing distribuído,
rate limiting preventivo ou dashboard de BI.

## Implementação e evidências atuais

- [x] `src/modules/observability/s09.ts` define o contrato fechado S09 (`s09.v1`),
  operações/etapas de read/write/distribution/derived/provider/serialization,
  resultado categórico, contagens bounded, correlação, classificação, envelope,
  wrapper de `Result`/exception, adapter de read T05, medição de lentidão sem
  payload e marcação segura de falha transacional.
- [x] `readReserveSnapshot` e `serializeReserveSnapshot` em
  `src/modules/spendable/reserve-adapter.ts` compõem os wrappers S09 próprios
  de provider/serialização. Os resumos derivados publicam somente
  `NO_BOXES`/`ZERO_PROTECTION`/`PROTECTED`/`CLOSED`/`UNAVAILABLE`, status do
  provider e contagens bounded; retornos e exceções originais são preservados.
- [x] `src/modules/observability/index.ts` exporta somente a extensão S09
  necessária para os consumidores.
- [x] `rtk npm exec vitest -- run src/modules/observability/s09.test.ts
  --reporter=dot` — 15 testes passaram em 2026-09-03.
- [x] `rtk npm exec vitest -- run
  src/modules/spendable/reserve-observability-s09.test.ts
  src/modules/spendable/reserve-adapter.test.ts
  src/modules/budgets/reserve-source.test.ts --reporter=dot
  --maxWorkers=1 --minWorkers=1` — 22 testes passaram em 2026-09-03,
  incluindo provider disponível/sem Caixinhas/indisponível, erro técnico,
  serialização síncrona e redaction de valores, nomes, refs e payload.
- [x] `rtk npm exec vitest -- run src/modules/budgets/observability-s09.test.ts
  --reporter=dot --maxWorkers=1 --minWorkers=1` — 3 testes passaram em
  2026-09-02, cobrindo Server Action, erro esperado e falha técnica de
  transaction sem vazamento.
- [x] `rtk npm exec vitest -- run
  src/modules/budgets/movement-observability-s09.test.ts --reporter=dot
  --maxWorkers=1 --minWorkers=1` — 9 testes T07 passaram em 2026-09-02,
  cobrindo as cinco operações, Server Actions, erro esperado, exceção técnica
  e falha de transaction sem payload financeiro.
- [x] `rtk npm exec vitest -- run src/modules/observability --reporter=dot`
  — 10 arquivos e 70 testes passaram em 2026-09-02; S06/S07/S08, T13 e o
  sanitizador compartilhado não regrediram.
- [x] A suíte unitária geral atual passou (122 arquivos, 779 testes; os testes
  PostgreSQL opt-in ficaram skipped), e a matriz de integração T05–T08/T13/T15
  passou no alvo PostgreSQL descartável; a falha anterior de fixture global foi
  corrigida com escopo tenant-only no teste T07.
- [x] `rtk npm exec vitest -- run src/modules/budgets/reads.test.ts
  --reporter=dot` — 1 arquivo e 7 testes T05 passaram em 2026-09-02; a
  compatibilidade do adapter com o formato `BudgetReadResult` também está
  coberta em `s09.test.ts`.
- [x] `rtk npm exec eslint -- src/modules/observability/s09.ts
  src/modules/observability/s09.test.ts src/modules/observability/index.ts
  src/modules/budgets/use-cases.ts src/modules/budgets/actions.ts
  src/modules/budgets/movements.ts
  src/modules/budgets/observability-s09.test.ts
  src/modules/budgets/movement-observability-s09.test.ts --max-warnings=0` —
  sem erros/warnings em 2026-09-02.
- [x] `rtk npm exec tsc -- --noEmit --pretty false --incremental false` — passou
  em 2026-09-03 (exit 0) após correções localizadas somente nos testes
  externos; nenhum diagnóstico aponta para os arquivos T09/T06.
- [x] `rtk git diff --check` — sem whitespace errors em 2026-09-02.
- [x] T05 possui boundaries de leitura publicadas e compostas; `rg` localizou
  `createBudgetReadAccess`/`createBudgetReadUseCases`/aliases em
  `src/modules/budgets/service.ts`, as queries em `src/modules/budgets/query.ts`
  e `instrumentS09BudgetReadAccess` no acesso público.
- [x] T06 possui integração comprovada em
  `src/modules/budgets/use-cases.ts` e `src/modules/budgets/actions.ts`:
  `budget.write`/`write`, correlação gerada no servidor, duração e códigos
  allow-listed; `src/app/actions/budgets.ts` permanece uma camada fina que
  chama esses handlers, sem lógica ou dados adicionais.
- [x] T07 possui integração comprovada em
  `src/modules/budgets/movements.ts` e `src/modules/budgets/actions.ts`:
  movimentos usam `budget.write`, distribuição usa `budget.distribution`, a
  transaction é medida com `BUDGET_TRANSACTION_FAILED`, a correlação nasce no
  servidor e os eventos não recebem command, payload, valores ou referências.
- [x] T08/provider usa wrappers S09 próprios de provider/serialização em
  `readReserveSnapshot`/`serializeReserveSnapshot`; a boundary funcional do S08,
  redaction, estados categóricos e preservação de retorno/exceção foram
  auditados, sem inventar eventos, IDs, valores ou referências.
- [x] Auditoria final de writes/provider/Server Actions e gate T15 executada;
  o typecheck global está verde e o gate de promoção continua condicionado às
  regressões externas documentadas em T15.

## Arquivos deste write set

- `src/modules/observability/s09.ts`
- `src/modules/observability/s09.test.ts`
- `src/modules/observability/index.ts`
- `src/modules/budgets/use-cases.ts`
- `src/modules/budgets/actions.ts`
- `src/modules/budgets/observability-s09.test.ts`
- `src/modules/budgets/movements.ts`
- `src/modules/budgets/movement-observability-s09.test.ts`
- `src/modules/spendable/reserve-adapter.ts` (wrappers provider/serialização)
- `src/modules/spendable/reserve-observability-s09.test.ts`
- `src/app/actions/budgets.ts` (auditoria da camada fina; sem mudança de regra)
- `tasks/S09-caixinhas/009-observabilidade-segura_task.md`

## Handoff

- T05 — [x] `instrumentS09BudgetReadAccess` já está composto no acesso público,
  fornecendo somente contagens, resultado categórico, duração e request ID;
  ausência permanece opaca.
- T06 — [x] CRUD/close atravessa `write` com códigos estáveis como
  `BUDGET_CLOSED`/`BUDGET_NOT_FOUND`; nome, categoria, command e payload não
  entram na telemetria. A correlação é gerada/revalidada server-side, e as
  Server Actions permanecem finas e serializáveis.
- T07 — [x] movimentos/distribuição atravessam `write`/`distribution`, com
  somente contagens bounded e `transactionFailed`; referências, valores e
  payloads ficam fora da telemetria. Server Actions compartilham a mesma
  allow-list e preservam Result/exception.
- T08 — [x] leitura/serialização do provider envolvidas nas etapas `provider`/
  `serialization`; `NO_BOXES`/`ZERO_PROTECTION`/`PROTECTED`/`CLOSED` são
  distintos de `UNAVAILABLE`, e falhas técnicas usam
  `BUDGET_PROVIDER_FAILED`/`BUDGET_SERIALIZATION_FAILED` sem mascarar
  indisponibilidade como zero.
- T15/release — [x] revisar todos os eventos publicados, integração vertical e
  os gates T13/T14 foi executado nesta auditoria; a promoção de T09 continua
  condicionada somente aos gates externos de release registrados em T15.
