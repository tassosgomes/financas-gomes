# Observabilidade segura do S11

O adaptador em
[`src/modules/observability/s11.ts`](../src/modules/observability/s11.ts)
instrumenta exportação e jobs recorrentes sem receber nem serializar conteúdo
de linha, valor monetário, dado pessoal ou segredo. T06 envolve leituras de
dataset com `wrapDatasetRead`; T07 envolve estágios do pipeline com
`instrumentS11ExportBoundary`; T08 usa `withJobAttempt`, `logS11JobStart` e
`logS11JobFinish`.

## Contrato emitido

As operações e códigos são fechados no código (`s11.v1`):

| Estágio | Operação |
| --- | --- |
| Pedido de exportação | `export.request` |
| Leitura de dataset | `export.dataset` |
| Serialização CSV/ZIP | `export.serialize` |
| Entrega do pacote | `export.deliver` |
| Início de job | `job.start` |
| Tentativa de job | `job.attempt` |
| Fim de job | `job.finish` |

Cada registro inclui, quando disponível, `requestId`/`correlationId`,
`executionId` (jobs), `datasetId` (identificador fechado como `accounts`, nunca
nome de arquivo com dado do usuário), `rowCount`, `byteCount`, `datasetCount`,
`attempt`, `jobName` (`s11.job.heartbeat` ou `s11.backup.logical`), `result`,
`outcome`, `durationMs`, `statusCode`, `errorCode` e `slow`.

Resultados permitidos: `SUCCESS`, `EMPTY`, `UNAVAILABLE_EXTERNAL_GATE`,
`TIMEOUT`, `TOO_LARGE`, `RATE_LIMITED`, `IN_PROGRESS`, `FAILED`,
`SKIPPED_IDEMPOTENT`, `SLOW`, `RETRYING`.

Outcomes: `success`, `expected_error`, `unexpected_error`.

## Limites de lentidão

| Escopo | Limite | Comportamento |
| --- | --- | --- |
| Dataset (`export.dataset`) | duração > **2.000 ms** | evento com `slow: true` e `result: SLOW`; a exportação continua |
| Exportação (`export.request`) | duração total > **5.000 ms** | evento com `slow: true` e `result: SLOW` |

Variáveis de ambiente opcionais: `S11_DATASET_SLOW_THRESHOLD_MS` e
`S11_EXPORT_SLOW_THRESHOLD_MS` (limitadas a 60.000 ms).

## O que nunca é registrado

Nenhum dos itens abaixo pode aparecer em log, breadcrumb, métrica ou contexto
do Sentry:

- valores monetários (`amountCents`, `balance`, centavos, saldos);
- nomes, descrições, categorias ou e-mails;
- `householdId`, `userId` ou identificadores de tenancy;
- nomes de arquivo com dado do usuário (só `datasetId` fechado);
- SQL, payloads brutos, URLs de banco, DSN, chaves de storage;
- cookies, tokens, header `Authorization` ou segredos.

O allow-list reconstrói o evento e descarta campos desconhecidos. O resultado
real da leitura, serialização ou job **não** é inspecionado para montar
telemetria — apenas agregados fornecidos pelo caller via opções seguras.

## Classificação e falhas

Códigos estáveis esperados (ADR-014): `UNAUTHENTICATED`, `EXPORT_IN_PROGRESS`,
`EXPORT_RATE_LIMITED`, `EXPORT_TIMEOUT`, `EXPORT_TOO_LARGE`,
`EXPORT_UNAVAILABLE`, `EXPORT_FAILED` e erros de contexto financeiro.

Falhas técnicas (`EXPORT_DATASET_FAILED`, `EXPORT_SERIALIZATION_FAILED`,
`EXPORT_DELIVERY_FAILED`, `JOB_FAILED`, …) são `unexpected_error` e disparam
`captureServerException` com contexto allow-listed. A resposta ao usuário
permanece opaca (`toS11ErrorEnvelope`).

Tentativas de retry do mesmo job correlacionam por `executionId` opaco e campo
`attempt`.

## API do adaptador (T06/T07/T08)

- `createS11Operation(operation, options)` — metadados versionados + `requestId`.
- `wrapDatasetRead(datasetId, work, options)` — leitura cronometrada (T06).
- `instrumentS11ExportBoundary(operation, boundary, options)` — estágio do pipeline (T07).
- `withS11Observability(operation, work, options)` — wrapper genérico.
- `withJobAttempt(work, options)` — uma tentativa correlacionada (T08).
- `logS11JobStart(options)` / `logS11JobFinish(outcome, options)` — ciclo de vida.
- `reportS11UnexpectedError(error, operation, …)` — log + Sentry seguro.
- `sanitizeS11Log(input)` — allow-list final para testes e transporte.
