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

## Sentry nos jobs e alertas (T12)

| Runtime job | Init Sentry | Release / ambiente | Flush |
| --- | --- | --- | --- |
| CLI `src/modules/jobs/cli.ts` | `initializeServerSentry()` | `SENTRY_RELEASE` → `VERCEL_GIT_COMMIT_SHA` → `GITHUB_SHA`; `SENTRY_ENVIRONMENT` | `flushSentrySafely()` no `exit` |
| `runJob` / heartbeat | via `reportS11UnexpectedError` → `captureServerException` | herdado do processo | `flushSentrySafely()` após falha terminal |

**Backup (T09 caminho B):** não há job `s11.backup.logical` na V1. Falhas de
PITR/restore são acompanhadas no Neon; o proxy operacional no Sentry é a
ausência do heartbeat diário (`s11.job.heartbeat`).

**Alertas mínimos (configurar no Sentry, sem IDs no repo):**

| Sinal | Limiar | Destino |
| --- | --- | --- |
| `job.finish` + `result: FAILED` | 1 evento | on-call / dono do projeto |
| `export.request` + `unexpected_error` | > 5 em 5 min (ajustar `N`) | on-call / dono do projeto |
| Backup lógico | N/A | Neon PITR; heartbeat parado = incidente |

**Cron sugerido (operador):** diariamente em UTC, por exemplo `0 6 * * *`,
com `DATABASE_URL` e `SENTRY_*` do ambiente de produção:

```bash
npx tsx src/modules/jobs/cli.ts heartbeat
```

Não há workflow agendado neste repositório: o `DATABASE_URL` de produção não
está disponível nos secrets do CI (apenas Postgres descartável). Configure o
cron no provedor de execução (GitHub Actions com secrets de produção, Vercel
Cron, ou runner interno) conforme a política do time.

**Validação controlada:** em não produtivo, `npx tsx src/modules/jobs/cli.ts
heartbeat --inject-failure` após configurar DSN; confirme evento e alerta no
Sentry. Ver também `docs/observability.md` (probe `/api/observability/test`).

## Estado de execuções de jobs (T08)

O runtime em [`src/modules/jobs/runtime.ts`](../src/modules/jobs/runtime.ts)
persiste uma linha por janela lógica em `job_executions` (`job_name`,
`logical_window` UTC `YYYY-MM-DD`, `execution_id`, `attempt`, `status`,
`started_at`, `finished_at`, `error_code`, `correlation_id`). Não há payload
financeiro, `household_id` nem segredo.

Consulta mínima para o operador (psql, cliente SQL ou script interno com
`DATABASE_URL`):

```sql
SELECT job_name, logical_window, status, attempt, started_at, finished_at, error_code
  FROM job_executions
 ORDER BY started_at DESC
 LIMIT 50;
```

Na aplicação, use `listRecentJobExecutions(limit)` de
[`src/modules/jobs/query.ts`](../src/modules/jobs/query.ts) ou
`runS11JobHeartbeat()` de
[`src/modules/jobs/heartbeat.ts`](../src/modules/jobs/heartbeat.ts) para
exercitar o job operacional `s11.job.heartbeat`. Para cron ou operador:

```bash
npx tsx src/modules/jobs/cli.ts heartbeat
```

O CLI inicializa Sentry (`initializeServerSentry`), executa o heartbeat,
faz `flushSentrySafely()` e termina com código `0` ou `1`. Falhas terminais no
runtime também chamam flush após `logS11JobFinish` / `reportS11UnexpectedError`.
Não há tela nem endpoint público novo; `/api/readiness` permanece inalterado.

Status persistidos: `RUNNING`, `SUCCEEDED`, `FAILED`. Chamadas duplicadas na
mesma janela já concluída retornam `SKIPPED_IDEMPOTENT` nos eventos sem
repetir o efeito.

## API do adaptador (T06/T07/T08)

- `createS11Operation(operation, options)` — metadados versionados + `requestId`.
- `wrapDatasetRead(datasetId, work, options)` — leitura cronometrada (T06).
- `instrumentS11ExportBoundary(operation, boundary, options)` — estágio do pipeline (T07).
- `withS11Observability(operation, work, options)` — wrapper genérico.
- `withJobAttempt(work, options)` — uma tentativa correlacionada (T08).
- `logS11JobStart(options)` / `logS11JobFinish(outcome, options)` — ciclo de vida.
- `reportS11UnexpectedError(error, operation, …)` — log + Sentry seguro.
- `sanitizeS11Log(input)` — allow-list final para testes e transporte.
