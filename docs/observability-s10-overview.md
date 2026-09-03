# Observabilidade segura do S10 (Visão Geral)

O adaptador em
[`src/modules/observability/s10.ts`](../src/modules/observability/s10.ts)
instrumenta a home consolidada sem receber nem serializar o read model
`OverviewReadModel`: leitura (`overview.read`), agregação (`overview.aggregate`),
composição (`overview.compose`) e renderização (`overview.render`). T02/T03/T06
podem envolver boundaries com `withOverviewObservability` e medir blocos com
`measureOverviewQuery`.

## Contrato emitido

As operações e estágios são fechados no código:

| Estágio | Operação |
| --- | --- |
| Leitura | `overview.read` |
| Agregação | `overview.aggregate` |
| Composição | `overview.compose` |
| Renderização | `overview.render` |

Cada registro inclui, quando disponível, `requestId`, `s10.v1`, estágio,
operação, duração, status e contagens agregadas. Resultados categóricos:
`AVAILABLE`, `EMPTY`, `PARTIAL` ou `UNAVAILABLE` — nunca valores monetários.

Contagens permitidas são somente números limitados: grupos, itens, caixinhas,
compromissos, alertas, origens consumidas, blocos `ready`, `error` e `empty`.

## O que nunca é registrado

Não há centavos, saldos, nomes, descrições, categorias, referências
financeiras, `householdId`, `userId`, SQL, payloads, cookies, tokens, `asOf`,
timeline, breakdown spendable bruto ou qualquer dado de tenancy no log,
breadcrumb, métrica ou contexto do Sentry. O allow-list reconstrói o evento e
ignora campos desconhecidos; o resultado real da leitura também não é
inspecionado para montar telemetria.

## Classificação e falhas

Validação de data, cenário, horizonte e contexto financeiro ausente são
`expected_error`. Apenas códigos técnicos fechados, como
`OVERVIEW_QUERY_FAILED`, `OVERVIEW_AGGREGATION_FAILED`,
`OVERVIEW_COMPOSE_FAILED`, `OVERVIEW_RENDER_FAILED` e
`OVERVIEW_QUERY_TIMEOUT`, são `unexpected_error`.

`withOverviewObservability` preserva o `Result` ou relança a exceção. Para
falhas técnicas, o Sentry recebe somente o contexto allow-listed; mensagens de
exceção, request e payload não são transportadas.

## Lentidão, timeout e investigação

| Parâmetro | Valor V1 (ADR-013) |
| --- | --- |
| Limiar de query lenta | **500 ms** (`OVERVIEW_SLOW_QUERY_THRESHOLD_MS`) |
| Timeout por bloco | **2500 ms** (`OVERVIEW_BLOCK_TIMEOUT_MS`) |

`S10_SLOW_QUERY_THRESHOLD_MS` e `OVERVIEW_SLOW_QUERY_THRESHOLD_MS` podem
sobrescrever o limiar de lentidão; `OVERVIEW_BLOCK_TIMEOUT_MS` e
`S10_QUERY_BUDGET_MS` o budget de bloco. Ambos são limitados a `60.000 ms`.

`measureOverviewQuery` registra somente `slowQuery`, threshold, budget,
`budgetExceeded`, estágio, código, versão e agregados; nunca recebe SQL ou
parâmetros como telemetria.

Para investigar lentidão ou falha de agregação, correlacione apenas
`requestId`, estágio, código, duração, versão e contagens. Não reproduza falhas
com extratos, descrições, valores, referências ou tokens de produção.
