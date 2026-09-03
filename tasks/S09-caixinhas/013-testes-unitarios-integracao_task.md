# T13 — Testes unitários e integração PostgreSQL

- Status: Concluída — matriz unitária, UI e integrações PostgreSQL aplicáveis
  de T05–T08/T11/T12/T09 aprovadas em 2026-09-02; typecheck global passou em
  2026-09-03 após correções localizadas somente em testes externos; somente
  T14 E2E e T15 release permanecem gates downstream.
- Onda: 4
- Dependências: T02–T12 (T05/T06/T07/T08/T11/T12 concluídas; T09 auditada;
  T14/T15 permanecem fora deste fechamento)
- Paralelização: Incremental com T07/T08/T11/T12; concluída antes de T14

## Objetivo

Provar as invariantes de Caixinhas em domínio puro e PostgreSQL real, incluindo
tenant isolation, histórico, idempotência e integração com Spendable.

## Escopo

- Testar domínio: amount/PlainDate, saldo derivado, rollover, múltiplos
  aportes/retiradas, saldo negativo, encerramento, progresso e meta.
- Testar vigência/alocação: regra futura, distribuição exata, remainder,
  receita realizada, despesa por categoria, compra parcelada pelo total,
  refund pela data efetiva e não dupla contagem.
- Testar PostgreSQL real: constraints, FKs compostas, unicidade de referências,
  categoria ativa, migration, rollback, transaction boundaries e deletes
  restritos.
- Testar commands: idempotência, payload diferente, concorrência necessária,
  transferência atômica e correção compensatória.
- Testar readers: lista/detalhe/histórico, cutoff, rollover, `closedOn`,
  paginação e isolamento entre dois households.
- Testar provider S09/S08 com os cinco cenários do handoff e classes
  `GENERAL`/`RESTRICTED`/`EXCLUDED`.
- Testar redaction/classificação de T09 e garantir que nenhum teste dependa de
  logs com valores financeiros.

## Subtarefas

- [x] Reutilizar fixtures de T02/T04 e criar o manifest de casos do S09 em
  `tests/fixtures/s09-caixinhas`; o domínio não foi duplicado.
- [x] Implementar testes unitários sem banco para as regras determinísticas
  disponíveis em T02/T04/T05/T06/T07/T08/T09: saldo assinado, cutoff/rollover,
  encerramento, progresso, distribuição/remainder, idempotência, compra/refund
  sem dupla contagem, mapping/provider `s09.v1`, isolamento de contexto e
  redaction/classificação.
- [x] Implementar suíte opt-in com PostgreSQL descartável para os limites já
  disponíveis de T03: migration/catalog, ausência de saldo/snapshot, FKs
  compostas e isolamento estrutural, delete restrito e rollback atômico de
  budget/movimento/regra.
- [x] Adicionar regressão para não persistência de `balance`/snapshot, boundary
  serializável de domínio/contexto observável e contrato `s09.v1` do adapter.
- [x] Completar a cobertura de reads T05, writes/Server Actions T06,
  observabilidade T09, movimentos persistidos T07, provider/Spendable final
  T08 e as jornadas UI de T11/T12. As verticais PostgreSQL usam as boundaries
  publicadas e os testes não alteram a semântica de negócio.
- [x] Executar a matriz agregada e cada suíte PostgreSQL aplicável com seus
  flags de integração; todos os gates até T12 ficaram verdes. E2E/T14 e
  release/T15 não foram executados por serem gates downstream explícitos.

## Critérios de aceite

- [x] A cobertura não usa comparação monetária com float: domínio, reads,
  writes, movimentos e provider usam `Money`/`bigint` e resultados serializados
  em centavos.
- [x] O isolamento cross-tenant é provado com PostgreSQL real nos reads T05,
  CRUD T06, FKs compostas e provider vertical T08/T11; a UI T11/T12 também
  não recebe autoridade de household.
- [x] Falhas no meio do schema/CRUD e nas transações de movimentos cobertas não
  deixam linhas parciais; rollback de movimentos, transferências e distribuição
  está verde na vertical T07.
- [x] Os cinco cenários do handoff S08 → S09 passam com referências
  deduplicadas e sem dupla contagem de compra/parcela/pagamento/despesa; T07
  publica as referências e T08 as reconcilia no provider final.
- [x] A suíte de observabilidade prova ausência de centavos, saldos, nomes,
  descrições, referências, SQL, cookies e tokens nos eventos cobertos por T09,
  incluindo writes e Server Actions de movimentos.

## Entregáveis e evidência esperada

- [x] Testes próprios em `src/modules/budgets`, `src/db`,
  `src/modules/spendable`, `src/modules/observability` e UI, cobrindo T05/T06,
  T07/T08/T09/T11/T12 com unitários, interação e PostgreSQL vertical.
- [x] Fixtures/manifests em `tests/fixtures/s09-caixinhas`.
- [x] Comandos, contagem de testes, flags de PostgreSQL, lint, typecheck e
  `git diff --check` registrados com resultado atual, incluindo limitações.

## Evidências finais — 2026-09-02

### Arquivos próprios desta etapa

- [`tests/fixtures/s09-caixinhas/manifest.json`](../../tests/fixtures/s09-caixinhas/manifest.json)
- [`tests/fixtures/s09-caixinhas/postgres-fixtures.json`](../../tests/fixtures/s09-caixinhas/postgres-fixtures.json)
- [`tests/fixtures/s09-caixinhas/README.md`](../../tests/fixtures/s09-caixinhas/README.md)
- [`src/modules/budgets/t13-domain-allocation.test.ts`](../../src/modules/budgets/t13-domain-allocation.test.ts)
- [`src/modules/budgets/reads.test.ts`](../../src/modules/budgets/reads.test.ts)
- [`src/modules/budgets/reads.integration.test.ts`](../../src/modules/budgets/reads.integration.test.ts)
- [`src/modules/budgets/use-cases.test.ts`](../../src/modules/budgets/use-cases.test.ts)
- [`src/modules/budgets/use-cases.integration.test.ts`](../../src/modules/budgets/use-cases.integration.test.ts)
- [`src/modules/budgets/actions.test.ts`](../../src/modules/budgets/actions.test.ts)
- [`src/modules/budgets/observability-s09.test.ts`](../../src/modules/budgets/observability-s09.test.ts)
- [`src/modules/budgets/movement-actions.test.ts`](../../src/modules/budgets/movement-actions.test.ts)
- [`src/modules/budgets/movement-observability-s09.test.ts`](../../src/modules/budgets/movement-observability-s09.test.ts)
- [`src/modules/budgets/movements.integration.test.ts`](../../src/modules/budgets/movements.integration.test.ts)
- [`src/modules/budgets/reserve-source.test.ts`](../../src/modules/budgets/reserve-source.test.ts)
- [`src/modules/spendable/reserve-adapter.test.ts`](../../src/modules/spendable/reserve-adapter.test.ts)
- [`src/modules/spendable/service.test.ts`](../../src/modules/spendable/service.test.ts)
- [`src/modules/spendable/t07-breakdown.test.ts`](../../src/modules/spendable/t07-breakdown.test.ts)
- [`src/modules/spendable/t08.integration.test.ts`](../../src/modules/spendable/t08.integration.test.ts)
- [`src/modules/spendable/t11.test.ts`](../../src/modules/spendable/t11.test.ts)
- [`src/modules/spendable/t11.integration.test.ts`](../../src/modules/spendable/t11.integration.test.ts)
- [`src/db/t13-budgets.integration.test.ts`](../../src/db/t13-budgets.integration.test.ts)
- [`src/modules/observability/t13-s09-redaction.test.ts`](../../src/modules/observability/t13-s09-redaction.test.ts)
- [`src/components/budgets`](../../src/components/budgets)
- [`src/app/budgets`](../../src/app/budgets)
- Esta task (`013-testes-unitarios-integracao_task.md`)

O manifesto referencia as fixtures executáveis de T02/T04/T07/T09; T07, T08,
T11 e T12 já foram exercitados e somente T14/T15 permanecem em
`openGates`. A fixture de `movement-commands` é inventário consumível pelos
testes verticais de T07. Os valores financeiros no JSON são strings; somente
os testes PostgreSQL convertem valores para `bigint` no insert.

### Comandos e resultados

- [x] `rtk npm exec vitest -- run src/modules/budgets/t13-domain-allocation.test.ts src/modules/observability/t13-s09-redaction.test.ts --reporter=dot` — 2 arquivos, 8 testes passaram; o inventário inclui a fixture de T07 e o contrato de redaction sem duplicar domínio.
- [x] `rtk npm exec vitest -- run src/modules/budgets/reads.test.ts src/modules/budgets/use-cases.test.ts src/modules/budgets/actions.test.ts src/modules/budgets/observability-s09.test.ts src/modules/budgets/reserve-source.test.ts src/modules/spendable/reserve-adapter.test.ts src/modules/spendable/service.test.ts src/modules/observability/t13-s09-redaction.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` — 8 arquivos, 42 testes passaram nas boundaries T05/T06/T08-prep/T09.
- [x] `rtk npm exec vitest -- run src/modules/budgets src/modules/spendable src/modules/observability src/components/budgets src/app/budgets src/db/budgets-schema.test.ts --config vitest.config.mts --reporter=dot --maxWorkers=1 --minWorkers=1` — 40 arquivos passaram, 263 testes aprovados, 26 skipped e nenhum todo; os testes opt-in de PostgreSQL permanecem skipped sem flags.
- [x] `rtk npm exec vitest -- run src/components/budgets src/app/budgets src/modules/budgets/reads.test.ts src/modules/budgets/movement-actions.test.ts --config vitest.config.mts --reporter=dot --maxWorkers=1 --minWorkers=1` — 10 arquivos, 56 testes de UI/T05/T07 passaram, incluindo detalhe, movimentos, impacto `s09.v1`, foco, estados e revalidação de T11/T12.
- [x] `rtk env T05_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm exec vitest -- run --config vitest.integration.config.mts src/modules/budgets/reads.integration.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` — 1 arquivo, 2 reads tenant-safe T05 aprovados contra PostgreSQL descartável.
- [x] `rtk env T06_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_t06_final MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_t06_final npm exec vitest -- run --config vitest.integration.config.mts src/modules/budgets/use-cases.integration.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` — 1 arquivo, 5 testes de CRUD/lifecycle T06 aprovados contra PostgreSQL descartável.
- [x] `rtk env T07_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm exec vitest -- run --config vitest.integration.config.mts src/modules/budgets/movements.integration.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` — 1 arquivo, 6 testes de movimentos, transferência/distribuição, idempotência, lineage e rollback aprovados.
- [x] `rtk env T08_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm exec vitest -- run --config vitest.integration.config.mts src/modules/spendable/t08.integration.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` — 1 arquivo, 6 testes do provider persistido `s09.v1`, deduplicação, `GENERAL`/`RESTRICTED`/`EXCLUDED`, cutoff/encerramento e isolamento A/B aprovados.
- [x] `rtk env T11_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm exec vitest -- run --config vitest.integration.config.mts src/modules/spendable/t11.integration.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` — 1 arquivo, 5 testes da composição S08/T11 com provider persistido e isolamento de households aprovados.
- [x] `rtk env T13_INTEGRATION=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm exec vitest -- run --config vitest.integration.config.mts src/db/t13-budgets.integration.test.ts --reporter=dot` — PostgreSQL 16 descartável (`financas-gomes-test-db-1`, porta 5433) saudável; 1 arquivo, 4 testes passaram.
- [x] `rtk npm exec eslint -- src/modules/budgets/t13-domain-allocation.test.ts src/modules/budgets/reads.test.ts src/modules/budgets/reads.integration.test.ts src/modules/budgets/use-cases.test.ts src/modules/budgets/use-cases.integration.test.ts src/modules/budgets/actions.test.ts src/modules/budgets/observability-s09.test.ts src/modules/budgets/movement-actions.test.ts src/modules/budgets/movement-observability-s09.test.ts src/modules/budgets/movements.integration.test.ts src/modules/budgets/reserve-source.ts src/modules/budgets/reserve-source.test.ts src/modules/spendable/reserve-adapter.test.ts src/modules/spendable/service.test.ts src/modules/spendable/t07-breakdown.test.ts src/modules/spendable/t08.integration.test.ts src/modules/spendable/t11.test.ts src/modules/spendable/t11.integration.test.ts src/modules/observability/t13-s09-redaction.test.ts src/db/t13-budgets.integration.test.ts src/components/budgets src/app/budgets --max-warnings=0` — passou sem erros/warnings.
- [x] `rtk git diff --check` — passou; a auditoria de whitespace dos arquivos novos também não encontrou linhas inválidas.
- [x] `rtk npm exec tsc -- --noEmit --pretty false --incremental false` — passou
  em 2026-09-03 (exit 0) após correções localizadas somente nos testes
  externos; nenhum erro T13 restou.

O primeiro teardown PostgreSQL revelou e confirmou a guarda append-only de T03:
`DELETE` em `budget_movements` retorna `23514`. O teardown da fixture usa
`TRUNCATE` somente no banco descartável, sem relaxar a guarda; o teste de
delete restrito continua exercitando a operação normal. Não houve alteração de
produção, migration, testes de T02/T03/T04/T09 ou tasks alheias.

### Limitações e gates não promovidos

- T05/T06/T07/T08/T11/T12 estão publicados e suas suites focadas e verticais
  aplicáveis passaram; a matriz de T13 não altera suas regras de negócio.
- T12 foi validada como interação/read model (incluindo card/link de impacto e
  movimentos); a prova de fluxo browser completo continua deliberadamente em
  T14, sem promover teste de componente a E2E.
- O typecheck global passou em 2026-09-03 após correções localizadas somente nos
  testes externos; nenhum erro foi reportado nos arquivos de T13/T07/T08/T11/T12.
- T14 E2E e T15 release permanecem gates explícitos no manifesto e não foram
  executados nesta etapa.

### Handoff explícito

- **T05/T06:** reads tenant-safe, CRUD/lifecycle e Server Actions foram
  reexecutados com PostgreSQL; a matriz registra 2 reads e 5 testes de CRUD
  aprovados.
- **T07:** movimentos, transferências, correções, distribuição, idempotência,
  lineage e rollback persistidos foram reexecutados; a vertical registra 6
  testes aprovados.
- **T08:** o provider persistido `s09.v1` foi reexecutado contra PostgreSQL com
  6 testes aprovados, incluindo os cinco cenários do handoff, classes de
  recurso, cutoff/encerramento, deduplicação e isolamento.
- **T09:** manter o allow-list/redaction existente; a matriz inclui writes,
  Server Actions e falhas técnicas sem payload financeiro nos eventos.
- **T11/T12:** os testes de UI e a vertical T11 foram reexecutados; o detalhe
  usa somente DTOs/ação autenticada e o teste unitário de T11 consome o
  snapshot disponível sem duplicar a fórmula do S08.
- **T14:** reutilizar `manifest.json` e somente os comandos de criação
  publicados por T06/T07 para o fluxo browser; os unitários e componentes de
  T13 não são E2E.
- **T15:** usar esta task como evidência da matriz unitária/integração; o
  typecheck global já está verde e os gates de release restantes estão
  registrados na validação final.

## Handoff

T14 reutiliza a matriz de dados e os comandos de criação permitidos pela UI;
T15 usa a suíte como gate de release, sem promover um teste unitário a prova
de fluxo E2E.
