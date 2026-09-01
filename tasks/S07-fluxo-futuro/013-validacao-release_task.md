# T13 — Validação de release e handoff

- Slice: S07 — Fluxo futuro
- Status: Concluída — gates de release verdes e handoff S08/S10 aprovado; nenhuma implementação ou migration adicional foi alterada por T13.
- Onda: 4
- Dependências: T06, T07, T10, T11 e T12
- Paralelização: Não; fechamento serial

## Objetivo

Validar que o slice está pronto para entrega e que S08/S10 podem consumir o contrato sem reproduzir o cálculo.

## Escopo

- Executar lint, typecheck, unitários, integração PostgreSQL, build e E2E; validar migrations no fluxo controlado de deploy.
- Revisar observabilidade, privacidade, plano de query, erros, acessibilidade e compatibilidade server-first.
- Registrar contrato versionado, exemplos e limitações para S08 (saldo/timeline) e S10 (visualização consolidada), sem antecipar suas regras.
- Auditar Definition of Done de S07 e evidências reproduzíveis.

## Critérios de aceite

- [x] Os critérios funcionais, cenários de teste e requisitos de observabilidade de `docs/S07-fluxo-futuro.md` possuem evidência em T01–T12, na matriz de T11, nos testes de T07, nos sete cenários E2E de T12 e no `EXPLAIN` controlado registrado em T06. Os gates globais e as repetições PostgreSQL/E2E passaram.
- [x] S08 consegue consumir a projeção sem nova query de parcelas/recorrências nem dupla contagem: `ForecastTimeline`/`ForecastPeriodTotals` públicos e `minimumProjectedBalanceCents` estão versionados em ADR-008; `sources.ts` lê as fontes e T04/T05 normalizam uma vez, sem persistir saldo/timeline. O handoff de S10 também está registrado sem implementar regras de S08/S10.
- [x] Não há migration automática no start, float, `Date` em regra financeira, acesso client-side ao banco ou dado financeiro em telemetria: o fluxo de boot/Docker não chama `migrate()`, o engine/recorrência usam `Temporal.PlainDate` e centavos inteiros, o client de forecast recebe somente o read model e `s07.test.ts` confirma allow-list/redaction. `Date` restante está restrito a timestamps técnicos de persistência.

## Verificações

- Registrar comandos/resultados, smoke autenticado e `rtk git diff --check`.
- Conferir DoD contra PRD §§4.5, 6–11 e TechSpec §§42–57, 93, 110, 112 e 116.

## Fora de escopo

Deploy sem aprovação, implementação de S08/S10 ou expansão de escopo por correções não relacionadas.
## Subtarefas

- [x] Auditar as evidências e os critérios de aceite T01–T12 — T01–T12 foram conferidas, incluindo a correção UUIDv7 de T10 confirmada no E2E de recorrência; ADR-008 e os contratos S07/S08/S10 foram revisados.
- [x] Executar gates de release e revisar riscos técnicos remanescentes — lint, typecheck, build, unitários, PostgreSQL, migrations, `EXPLAIN` e E2E passaram; não restou risco técnico bloqueante no escopo de T13.
- [x] Validar handoff S08/S10 e registrar decisão de release — handoff versionado, server-side/tenant-safe e sem dupla contagem confirmado; T13 aprovada para release, sem executar deploy de produção.

## Evidências executadas (2026-08-31)

- [x] `rtk npm run lint` — passou sem warnings (`--max-warnings=0`).
- [x] `rtk npm run typecheck` — passou sem diagnósticos TypeScript.
- [x] `rtk npm run build` — `next build` compilou, validou tipos/lint, gerou as páginas estáticas e concluiu com exit 0.
- [x] `rtk npm test -- --reporter=dot` — 83 arquivos/539 testes passaram; 29 arquivos/109 testes opt-in foram ignorados sem flag.
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm run test:integration` — 27 arquivos/101 testes passaram; 2 arquivos/8 testes opt-in foram ignorados.
- [x] `rtk npm run db:check`, `rtk npm run db:check:files`, `rtk ... npm run db:migrate:status` e `rtk ... npm run db:migrate:deploy` — schema consistente; 17 migrations aplicadas, 0 pendentes e 0 divergentes; deploy controlado de teste passou sem alterações pendentes.
- [x] `rtk proxy npx playwright test tests/e2e/forecast.spec.ts --reporter=line` — 7/7 cenários passaram, incluindo isolamento de `householdId`, navegação dezembro→janeiro, mês vazio, parcelas/cancelamento, estado de carregamento e as jornadas dependentes de T10.
- [x] `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)` controlado de T06 — volume sintético multi-tenant, transação com rollback e `ANALYZE`; sete leituras de forecast passaram sem N+1/temp spill, pior caso 32.421 ms, abaixo do alerta de 250 ms e do orçamento de 2.000 ms.
- [x] Auditoria de contrato/handoff — ADR-008 `s07.v1`, fontes e deduplicação, migrations DATE/bigint/FKs compostas, limites de precisão/data, allow-list/redaction de telemetria e fronteira server/client foram conferidos; S08 consome `ForecastTimeline`/`minimumProjectedBalanceCents` e S10 estende o read model sem reconsultar/recalcular S07.
- [x] `rtk git diff --check` — sem saída.

## Decisão de release

Todos os gates obrigatórios do CI/TechSpec e os critérios de aceite de T13 têm
evidência verde. T13 está concluída e o handoff para S08/S10 está liberado;
deploy de produção permanece fora do escopo e não foi executado.
