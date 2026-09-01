# Observabilidade segura

O Finanças Gomes usa `@sentry/nextjs` para exceções inesperadas e traces de
performance. A integração é desativada quando não há DSN válido e qualquer
falha do SDK é tratada como best effort, sem alterar a resposta da aplicação.

Tracing coleta 100% das transações em `development`, 10% nos demais ambientes
e descarta probes de `/api/health` e `/api/readiness`. O bundle mantém o código
de tracing habilitado; os callbacks `beforeSendSpan` e
`beforeSendTransaction` enviam somente tempos, operações e rotas
parametrizadas, sem payloads, cookies, tokens ou dados financeiros.

O contrato específico da projeção está em
[`observabilidade segura do S07`](observability-s07-forecast.md): ele define
as etapas source/builder/engine/query, contagens agregadas, orçamento de
consulta e investigação com fixtures sintéticas.

## Configuração local

Copie o arquivo de exemplo e deixe os DSNs vazios para trabalhar sem Sentry:

```bash
cp .env.example .env.local
```

Para ativar o backend local, preencha `SENTRY_DSN`. Para ativar o navegador,
preencha também `NEXT_PUBLIC_SENTRY_DSN` com o DSN público do projeto. Use
`SENTRY_ENVIRONMENT=development` e, se desejar, um valor explícito em
`SENTRY_RELEASE`.

O DSN do navegador não é uma credencial; ainda assim, o DSN do servidor fica
separado para evitar que variáveis privadas sejam embutidas no bundle público.

## Preview e produção

Configure as variáveis no provedor de deploy, sem comitá-las:

| Ambiente | Backend | Browser |
| --- | --- | --- |
| Preview | `SENTRY_DSN`, `SENTRY_ENVIRONMENT=preview`, `SENTRY_RELEASE` | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT=preview`, `NEXT_PUBLIC_SENTRY_RELEASE` |
| Produção | `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `SENTRY_RELEASE` | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`, `NEXT_PUBLIC_SENTRY_RELEASE` |

As variáveis `NEXT_PUBLIC_*` precisam estar disponíveis durante o build do
Next.js. O release deve identificar o commit publicado; o código também usa
`VERCEL_GIT_COMMIT_SHA` ou `GITHUB_SHA` como fallback no servidor.

## Probe controlado

Para verificar que o DSN aponta para o projeto esperado, habilite
temporariamente `SENTRY_TEST_MODE=true` e defina um segredo aleatório em
`SENTRY_TEST_TOKEN`. Faça um `POST` autenticado:

```bash
curl -i -X POST \
  -H "x-sentry-test-token: $SENTRY_TEST_TOKEN" \
  https://seu-host.example/api/observability/test
```

O endpoint fica em 404 por padrão, exige o token por header e retorna somente
um `eventId` opaco. Desative `SENTRY_TEST_MODE` após validar o evento no
projeto correto. O token bruto nunca é passado ao Sentry.

## Dados permitidos e bloqueados

O contexto da aplicação aceita somente tipo de evento, use case, duração,
status, rota/template e IDs opacos. Os callbacks `beforeSend`,
`beforeSendSpan` e `beforeSendTransaction` usam allow-list e removem `user`,
`extra`, payload/body/query, cookies, headers, `Authorization`, tokens,
segredos, mensagens de erro, variáveis de stack e atributos de spans. Os
traces mantêm apenas timing, operação, status e rotas parametrizadas.
Breadcrumbs mantêm apenas método/status/tamanhos técnicos ou, no fluxo S03,
operação, tipo, event ID, resultado, duração e código estável. Não use dados
financeiros reais para reproduzir falhas.

## Transação manual (S03)

Erros de negócio são parte do contrato público: os use cases retornam
`S03Result<T>` com um código estável, mensagem acionável e, quando aplicável,
campo. A UI pode exibir essa mensagem sem conhecer PostgreSQL ou a stack. Os
códigos de T01/ADR-004 são:

| Grupo | Códigos |
| --- | --- |
| Validação | `INVALID_COMMAND`, `INVALID_COMMAND_ID`, `INVALID_AMOUNT`, `INVALID_DATE`, `DATE_IN_FUTURE`, `INVALID_DESCRIPTION` |
| Referências/tenant | `ACCOUNT_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `RESOURCE_ARCHIVED`, `TRACKING_START_DATE_VIOLATION`, `CATEGORY_KIND_MISMATCH` |
| Estado/histórico | `EVENT_NOT_FOUND`, `EVENT_NOT_MANUAL`, `EVENT_NOT_POSTED`, `EVENT_ALREADY_CANCELLED`, `REVERSAL_ALREADY_EXISTS`, `NON_EDITABLE_FIELD` |
| Idempotência/acesso | `COMMAND_ID_REUSED`, `UNAUTHENTICATED` |

Falhas inesperadas (bug, indisponibilidade ou erro de persistência) não são
convertidas em uma mensagem técnica para o browser. O adaptador registra o
resultado `unexpected_error`, envia a exceção ao Sentry com ambiente/release
e relança para que a camada HTTP entregue uma resposta genérica. O payload da
exceção é sanitizado antes do transporte.

As operações de escrita usam os nomes técnicos `transactions.create.expense`,
`transactions.create.income`, `transactions.update.manual` e
`transactions.cancel.manual`. Logs e contexto podem conter somente operação,
tipo (`EXPENSE`/`INCOME`/`MANUAL`), duração, status, IDs opacos (`eventId`,
`requestId`, tenant) e código de erro. Nunca passe o command, `amountCents`,
descrição, conta, categoria, notas, cookies, tokens ou cabeçalhos para
`logObservability`, breadcrumbs ou `captureServerException`.
