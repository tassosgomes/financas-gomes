# T10 — Observabilidade e contrato de consultas lentas

- Slice: S05 — Revisão e organização das transações
- Status: Concluída
- Onda: 1
- Dependências: T01; infraestrutura de observabilidade de S01–S04
- Paralelização: Com T02–T09; integração final com T04–T06

## Objetivo

Tornar falhas de listagem/update operáveis e permitir detectar regressão de
performance sem registrar a vida financeira do usuário.

## Subtasks

- [x] Inventariar a infraestrutura de observabilidade existente e definir a
  API dedicada de S05 sem alterar consumidores atuais.
- [x] Implementar contexto de operação, request/duração/resultado e IDs
  opacos para list/summary/detail/update.
- [x] Implementar allow-list/redaction e classificação de
  `expected_error` versus exceção técnica inesperada.
- [x] Implementar medição de query lenta com threshold configurável e código
  de query sem SQL interpolado ou dados financeiros.
- [x] Adicionar testes dedicados de redaction, classificação e slow query.
- [x] Documentar EXPLAIN controlado, política de dados e instruções de
  integração para T04–T06.
- [x] Executar as verificações locais disponíveis, auditar o escopo exclusivo e
  fechar o handoff com evidências.

## Escopo

- Definir operações/etapas para `transactions.review.list`,
  `transactions.review.summary`, `transactions.review.detail` e
  `transactions.review.update` (ou nomes equivalentes), com request ID,
  duração, resultado e IDs opacos.
- Classificar erro de filtro, cursor, categoria, estado e command como
  `expected_error`; capturar no Sentry somente exceções técnicas inesperadas.
- Aplicar allow-list a logs, breadcrumbs, métricas e Sentry: operação, etapa,
  duração, código de erro, origem/tipo agregados, tamanho da página e contagens
  agregadas podem ser enviados. Não enviar valor, descrição, busca, nome de
  conta/categoria, external ID, filename, CSV, token, cookie, Authorization ou
  command payload.
- Instrumentar duração de query e registrar/medir consultas acima de um
  threshold configurável, sem interpolar SQL/valores financeiros no log.
- Documentar como rodar `EXPLAIN ANALYZE` em ambiente controlado para T03/T11;
  plano detalhado não deve ser enviado ao Sentry de produção.
- Revalidar redaction quando o read model ganhar `source`/linhagem, evitando
  que `externalId` ou descrição sejam serializados em contexto de erro.

## Critérios de aceite

- [x] Falha técnica de list/update possui contexto suficiente para diagnóstico
  sem payload financeiro.
- [x] Erros esperados não geram ruído no Sentry e retornam envelope seguro.
- [x] Logs não contêm `search`, descrição, valor, nomes, external ID, cursor
  decodificado ou tokens; cursor pode aparecer apenas como presença/tamanho ou
  ID opaco se a política aprovar.
- [x] Há teste automatizado de redaction e de classificação das operações.
- [x] Há uma forma documentada de identificar query lenta e relacioná-la a
  operação/tenant de teste sem coletar dados do usuário.

## Handoff

- T04 envolve reads com medição de duração e códigos de query.
- T05/T06 envolvem update com IDs e resultado sanitizado.
- T11 valida redaction e planos; T13 revisa a configuração do ambiente de
  release.

## Verificações

- [x] Testes focados de observabilidade/redaction.
- [ ] `rtk npm run lint` — executado, mas ainda falha por seis warnings em
  `src/modules/transactions/review-contracts.ts`, fora do escopo exclusivo da
  T10 (`normalizeAbsoluteCents`, `normalizeSignedCents`,
  `normalizeExternalId`, `_limit`, `_cursor` e `_review` não utilizados).
- [x] `rtk npm run typecheck` — concluído sem erros.
- [x] `rtk npm exec eslint -- src/modules/transactions/observability-s05.ts
  src/modules/transactions/observability-s05.test.ts` — concluído sem warnings.
- [x] `rtk npm test` — 47 arquivos passaram, 15 de integração foram pulados
  por configuração, total de 320 testes passados e 58 pulados.
- [ ] Revisão manual de eventos capturados pelo endpoint/test harness de
  observabilidade — não executada: depende de DSN/token Sentry configurados
  externamente; os testes locais cobrem a fronteira com mocks e redaction.
