# S07 — Compromissos e visão do fluxo futuro

Este plano divide o S07 em 13 tasks executáveis. Ele deriva de
[`docs/S07-fluxo-futuro.md`](../../docs/S07-fluxo-futuro.md),
[`docs/prd.md`](../../docs/prd.md) e [`docs/techspec.md`](../../docs/techspec.md).
S03 e S06 são dependências obrigatórias: o S07 não recria ledger, transação ou
parcelamento; deriva compromissos de suas fontes e fornece a base para S08 e
S10.

## Decisões normativas do plano

- O forecast é uma derivação, não tabela de saldos nem fonte contábil. O
  `ForecastEngine` é puro: recebe itens normalizados, saldo inicial, intervalo
  e cenário; não acessa PostgreSQL, Drizzle, cartão ou recorrência.
- `FinancialEvent`, `AccountEntry`, `Installment`, `RecurringOccurrence` e
  `ForecastItem` são conceitos distintos. Money usa centavos/`bigint` e datas
  financeiras usam `Temporal.PlainDate`/`DATE`; não usar float nem `Date`.
- As fontes V1 deste slice são parcelas futuras do S06, recorrências
  mensal/anual, suas exceções/realizações e eventos planejados explícitos.
  Metas, caixinhas, orçamento, spendable, estornos e cenários probabilísticos
  não serão inventados no S07.
- A mesma obrigação entra no máximo uma vez: realização reconciliada substitui
  previsão/ocorrência, parcela entra só na competência materializada pelo S06,
  e pagamento de cartão não é nova despesa. Cancelamentos removem apenas o
  impacto ativo definido pela fonte.
- Todo acesso é server-side e tenant-scoped pelo contexto financeiro; IDs,
  `householdId` ou autorização jamais são aceitos do client. Referências
  cross-tenant retornam ausência/erro opaco.
- O resultado agrupa itens do mesmo dia antes de alterar o saldo, preserva
  ordem estável, separa realizado de previsto e explica cada origem por
  `referenceId`. O contrato deve suportar meses futuros sem limite conceitual.

## Ordem de execução

### Onda 0 — Decisão que desbloqueia o slice

1. [T01 — Contrato do forecast e gate de dependências](001-contrato-e-gate-dependencias_task.md)

T01 é serial: fecha fontes, cenários, reconciliação e contrato antes de schema
ou UI.

### Onda 1 — Fundações paralelas

2. [T02 — Schema de recorrências, eventos planejados e integridade](002-schema-recorrencias-eventos-planejados_task.md)
3. [T03 — Regras de recorrência, calendário e realização](003-regras-recorrencias-calendario_task.md)
4. [T07 — Observabilidade segura do cálculo e das consultas](007-observabilidade-segura_task.md)
5. [T08 — Contratos e componentes de UI do fluxo futuro](008-contratos-componentes-ui_task.md)

Depois de T01, T02, T03, T07 e T08 avançam em paralelo. T03 pode desenvolver
o domínio puro enquanto T02 prepara a migration; sua integração depende de
T02. T07 deve entrar continuamente nos readers e T08 estabiliza o vocabulário
das telas sem criar regra no client.

### Onda 2 — Pipeline de projeção

6. [T04 — Fontes normalizadas e ForecastTimelineBuilder](004-fontes-normalizadas-timeline_task.md)
7. [T05 — ForecastEngine puro e agregação por período](005-forecast-engine-puro_task.md)
8. [T06 — Serviço de projeção, contrato e desempenho](006-servico-projecao-contrato-api_task.md)

T04 depende de schema, recorrência e read contract de parcelas S06. T05 pode
ser implementada/testada em paralelo, pois é pura; T06 integra T04/T05,
instrumentação e o boundary tenant-safe.

### Onda 3 — Experiência explicável

9. [T09 — Visão futura mensal por período](009-visao-futura-por-periodo_task.md)
10. [T10 — Drill-down, origem e manutenção de compromissos](010-drilldown-origens-e-manutencao_task.md)

T09 inicia após T06/T08. T10 usa as referências consolidadas, por isso fecha
depois de T09; o preparo de suas telas pode ocorrer em paralelo com T09.

### Onda 4 — Qualidade e release

11. [T11 — Testes unitários e integração PostgreSQL](011-testes-unitarios-integracao_task.md)
12. [T12 — Testes E2E do fluxo futuro](012-testes-e2e_task.md)
13. [T13 — Validação de release e handoff](013-validacao-release_task.md)

T11 é incremental desde T03/T05, mas só fecha depois do serviço. T12 depende
das telas integradas. T13 é o gate serial final.

## Matriz de dependências e paralelização

| ID | Task | Onda | Dependências | Pode trabalhar em paralelo com |
|---|---|---:|---|---|
| T01 | Contrato e gate | 0 | S03, S06 | — |
| T02 | Schema e integridade | 1 | T01 | T03, T07, T08 |
| T03 | Recorrência/calendário | 1 | T01; persistência T02 | T02, T07, T08 |
| T04 | Fontes/timeline builder | 2 | T02, T03, S06 | T05, T07 |
| T05 | Engine puro | 2 | T01; contrato T04 | T02–T04, T07, T08 |
| T06 | Serviço/query | 2 | T02–T05 | T07; preparação T09 |
| T07 | Observabilidade | transversal | T01 | T02–T06 |
| T08 | UI shared | transversal | T01 | T02–T07 |
| T09 | Visão por período | 3 | T06, T08 | preparação T10, T11 |
| T10 | Drill-down/manutenção | 3 | T03, T06, T08, T09 | acabamento T11 |
| T11 | Unitários/integração | 4 | T02–T07 | T09/T10 durante escrita incremental |
| T12 | E2E | 4 | T09–T11 | — |
| T13 | Release/handoff | 4 | T06, T07, T10–T12 | — |

## Caminho crítico

`T01 → (T02 + T03) → T04 → T05 → T06 → T09 → T10 → T11 → T12 → T13`

T07 e T08 reduzem risco fora do caminho crítico. T05 não deve aguardar a
infraestrutura para seus testes puros, mas T06 só integra quando T04 estiver
estável.

## Definition of Done do slice

- [x] O usuário pode navegar períodos futuros e ver entradas, saídas, saldo
  projetado, realizado e previsto com cálculo determinístico.
- [x] Parcela futura do cartão aparece exatamente uma vez, na competência
  correta, e origem cancelada remove o impacto futuro aplicável.
- [x] Recorrências e eventos planejados V1 respeitam vigência, calendário,
  exceção e realização sem reescrever histórico ou duplicar previsão.
- [x] Cada compromisso importante possui origem explicável e um caminho seguro
  de detalhe/correção/adição; parcela não é paga ou editada isoladamente.
- [x] Contrato server-side, tipos e timeline são reutilizáveis por S08/S10 sem
  duplicar regras ou consultar tabelas internas.
- [x] Queries e commands preservam household, integridade, idempotência e
  precisão financeira; telemetria não contém dados financeiros crus.
- [x] Unitários, PostgreSQL, E2E e gates de release cobrem mês vazio,
  múltiplas parcelas, virada de ano, realizado+previsto e cancelamento.

## Handoff para S08 e S10

S08 consome os tipos públicos de T06/T05 para calcular spendable sobre o
menor saldo futuro, sem rematerializar parcelas ou recorrências. S10 pode
consumir totais, timeline e referências para uma visão consolidada. Ambos
devem tratar o S07 como única fonte da projeção; regras de meta, orçamento e
patrimônio continuam nos slices próprios.
