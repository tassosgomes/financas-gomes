# Observabilidade segura do S07

O adaptador em
[`src/modules/observability/s07.ts`](../src/modules/observability/s07.ts)
mede as quatro etapas do fluxo de projeção sem receber ou serializar o
read-model: `source`, `builder`, `engine` e `query`. T04, T05 e T06 podem
envolver suas respectivas boundaries com `withS07ForecastObservability` e
medir cada leitura/composição com `measureS07Query`.

## Contrato emitido

As operações são fechadas em:

| Etapa | Operação | Query code |
| --- | --- | --- |
| Fonte | `forecast.source.load` | `forecast_source` |
| Builder | `forecast.timeline.build` | `forecast_builder` |
| Engine | `forecast.engine.calculate` | `forecast_engine` |
| Query | `forecast.query.get` | `forecast_query` |

Os registros podem conter somente operação/etapa, `requestId`, IDs técnicos de
contexto (`userId`/`householdId`), cenário, tipo agregado de fonte, faixa
categórica do período, duração, status, códigos estáveis e contagens. Não há
`from`, `to`, `referenceId`, chave de reconciliação, label, descrição,
`amountCents`, saldo, SQL, bind values, cursor, command ou resultado no
registro. O contrato de leitura do ADR-008 não usa `commandId`; a correlação
de consulta é feita por `requestId`/`correlationId` fornecido pela boundary ou
gerado pelo adaptador.

Contagens permitidas são `sourceCount`, `recurringCount`,
`plannedEventCount`, `installmentCount`, `realizedEventCount`,
`cancelledCount`, `itemCount`, `projectedItemCount`, `realizedItemCount`,
`periodCount` e `dayCount`. O tipo de fonte (`RECURRING`, `PLANNED_EVENT`,
`INSTALLMENT`, `REALIZED_EVENT` ou `ALL`) é uma categoria e nunca substitui a
referência opaca usada pelo read-model.

## Integração

O contexto deve ser criado na boundary server-side, depois que o contexto
financeiro já tiver sido resolvido:

```ts
const operation = createS07ForecastOperation("query", {
  requestId,
  householdId: context.householdId,
  scenario: query.scenario,
  periodBucket: "SINGLE_PERIOD"
});

return withS07ForecastObservability(
  operation,
  () => measureS07Query(operation, () => readForecast(context, query), {
    itemCount: aggregate.itemCount,
    onSlowQuery: (record) => metrics.observe("s07_forecast_query", record),
  }),
);
```

`onRecord`, `onMetric` e `onSlowQuery` recebem o registro já allow-listed. O
adapter de métricas não deve anexar o timeline, linhas, filtros, SQL ou
payload ao registro. O wrapper preserva o `ForecastResult<T>`; códigos de
validação, autorização, limite e ausência são `expected_error`, enquanto
falhas de inconsistência/infraestrutura são `unexpected_error`, capturadas
no Sentry com stack sanitizada e relançadas para a boundary HTTP.

## Orçamento e Sentry

O warning de lentidão usa `S07_SLOW_QUERY_THRESHOLD_MS`, default de `250 ms`,
limitado a `60_000 ms`. O orçamento operacional usa `S07_QUERY_BUDGET_MS`,
default de `2_000 ms`, também limitado a `60_000 ms`. Um registro lento contém
`slowQuery`, `slowQueryThresholdMs`, `queryBudgetMs` e
`budgetExceeded`; nunca contém a query ou seus parâmetros.

Os tags/contextos Sentry seguros são `forecast_stage`, `forecast_query_code`,
`forecast_scenario`, `forecast_source_kind`, `forecast_period_bucket`, as
contagens agregadas, duração, `forecast_slow_query` e
`forecast_budget_exceeded`. Sugestões de alertas/dashboards:

- painel de duração p50/p95 por `forecast_stage` e `forecast_query_code`;
- alerta quando `forecast_budget_exceeded:true` ou quando a taxa de
  `slowQuery:true` crescer por etapa;
- painel de `unexpected_error` por `error_code` e etapa, mantendo
  `expected_error` fora do alerta de incidentes;
- filtro por cenário e faixa de período somente como dimensão agregada.

O Sentry mantém a política global de amostragem e redaction em
`src/modules/observability/runtime.ts`/`sanitize.ts`. Mensagens de exceção,
payloads, usuários e dados financeiros continuam removidos antes do
transporte.

## Investigação controlada

Para analisar duplicidade ou lentidão, use somente PostgreSQL efêmero/CI e
fixtures sintéticas. Crie um household sintético, semeie fontes com IDs e
valores artificiais, execute o cenário por meio da boundary e correlacione
apenas `forecast_stage`, `forecast_query_code`, duração, contagens,
`requestId` e o ID opaco do tenant de teste. Um `EXPLAIN (ANALYZE, BUFFERS)`
deve permanecer como artefato local/protegido; não o envie para Sentry, log de
produção ou breadcrumb. Remova o dataset e restaure o threshold/budget após o
ensaio. Não reproduza uma falha com extrato, descrição, valores, referências
ou tokens de produção.

