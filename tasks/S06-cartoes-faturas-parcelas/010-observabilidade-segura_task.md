# T10 — Observabilidade segura do fluxo de cartões

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluída tecnicamente — contrato, redaction, classificação, wrapper
  comum S06 e integração T14-E verificados em 2026-08-31; a validação de
  release/publicação permanece no gate downstream T17.
- Onda: 1
- Dependências: T01
- Paralelização: Com T02–T09; deve ser integrado antes de T17

## Objetivo

Operar falhas de cartão, billing, compra, projection e pagamento sem enviar
valor, descrição ou outros dados da vida financeira para logs, breadcrumbs,
métricas ou Sentry.

## Escopo

- Definir vocabulário estável de operações e etapas, por exemplo
  `credit_card.create`, `credit_card.billing_rule.update`,
  `credit_card.purchase.create`, `credit_card.statement.read`,
  `credit_card.payment.create` e `credit_card.purchase.cancel`.
- Instrumentar falhas inesperadas com request/correlation ID, household/card/
  purchase/event ID opacos, etapa, código técnico, resultado e duração; não
  incluir payload financeiro.
- Tratar erros de validação, conflito, duplicidade e cartão arquivado como
  resultados esperados, sem capturá-los como exceções inesperadas.
- Aplicar allow-list/redaction em logs, Sentry, breadcrumbs e métricas para
  remover amount, descrição, nome do cartão/conta, merchant, datas financeiras
  detalhadas, limite, tokens, cookies e payload completo.
- Registrar somente contagens agregadas úteis — quantidade de parcelas,
  itens da fatura ou duração — se T01 aprovar que não reconstituem a vida
  financeira; preferir IDs e categorias técnicas.
- Cobrir actions, use cases e queries sem duplicar instrumentação no client.

## Critérios de aceite

- [x] Erro inesperado de cada etapa tem contexto técnico suficiente para
  diagnóstico e um ID de correlação; `withS06CreditCardObservability` gera o
  ID quando a boundary não fornece um e preserva IDs opacos de cartão,
  compra, pagamento e household.
- [x] Erros esperados retornam envelope estável e não geram ruído de Sentry.
- [x] Testes de redaction comprovam ausência de valor, descrição, nome de
  conta/cartão, limite, data de compra, token e payload financeiro.
- [x] Não há log de SQL/payload que permita reconstruir uma fatura real; a
  allow-list de `sanitizeS06CreditCardLog`, breadcrumbs e `measureS06Query`
  retém somente operações, IDs opacos, duração e contagens limitadas.
- [x] T05–T09 usam o adaptador comum; a suíte PostgreSQL T09 registrou somente
  operações, resultados, duração, request IDs e IDs opacos, sem amount,
  descrição ou payload financeiro. A verificação publicada do contrato fica
  para T17.

## Subtarefas

- [x] Definido vocabulário fechado de operações/etapas S06, incluindo cartão,
  regra de billing, compra, parcelas, projeções, fatura e pagamento.
- [x] Implementado contexto técnico com request/correlation ID e IDs opacos de
  household, cartão, compra, evento, plano, parcela, regra e pagamento.
- [x] Implementada allow-list para logs, breadcrumbs, métricas e contexto
  Sentry, com contagens agregadas limitadas e sem payload financeiro.
- [x] Implementada classificação de erros esperados versus falhas técnicas,
  envelope estável e captura best-effort somente para falhas inesperadas.
- [x] Adicionados testes focados de redaction, classificação, envelope,
  breadcrumb, contexto Sentry, wrapper de `Result`, exceção técnica e query
  lenta (`src/modules/observability/s06.test.ts`, 10 testes).
- [x] Integrar o adaptador comum nos use cases/actions/queries T05–T09 — T05,
  T06, T07 e T08 concluídos; T09 usa o wrapper em
  `purchase-use-cases.ts`/actions com as operações de metadata/cancelamento e
  a integração PostgreSQL confirmou os envelopes esperados.
- [ ] Validar contrato integrado no release T17 e revisar eventos publicados.

## Handoff

- T15 inclui os testes de classificação e redaction na suíte do slice.
- T17 revisa logs locais/publicados e configuração do Sentry sem dados reais.

## Verificações

- [x] `rtk npm test -- --run src/modules/observability/s06.test.ts` — 10
  testes passaram em 2026-08-31.
- [x] Testes unitários de allow-list, redaction e classificação esperada/
  inesperada: `rtk npm test -- --run
  src/modules/observability/s06.test.ts src/modules/observability/sanitize.test.ts
  --reporter=dot` — 16 testes passaram em 2026-08-31.
- [x] Busca estática em `src/modules/observability/s06.ts` confirmou que
  campos financeiros, mensagem de exceção, SQL e payload só aparecem em
  comentários/test fixtures; o registro emitido é reconstruído pela
  allow-list.
- [x] T05: criação/edição/arquivamento e versionamento de billing passam pelo
  wrapper comum `withS06CreditCardObservability`; nenhum payload financeiro é
  enviado ao contexto de observabilidade (typecheck passou em 2026-08-31).
- [x] T06: `credit_card.purchase.create` passa pelo wrapper comum; integração
  PostgreSQL confirmou sucesso, erro esperado, cross-tenant e falha técnica
  com redaction (4/4 em 2026-08-31).
- [x] T08: `createPayment`/`registerCreditCardPaymentAction` passam pelo wrapper
  `withS06CreditCardObservability` com operação `credit_card.payment.create`;
  somente IDs técnicos de contexto são oferecidos, sem valor, descrição, data
  ou payload.
- [x] T09: update/cancel usam o wrapper comum com
  `credit_card.purchase.update_metadata` e `credit_card.purchase.cancel`; os 6
  testes PostgreSQL confirmaram sucesso, erro esperado e falha técnica com
  contexto contendo somente IDs opacos e household/user.
- [x] T07: `projections.ts` usa `withS06CreditCardObservability` na boundary e
  `measureS06Query` nas consultas de cartão, parcelas, pagamentos e posição;
  integração PostgreSQL confirmou sucesso e cross-tenant esperado sem valores,
  descrições, datas ou SQL nos registros.
- [x] Build da boundary T07: a composição dos handlers foi aceita no gate T17;
  projections/actions seguem server-side.
- [x] T09: `purchase-maintenance.integration.test.ts` executou 6 cenários
  PostgreSQL de update/cancel, rollback, corrida, retry, cross-tenant,
  reversal, pagamento e T07; logs emitidos permaneceram allow-listed.
- [x] T14: `billing-screen.tsx` consome somente o mapa de erros allow-listed e
  os actions T07/T08 já instrumentados; não adiciona instrumentação no client.
- [x] T14-E: o read boundary de compra em `purchase-use-cases.ts` usa o wrapper
  comum com `credit_card.purchase.read`, a Server Action mantém household/auth
  fora do payload e `purchase-detail-screen.tsx` usa feedback allow-listed sem
  instrumentação client; rota, 4 testes específicos, lint, typecheck e build
  foram verificados.
- [x] Revisão contra ADR-007: as operações S06 permanecem fechadas, os
  boundaries T05–T09 usam somente contexto técnico e a sanitização Sentry
  remove payload/SQL/mensagens; contextos numéricos agora também passam por
  allow-list explícita, impedindo chaves financeiras como `amountCents` e
  `limitCents`.
- [x] `rtk npx tsc --noEmit --pretty false --incremental false` — sem erros após
  a integração T14; o lint focado dos arquivos novos também passou.
- [x] `rtk npm test -- --run src/modules/observability
  src/app/api/observability/test/route.test.ts --reporter=dot` — 7 arquivos e
  33 testes passaram em 2026-08-31, incluindo redaction S06, configuração
  Sentry e probe controlado.
- [x] Smoke local sem deploy: com `SENTRY_DSN` e
  `NEXT_PUBLIC_SENTRY_DSN` explicitamente vazios, o endpoint retornou 404 para
  token inválido e 503 `sentry_not_configured` para token válido; nenhum evento
  foi enviado a serviço externo.
- [x] Lint focado dos módulos de observabilidade e da rota de probe, além de
  `rtk npm run typecheck`, passou após o hardening da allow-list.
- [!] `rtk npm run lint` global — o código T10 continua sem erros, mas a
  execução atual encontra um warning preexistente em
  `tests/e2e/credit-cards.spec.ts:340`, fora do escopo T10 e não alterado para
  preservar T16; a verificação publicada e revisão de eventos continuam no
  gate downstream T17.

## Fora de escopo

Dashboard financeiro, tracing distribuído, Redis/rate limiting preventivo e
telemetria com dados reais.
