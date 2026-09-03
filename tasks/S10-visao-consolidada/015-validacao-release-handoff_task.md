# T15 — Validação de release, DoD e handoff para S11

- Status: Auditoria local concluída; gates PostgreSQL/E2E pendentes de CI
- Onda: 4
- Dependências: T04, T09, T13, T14
- Paralelização: Não

## Objetivo

Fechar o slice com prova executada de cada critério de aceite do S10 e entregar
ao S11 um handoff explícito do que a home consome e do que ela expõe.

## Escopo

- Executar e registrar os gates: `npm run lint`, `npm run typecheck`,
  `npm test`, a suíte de integração opt-in, `npm run test:e2e`, `db:check` e
  `git diff --check`.
- Reconferir cada critério de aceite de `docs/S10-visao-consolidada.md` contra a
  evidência produzida por T02–T14, apontando o teste ou o comando que o prova.
- Confirmar que "quanto posso gastar" continua sendo exatamente o cálculo do
  S08 e que a home não introduziu nenhuma fórmula concorrente.
- Verificar a observabilidade em execução real: erro de agregação capturado,
  query lenta sinalizada e ausência de dado sensível nos logs.
- Registrar explicitamente os gates externos ainda abertos (por exemplo tasks
  pendentes do S09) e o que a home faz enquanto eles não fecham.
- Escrever o handoff S10 → S11 com as leituras usadas, os pontos de falha
  monitorados e o que a exportação/backup precisa considerar.
- Atualizar `tasks.md` e os status das tasks com evidência datada.

## Subtarefas

- [x] Executar todos os gates e colar a saída resumida na task.
- [x] Preencher a matriz critério → evidência.
- [x] Validar observabilidade com um erro provocado em ambiente local.
  - Provocado nos testes puros (`service.test.ts` força falha de forecast;
    `s10.test.ts` injeta centavos/SQL/tenancy e prova redaction). Não há
    processo Next+Postgres neste VM para Sentry ao vivo.
- [x] Escrever o handoff S10 → S11.
- [x] Atualizar índice e status das tasks do slice.

## Critérios de aceite

- [x] Todos os critérios de aceite do documento do S10 estão marcados com
  evidência rastreável, ou explicitamente reportados como não atendidos.
- [x] Nenhum gate é declarado aprovado sem comando e resultado registrados.
- [x] Falhas externas herdadas estão descritas com origem e não atribuídas ao
  S10.
- [x] O handoff descreve o contrato `s10.v1` e seus consumidores.
- [x] A Definition of Done do slice está integralmente avaliada.

## Entregáveis e evidência esperada

- [x] Seção de evidências datada nesta task.
- [x] Handoff S10 → S11 em `docs/` ou no ADR-013.
- [x] `tasks/S10-visao-consolidada/tasks.md` atualizado.

## Sequenciamento

- Bloqueado por: T04, T09, T13, T14.
- Desbloqueia: início efetivo do S11.
- Paralelizável: não.

## Fora de escopo

Implementar exportação, backup ou runbook — escopo do S11.

## Auditoria final e evidências — 2026-09-03

Ambiente do agente Cloud: Node 22, sem PostgreSQL cliente, sem Docker,
`DATABASE_URL` ausente. Gates que exigem banco ou browser autenticado não
foram promovidos; o job de CI correspondente é o gate.

### Gates executados neste ambiente

| Gate | Comando | Resultado |
| --- | --- | --- |
| Lint | `npm run lint` (`eslint . --max-warnings=0`) | **Passou** (exit 0, 2026-09-03) |
| Typecheck | `npm run typecheck` | **Passou** (exit 0) |
| Unitário | `npm test` | **Passou**: 133 arquivos, 884 testes; 40 arquivos / 157 testes skipped (integração opt-in) |
| `git diff --check` | `git diff --check` | **Passou** (sem whitespace error) |
| Migration files | `npm run db:check:files` | **Passou**: `Everything's fine` |
| `db:check` (Postgres) | `npm run db:check` | **Não promovido**: `Defina MIGRATION_DATABASE_URL ou DATABASE_URL` |
| Integração opt-in | `npm run test:integration` | **Não promovido**: sem Postgres. Specs S10 skipped sem `T10_INTEGRATION=1` + `DATABASE_URL` (`query.integration.test.ts` 5, `t09.integration.test.ts` 5, `service.integration.test.ts` 2) |
| E2E Playwright | `npm run test:e2e` | **Não promovido**: sem Postgres/Playwright webServer. Spec em `tests/e2e/overview.spec.ts` |
| EXPLAIN (ANALYZE) T09 | helper `explainPeriodAggregationQuery` | **Não promovido**: mesmo motivo; índices esperados já existentes (`financial_events_household_occurred_on_idx`, `financial_events_household_category_occurred_on_idx`); nenhuma migration S10 |

Gate de CI que cobre o restante: `.github/workflows/ci.yml` jobs
`migrations`, `integration` (`T10_INTEGRATION=1` já está em
`package.json` → `test:integration`) e `e2e`.

### Spendable = S08, sem fórmula concorrente

- `createDefaultOverviewPorts().readSpendable` chama `getSpendable` com
  `asOf`, `scenario` e `horizon: { days }` (default CONSERVATIVE / 90).
- `mapSpendableBlock` coloca `result.value` em `breakdown` sem transformar
  centavos.
- Prova: `composition.test.ts` → `returns spendable byte-for-byte from the
  origin without reformulation`; `service.test.ts` → `returns spendable
  breakdown byte-for-byte from the origin`.
- `/app` chama só `getOverviewAction()`; `/spendable/breakdown` continua
  chamando `getSpendableAction`. E2E compara o texto de
  `spendable-card-primary-value` entre as duas rotas.

### Observabilidade

Logs emitidos por `service.test.ts` neste run (stdout JSON) incluem apenas
contagens, `requestId`, `result` (`AVAILABLE`/`PARTIAL`), `durationMs` e
`contractVersion: s10.v1`. Exemplo de degradação parcial:

```text
{"event":"s10_overview_read_success","useCase":"overview.read","operation":"overview.read","stage":"read","contractVersion":"s10.v1","outcome":"success","groupCount":1,"itemCount":0,"alertCount":0,"originCount":4,"readyBlockCount":4,"errorBlockCount":2,"emptyBlockCount":2,"result":"PARTIAL"}
```

Redaction: `src/modules/observability/s10.test.ts` (13 testes) rejeita
centavos, SQL, nomes, `householdId`, `userId`, cookies e tokens.
Limiares: 500 ms slow-query, 2500 ms timeout por bloco
(`docs/observability-s10-overview.md`). Sentry ao vivo não foi exercitado
neste VM.

### Gates externos (não são falha do S10)

| Item | Estado | Efeito na home |
| --- | --- | --- |
| S09 | Entregue em `main` | Caixinhas `AVAILABLE` por padrão |
| Integração/E2E/db:check neste VM | Infra ausente | Home não muda; CI é o gate |
| EXPLAIN T09 | Pendente de Postgres | Índices reutilizados; sem cache V1 |
| Publicação/produção | Fora deste PR | Sem deploy |

Nenhuma falha de slice anterior foi mascarada.

### Matriz critério → evidência

| Critério (`docs/S10-visao-consolidada.md` / DoD) | Evidência |
| --- | --- |
| Totalizações reconciliam com detalhe | `aggregate.test.ts`, `service.test.ts` (grupos = total), `links.test.ts`, E2E spec drill-down |
| "Quanto posso gastar" = S08 | `composition.test.ts`, `service.test.ts`, `ports.ts` → `getSpendable`; UI só formata |
| Navegar de agregado para lançamentos | `links.test.ts`; E2E spec `/transactions` e `/spendable/breakdown` |
| Sem dupla contagem cartão/transação | `aggregate.test.ts`; integração opt-in `query.integration.test.ts` / `t09.integration.test.ts` |
| Vazio / pouco / volume | empty UI + T09 seed; E2E empty; integração volume skipped aqui |
| Isolamento cross-space | `service.test.ts`, `composition.test.ts`, `links.test.ts`; integração skipped aqui |
| Erro ≠ zero; falha isolada | `service.test.ts`, `composition.test.ts`, `overview-home.test.tsx` |
| Alertas determinísticos | `alerts.test.ts` (21) |
| 360px | E2E spec viewport; T12 componentes |
| Observabilidade sem dado financeiro | `s10.test.ts` (13) |
| Sem cache V1 | `src/modules/overview/` sem cache; ADR-013 |

### Definition of Done

Avaliada em `tasks.md`. Itens que exigem Postgres/E2E executado ficam
explicitamente **pendentes de CI**, não promovidos por ausência de falha
local.

### Handoff

Ver seção **Handoff S10 → S11** em
[`docs/adr/013-s10-overview-contract.md`](../../docs/adr/013-s10-overview-contract.md)
e o ponteiro em [`docs/S11-operacao-confiavel.md`](../../docs/S11-operacao-confiavel.md).
