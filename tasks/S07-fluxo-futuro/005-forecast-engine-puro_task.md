# T05 — ForecastEngine puro e agregação por período

- Slice: S07 — Fluxo futuro
- Status: Concluída — TS2352 corrigido e gates de re-release verificados em
  2026-08-31.
- Onda: 2
- Dependências: T01; contrato de T04 para integração
- Paralelização: Implementação pura com T02–T04, T07 e T08

## Objetivo

Calcular timeline, entradas, saídas, saldo projetado e menor saldo de forma pura, determinística e reutilizável por S08.

## Escopo

- Implementar `ForecastEngine(items, openingBalance, range, scenario)` sem acesso a persistência ou tempo implícito.
- Agregar eventos do mesmo dia antes de mutar saldo; devolver breakdown diário e mensal, totais, saldo inicial/final e referências explicáveis.
- Tratar intervalos inclusivos, meses vazios, horizontes longos, ano/calendário e valores em `Money`/`bigint`, serializando centavos somente na borda.
- Expor interface estável para household forecast e extensão por conta somente se os dados de origem forem suficientes e sem inventar transferências.

## Critérios de aceite

- [x] Mesma entrada produz byte/shape equivalente e ordenação estável — o
  comparador civil usa data, precedência de estado, origem, referência,
  ocorrência/competência, sequência e campos financeiros canônicos, sem
  depender da ordem física dos itens.
- [x] Somatório de entradas/saídas e saldo final fecha com os itens; não há
  float nem dependência de timezone — toda aritmética usa `bigint` e a saída
  serializa centavos como strings.
- [x] Itens no mesmo dia não criam mínimo artificial dependente da ordem — os
  inflows/outflows são agregados antes de mutar o saldo projetado.
- [x] Motor não importa infraestrutura, schema, Drizzle ou módulos de
  cartão/recorrência — `engine.ts` depende somente de Temporal e dos
  contratos serializáveis do forecast.

## Handoff e verificações

- T06 adapta o resultado a contrato de query; S08 consome saldo/timeline sem recalcular regras.
- Testes tabelados de sinal, período, dia compartilhado, ano, cenário e precisão monetária.

## Fora de escopo

Spendable/operational buffer, cenários probabilísticos, UI e acesso a banco.
## Subtarefas

- [x] Consolidar contrato de entrada/saída com ADR-008 e T08 — o engine
  consome `ForecastItem`/cenários do contrato público e aceita metadata de
  inclusão conservadora apenas na entrada interna, sem vazá-la no read model.
- [x] Implementar engine puro, agregação diária e períodos — `ForecastEngine`
  suporta forma posicional e de configuração, ajustes de abertura, intervalo
  inclusivo, buckets mensais vazios/virada de ano, totais realizado/projetado,
  saldo final, mínimo e referências explicáveis.
- [x] Cobrir determinismo, precisão e invariantes em testes — 14 testes
  unitários cobrem cenário, mesma data, intervalo, atraso, períodos,
  realizado/previsto, `bigint`/value object, mínimo, não mutação, aliases,
  validação e parsing serializável.

## Entrega e evidências (2026-08-31)

- [x] `src/modules/forecast/engine.ts` implementa o cálculo sem relógio,
  timezone, persistência, SQL, Drizzle ou dependências de fonte de domínio.
- [x] `src/modules/forecast/index.ts` exporta o engine e aliases estáveis para
  consumo de T06/S08, mantendo `ForecastTimeline` como retorno serializável.
- [x] `rtk npx vitest run src/modules/forecast/engine.test.ts --reporter=dot`
  — 14 testes aprovados.
- [x] `rtk node_modules/.bin/eslint src/modules/forecast/engine.ts
  src/modules/forecast/engine.test.ts --max-warnings=0` — lint focado sem
  erros/warnings.
- [x] `rtk npx tsc --noEmit --pretty false --incremental false` não reporta
  diagnósticos em `src/modules/forecast/engine.ts` ou `index.ts`; a execução
  global anterior ainda encontrava diagnósticos preexistentes fora do escopo
  T05.

## Evidência de re-release após T13 (2026-08-31)

- [x] O retorno privado de `normalizeSource` foi tipado como
  `Record<string, unknown>` e o cast incompatível para `ForecastSource` foi
  removido; `parseForecastItem` continua validando e estreitando a origem na
  mesma boundary, sem alteração do contrato público ou da semântica.
- [x] `rtk npm run typecheck` — TypeScript passou sem erros.
- [x] `rtk npx tsc --noEmit --pretty false --incremental false` — `TypeScript:
  No errors found`.
- [x] `rtk npx vitest run src/modules/forecast/engine.test.ts --reporter=dot`
  — 14/14 testes aprovados.
- [x] `rtk node_modules/.bin/eslint src/modules/forecast/engine.ts
  src/modules/forecast/engine.test.ts --max-warnings=0` — sem
  erros/warnings.
- [x] `rtk git diff --check` — sem saída.
