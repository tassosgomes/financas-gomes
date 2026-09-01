# T07 — Observabilidade segura do cálculo e das consultas

- Slice: S07 — Fluxo futuro
- Status: Concluída tecnicamente — contrato allow-listed, classificação,
  medição por etapa, orçamento e redaction verificados em 2026-08-31; a
  integração nas boundaries T04–T06 e a revisão de release permanecem no
  handoff downstream.
- Onda: transversal
- Dependências: T01
- Paralelização: Com T02–T06; integração contínua nos readers e serviço

## Objetivo

Tornar falhas e lentidão da projeção detectáveis sem expor informações financeiras.

## Escopo

- Instrumentar duração do carregamento de fontes, montagem da timeline e execução da query, com contadores por tipo de fonte, cenário e faixa de período sem valores/descrições/IDs brutos.
- Capturar exceções inesperadas com contexto técnico mínimo, classificando validação, autorização e ausência como erros esperados.
- Definir orçamento de consulta, alertas/dashboards Sentry e correlação segura de request/command já adotada no projeto.
- Documentar como investigar duplicidade e lentidão usando fixtures sintéticas, não dados de produção.

## Critérios de aceite

- [x] Exceções do cálculo são capturadas com stack sanitizada e classificação
  útil (`expected_error` para validação/autorização/ausência e
  `unexpected_error` para inconsistência/infraestrutura), preservando o
  relançamento na boundary.
- [x] Logs, traces e Sentry não contêm descrição, valor, saldo, referência ou
  payload financeiro cru; somente campos técnicos, categorias e contagens
  agregadas atravessam a allow-list.
- [x] Consulta lenta pode ser distinguida entre fonte, builder, engine e query
  por `forecastStage`/`forecastQueryCode`, com threshold e orçamento
  separados.

## Handoff e verificações

- T06 integra a instrumentação; T13 revisa alertas e privacidade no release.
- Testes com transport fake/sanitização e revisão manual de tags/eventos.

## Fora de escopo

Telemetria de produto, gravação de forecast por usuário ou alteração de decisões financeiras.
## Subtarefas

- [x] Mapear os pontos de instrumentação permitidos pelo ADR-008: carregamento
  de fonte, montagem da timeline, engine puro e query server-side.
- [x] Implementar telemetria segura para fonte, builder, engine e query em
  `src/modules/observability/s07.ts`, com hooks para métricas e aliases de
  integração para T04–T06.
- [x] Cobrir redaction, classificação, envelope de erro, correlação,
  breadcrumbs, contexto Sentry, orçamento e evidências de aceite em
  `src/modules/observability/s07.test.ts`.

## Verificações

- [x] `rtk npm exec vitest -- run src/modules/observability/s07.test.ts
  --reporter=dot` — 11 testes passaram em 2026-08-31.
- [x] `rtk npm exec vitest -- run src/modules/observability --reporter=dot` —
  7 arquivos e 41 testes passaram em 2026-08-31.
- [x] `rtk npm exec eslint -- src/modules/observability/s07.ts
  src/modules/observability/s07.test.ts src/modules/observability/contracts.ts
  src/modules/observability/sanitize.ts src/modules/observability/index.ts` —
  concluído sem warnings em 2026-08-31.
- [x] Os bloqueios históricos de typecheck e lint foram resolvidos nos
  re-releases T05/T02; ambos os gates passaram na auditoria T13.
- [x] Orçamento, dimensões de alerta/dashboard Sentry e investigação com
  fixtures sintéticas documentados em
  `docs/observability-s07-forecast.md`; nenhum EXPLAIN ou dado de produção foi
  coletado.
- [x] T04/T06 integraram os wrappers nos readers, builder e serviço; T13
  auditou os eventos allow-listed e a ausência de conteúdo financeiro cru.
- [x] O release T13 revisou a classificação e o contrato de alertas. A
  configuração operacional de DSN continua externa ao repositório e não
  altera o gate de código.
