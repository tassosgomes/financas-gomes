# T05 — Observabilidade segura do cálculo

- Status: Concluída tecnicamente — contrato allow-listed, classificação,
  medição por etapa, orçamento e redaction verificados em 2026-09-01; a
  integração nas boundaries T06/T07 e a auditoria de publicação permanecem no
  handoff downstream.
- Onda: 1, transversal
- Dependências: T01 e infraestrutura S01
- Paralelização: Com todas as tasks do slice

## Objetivo

Tornar exceções, inconsistências e regressões de consulta diagnosticáveis sem
enviar dados financeiros pessoais para Sentry ou logs.

## Escopo

- Instrumentar `spendable.read`, montagem de forecast, engine e serialização
  com request ID, versão da regra, cenário, horizonte, duração, resultado e
  contagens agregadas.
- Classificar validação de input/ausência de configuração como erro esperado;
  capturar somente exceções técnicas e invariantes quebrados.
- Aplicar allow-list e redaction: proibir centavos, saldo, descrição, nomes,
  IDs externos, payload, cookies, tokens e timeline em logs/Sentry.
- Medir consultas lentas por operação sem interpolar SQL ou dados financeiros;
  criar testes de redaction/classificação.

## Critérios de aceite

- [x] Falha técnica identifica etapa, operação, `s08.v1`, `spendable.v1`,
  cenário, horizonte, código técnico e request ID com contexto seguro; o
  wrapper preserva o relançamento da exceção.
- [x] Testes impedem regressão que envie centavos, saldo, déficit, buffer,
  descrição, nome, referência financeira/ID externo, payload, timeline, SQL,
  cookies ou tokens à telemetria.

## Subtarefas

- [x] Mapear os pontos de instrumentação permitidos pela ADR-011: leitura,
  montagem de forecast, engine e serialização, com operações e query codes
  fechados em `src/modules/observability/s08.ts`.
- [x] Implementar contexto versionado com request/correlation ID, cenário,
  horizonte, resultado categórico, origem do buffer, contagens agregadas,
  threshold e budget; nenhum valor monetário é aceito.
- [x] Implementar allow-list comum para logs, métricas, breadcrumbs e Sentry,
  incluindo sanitização global de tags/contextos S08 e remoção de campos
  desconhecidos.
- [x] Implementar classificação de validação/contexto/configuração ausente
  como `expected_error` e captura best-effort somente de falhas técnicas ou
  invariantes quebrados, com envelope público seguro.
- [x] Adicionar testes focados de redaction, classificação, envelope,
  correlação, breadcrumbs, contexto Sentry, wrapper de `Result`, exceção
  técnica e consulta/operação lenta em `src/modules/observability/s08.test.ts`.

## Verificações

- [x] `rtk npm exec vitest -- run src/modules/observability/s08.test.ts
  --reporter=dot` — 12 testes passaram em 2026-09-01.
- [x] `rtk npm exec vitest -- run src/modules/observability/s08.test.ts
  src/modules/observability/sanitize.test.ts
  src/modules/observability/s07.test.ts --reporter=dot` — 3 arquivos e
  29 testes passaram em 2026-09-01; a extensão S08 não regrediu a sanitização
  compartilhada nem o contrato S07.
- [x] `rtk npm exec eslint -- src/modules/observability/s08.ts
  src/modules/observability/s08.test.ts src/modules/observability/sanitize.ts
  src/modules/observability/contracts.ts src/modules/observability/index.ts
  --max-warnings=0` — concluído sem erros ou warnings em 2026-09-01.
- [x] `rtk git diff --check` nos artefatos T05 — concluído sem erros em
  2026-09-01.
- [x] `rtk npm run typecheck` — concluído sem erros em 2026-09-01 com os
  contratos S08 e o sanitizador compartilhado incluídos.
- [x] `rtk npm exec vitest -- run src/modules/observability --reporter=dot` —
  8 arquivos e 53 testes passaram em 2026-09-01.
- [x] Revisão estática confirmou que `sanitizeS08SpendableLog`, callbacks,
  breadcrumb e `toS08ObservabilityContext` reconstruem apenas campos
  allow-listed; o retorno do cálculo nunca é percorrido para extrair valores.
- [x] Threshold `S08_SLOW_QUERY_THRESHOLD_MS` e budget
  `S08_QUERY_BUDGET_MS` são limitados a 60.000 ms e os registros lentos não
  carregam SQL ou parâmetros.

## Handoff

- T06/T07 devem envolver as boundaries do serviço com
  `withS08SpendableObservability` e usar `measureS08Query` por operação,
  fornecendo apenas cenário, horizonte, resultado categórico e contagens.
- T13 deve auditar eventos publicados e configuração externa do Sentry; esta
  task não coleta dados de produção nem faz deploy.
