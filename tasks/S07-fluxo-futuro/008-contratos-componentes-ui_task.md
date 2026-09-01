# T08 — Contratos e componentes de UI do fluxo futuro

- Slice: S07 — Fluxo futuro
- Status: Concluída — contratos serializáveis, view models e componentes UI
  compartilhados verificados em 2026-08-31; composição da tela e drill-down
  permanecem nos handoffs T09/T10.
- Onda: transversal
- Dependências: T01
- Paralelização: Com T02–T07; estabiliza antes de T09/T10

## Objetivo

Definir uma apresentação consistente, acessível e explicável para realizado, previsto e compromissos.

## Escopo

- Criar view models e componentes para seletor de período, cenário, resumo, linha de timeline, badge de certeza/origem e estados loading/vazio/erro.
- Formatar `Money` e `PlainDate` apenas na borda, com semântica textual além da cor; preservar navegação por teclado e responsividade de consulta.
- Definir links/ações de drill-down sem confiar em ID/household do client e contrato de retorno para a visão futura.

## Critérios de aceite

- [x] Realizado e previsto são distinguíveis visual e textualmente — badges e
  labels explícitos para certeza/status (`Realizado`, `Comprometido`,
  `Esperado`), totais separados (`realized*`/`projected*`) e descrição do
  cenário são renderizados por `ForecastSummary`/`ForecastTimelineView`.
- [x] Valores principais e a origem de cada compromisso são compreensíveis em
  desktop e consulta mobile — o resumo usa grid responsivo, a timeline usa
  cards/lista responsiva, e cada item exibe direção, data, origem, certeza,
  status, valor e link de detalhe somente quando o adapter server-side fornece
  um `href` autorizado.
- [x] Componentes não recalculam regras de forecast no client — os contratos
  carregam strings de centavos/datas, os componentes apresentam os totais e
  saldos recebidos e `getSourceHref`/`sourceHrefs` não criam autoridade de
  household; o cenário e o período são apenas campos públicos da query.

## Handoff e verificações

- T09 compõe a visão e T10 usa badges/links de origem.
- Testes de componentes para estados, acessibilidade, serialização e formatação.

### Entrega e evidências (2026-08-31)

- [x] `src/modules/forecast/contracts.ts` e `ui-contracts.ts` mantêm o
  boundary JSON-only da ADR-008: nenhum `householdId`, sessão, autorização,
  `Date`, `bigint`, SQL ou regra de engine atravessa o contrato público.
- [x] `src/components/forecast` fornece `ForecastPeriodSelector`,
  `ForecastSummary`, `ForecastTimelineView`, badges de certeza/direção/status/
  origem, links server-authorized e estados de carregamento, vazio e erro.
- [x] `formatForecastMoney`, `formatForecastDate` e
  `formatForecastPeriod` formatam somente na borda e preservam centavos sem
  conversão para `Number`; valores financeiros inválidos não são exibidos
  como texto cru.
- [x] `rtk npx vitest run src/components/forecast/forecast-components.test.tsx
  --reporter=dot` — 4 testes aprovados.
- [x] `rtk npx tsc --noEmit --pretty false` — TypeScript sem erros.
- [x] `rtk node_modules/.bin/eslint src/modules/forecast
  src/components/forecast --max-warnings=0` — lint focado sem erros/warnings.
  O binário global exposto por `npx eslint` é incompatível com
  `ignorePatterns`; a verificação usa o binário local do projeto.

## Fora de escopo

Tela final, editor de metas, gráfico sofisticado ou client-side data access.
## Subtarefas

- [x] Mapear o read model público do ADR-008 para contratos de UI —
  `src/modules/forecast/contracts.ts` publica `s07.v1`, `ForecastItem`,
  `ForecastTimeline`, totais, query e erros; schemas Zod estritos validam
  datas civis, centavos serializados e a igualdade `referenceId`/origem.
- [x] Implementar componentes compartilhados sem regras financeiras no client
  — `src/components/forecast/forecast-period-selector.tsx`,
  `forecast-summary.tsx`, `forecast-timeline.tsx`, `forecast-badges.tsx`,
  `forecast-states.tsx` e `read-models.tsx`, com barrels e aliases de consumo.
- [x] Validar estados, acessibilidade e evidências de aceite — os testes
  focados cobrem serialização, formatação, query sem `householdId`, distinção
  realizado/previsto, links de origem, labels/landmarks e loading/vazio/erro
  sem vazamento de SQL/stack.
