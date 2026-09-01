# T09 — Observabilidade segura

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — observabilidade S04 sanitizada, classificação de erros
  esperados e testes de redaction verificados em 2026-08-30.
- Onda: 2
- Dependências: T01
- Paralelização: Com T06–T08

## Objetivo

Tornar falhas operáveis sem enviar vida financeira do usuário a serviços externos.

## Escopo

- Instrumentar erros inesperados de upload, parse, preview e confirmação no Sentry com IDs opacos, etapa, código técnico e duração.
- Produzir métricas/logs agregados de linhas, sucesso, inválidas e duplicidade sem payload, descrição, valor, nome de conta, filename sensível, token ou CSV.
- Classificar erros de validação como resultado esperado, sem ruído no Sentry.
- Adicionar testes/redação para impedir captura acidental de request body.

## Critérios de aceite

- [x] Falha inesperada contém contexto técnico suficiente para diagnóstico.
- [x] Nenhum evento de observabilidade contém dados financeiros brutos ou credenciais.
- [x] Dashboard/log permite acompanhar taxa de êxito e falha apenas por contagens agregadas.

## Subtarefas

- [x] Definir o contrato técnico de observabilidade do fluxo de importação,
  incluindo etapa, operação, resultado, duração, IDs opacos e contagens.
- [x] Implementar redaction/allow-list para logs, métricas, breadcrumbs e
  Sentry sem CSV, bytes, filename, descrição, valor, `external_id`, token ou
  payload de command.
- [x] Instrumentar upload, parse, preview e confirmação: falhas esperadas
  como resultado de domínio; falhas inesperadas com captura best-effort.
- [x] Adicionar testes de agregação, classificação de erros e proteção contra
  captura acidental de request body.
- [x] Validar os gates de T09 e registrar handoff para T06–T08 e T13 sem
  alterar tasks de outros IDs.

## Verificações

- [x] `npm run lint`.
- [x] `npx tsc --noEmit`.
- [x] Testes focados de observabilidade: 18 testes passaram, incluindo os 7
  cenários de T09 em `src/modules/observability/s04.test.ts`.

## Handoff

- T06–T08 devem envolver upload, parse, preview e confirmação com
  `createS04ImportOperation`/`withS04ImportObservability`, passando somente
  `requestId`, IDs de staging/importação, código estável, duração e o objeto de
  contagens; validações devem usar `expected_error` e não chamar captura Sentry.
- T13 deve manter a verificação de redaction contra a allow-list S04 e validar
  que logs/Sentry carregam apenas contagens agregadas, conforme ADR-005.
