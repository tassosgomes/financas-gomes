# Observabilidade segura do S08

O adaptador em
[`src/modules/observability/s08.ts`](../src/modules/observability/s08.ts)
mede as quatro fronteiras do cálculo de disponibilidade sem receber nem
serializar o `SpendableBreakdown`: `read`, `forecast`, `engine` e
`serialization`. O serviço pode envolver cada boundary com
`withS08SpendableObservability` e medir leituras/etapas com
`measureS08Query`.

## Contrato emitido

As operações e códigos são fechados no código:

| Etapa | Operação | Query code |
| --- | --- | --- |
| Leitura | `spendable.read` | `spendable_read` |
| Montagem do forecast | `spendable.forecast.build` | `spendable_forecast` |
| Engine | `spendable.engine.calculate` | `spendable_engine` |
| Serialização | `spendable.serialize` | `spendable_serialization` |

Cada registro inclui, quando disponível, `requestId`, `s08.v1`,
`spendable.v1`, cenário (`CONSERVATIVE`/`EXPECTED`), horizonte em dias,
resultado categórico (`AVAILABLE`, `ZERO`, `DEFICIT` ou `UNAVAILABLE`), etapa,
código de operação, duração, status e contagens agregadas. A versão do
contrato e da regra é code-owned e não pode ser substituída pelo adapter.

Contagens permitidas são somente números limitados: fontes por tipo, itens de
forecast/projetados/realizados, dias/períodos, pontos causais, contas
`GENERAL`, componentes de reserva e campos serializados. `CONFIGURED` e
`ABSENT_DEFAULT_ZERO` são categorias de origem do buffer; o buffer em
centavos nunca é registrado.

Não há `amountCents`, saldo, `rawSpendableCents`, déficit, buffer, data,
descrição, nome, referência financeira, ID externo, payload, timeline, SQL,
bind value, cookie ou token no registro, breadcrumb, métrica ou contexto do
Sentry. O allow-list reconstrói o evento e ignora campos desconhecidos; o
resultado real do engine também não é inspecionado para montar telemetria.

## Classificação e falhas

Validação de `asOf`, cenário e horizonte, contexto financeiro ausente,
ausência de configuração e reserva ainda indisponível são resultados
`expected_error`/categorias esperadas. Apenas códigos técnicos fechados, como
`SPENDABLE_READ_FAILED`, `SPENDABLE_FORECAST_FAILED`,
`SPENDABLE_ENGINE_FAILED`, `SPENDABLE_SERIALIZATION_FAILED`,
`SPENDABLE_INCONSISTENT` e `SPENDABLE_QUERY_TIMEOUT`, são `unexpected_error`.

`withS08SpendableObservability` preserva o `Result` ou relança a exceção. Para
falhas técnicas, o Sentry recebe somente o contexto allow-listed e a stack é
sanitizada pela política global de `runtime.ts`/`sanitize.ts`; mensagens de
exceção, request e payload não são transportadas. Falhas do Sentry e dos
hooks de métricas são best-effort e não alteram a resposta do serviço.

## Lentidão e investigação

`S08_SLOW_QUERY_THRESHOLD_MS` (default `250 ms`) e `S08_QUERY_BUDGET_MS`
(default `2.000 ms`) são limitados a `60.000 ms`. `measureS08Query` registra
somente `slowQuery`, threshold, budget, `budgetExceeded`, etapa, código,
versões e agregados; nunca recebe SQL ou parâmetros como telemetria.

Para investigar lentidão ou inconsistência, use PostgreSQL efêmero/CI e
fixtures sintéticas. Correlacione apenas `requestId`, etapa, código, duração,
versões, cenário, horizonte e contagens. Um `EXPLAIN (ANALYZE, BUFFERS)` deve
permanecer local/protegido. Não reproduza falhas com extratos, descrições,
valores, referências ou tokens de produção.

