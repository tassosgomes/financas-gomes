# T17 — Validação de release do S06

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluído localmente — todos os gates locais passaram em 2026-08-31:
  lint, typecheck, build, unitários (468/468), integração PostgreSQL (93/93
  mais T09 dedicado 6/6), E2E global (12/12), `db:check`, `db:check:files` e
  migrations (16 aplicadas, 0 pendentes, 0 divergentes). Permanecem pendentes
  somente o probe publicado do Sentry com DSN/credenciais e o smoke de deploy,
  ambos externos e sem autorização nesta etapa.
- Onda: 4
- Dependências: T10, T15 e T16; T02 deve ter migration pronta
- Paralelização: Fechamento serial

## Objetivo

Fechar o slice somente quando código, schema, segurança, observabilidade e
fluxo de usuário estiverem prontos para execução controlada.

## Escopo

- Executar lint, typecheck, testes unitários, integração PostgreSQL, E2E e
  build conforme os gates do repositório, registrando comandos e resultados.
- Validar `db:check:files`, migration forward-only em banco limpo e migration
  sobre S01–S03; confirmar zero pendências/drift e nenhum `accounts.balance`.
- Confirmar que migrations são aplicadas pelo pipeline antes do deploy e não
  no boot da aplicação; testar health/readiness quando o schema estiver
  degradado ou indisponível.
- Revisar índices, constraints, FKs compostas, arquivamento e retenção sem
  usar alteração manual de dados para mascarar falhas.
- Rodar smoke controlado: autenticar, cadastrar cartão, registrar compra 1x e
  parcelada, consultar fatura futura, pagar globalmente, editar/cancelar e
  verificar histórico/comprometimento.
- Inspecionar logs, breadcrumbs e Sentry com falhas sintéticas e confirmar
  redaction de valores, nomes, datas financeiras, limite, tokens e payloads.
- Revisar manualmente todos os itens do Definition of Done de `tasks.md` e
  registrar limitações: sem rotativo/juros, sem parcelamento de fatura, sem
  refund parcial e sem pagar parcela isolada.
- Registrar bloqueios externos de publicação, credenciais ou Sentry como
  pendências reais; não marcar smoke publicado como concluído sem evidência.

## Critérios de aceite

- [x] Todos os gates locais e a integração real de PostgreSQL passam; o guard
  do runner padrão de T09 foi acompanhado pela execução dedicada 6/6, sem
  cobertura relevante omitida.
- [x] Migration é reproduzível, controlada e compatível com os slices
  anteriores e com o seed demo que inclui cartão/parcelamento sintético.
- [ ] Smoke publicado, quando autorizado, usa apenas a UI e não requer banco
  ou script administrativo.
- [ ] Observabilidade publicada não contém dados financeiros e falhas esperadas
  não são classificadas como incidentes inesperados.
- [x] Checklist local do S06 tem evidência para cada critério exercitado; os
  únicos itens ainda pendentes são publicação/smoke externo por infraestrutura,
  credenciais e autorização.

## Verificações

- `rtk npm run lint`
- `rtk npm run typecheck`
- `rtk npm test`
- `rtk npm run test:integration`
- `rtk npm run test:e2e`
- `rtk npm run build`
- `rtk npm run db:check:files` e `rtk npm run db:migrate:status`
- Revisão de diff, artefatos de CI/deploy e smoke controlado.

## Subtarefas e evidências incrementais — 2026-08-31

- [x] T17-A — corrigir a fronteira Next `use server`: handlers de projeção em
  `src/app/actions/credit-cards.ts` passaram de reexports diretos para
  wrappers `async`; aliases públicos de cartão, pagamento, compra e projeção
  também passaram a funções assíncronas explícitas. Causa confirmada pelo
  erro do compilador: `Only async functions are allowed to be exported in a
  "use server" file`.
- [x] T17-B — remover imports não utilizados de
  `src/db/financial-events-schema.ts` e `src/modules/transactions/reads.ts`,
  sem alteração de comportamento.
- [x] T17-C — `rtk npm run typecheck` — aprovado após as correções, sem
  diagnósticos.
- [x] T17-D — `rtk npm run lint` — a variável `response` não utilizada foi
  removida do E2E de T16 e a execução global final passou sem erros ou warnings.
- [x] T17-E — `rtk npm run build` — bundle e páginas foram compilados com
  sucesso após a correção dos handlers `use server`.
- [x] T17-F — `rtk npm run db:check:files` — Drizzle reportou “Everything's
  fine”; `rtk npm run db:migrate:status` reportou 16 migrations aplicadas, 0
  pendentes e 0 divergentes.
- [x] T17-G — `rtk npm test -- --reporter=dot` — 72 arquivos/468 testes
  aprovados; os 24 arquivos/99 testes skipped são integrações protegidas pelo
  guard no comando unitário e foram exercitados no runner PostgreSQL dedicado.
- [x] T17-H — `rtk env
  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test
  npm run test:integration` foi concluído com 23 arquivos/93 testes
  aprovados; o arquivo T09 protegido pelo guard foi executado separadamente
  com `T09_INTEGRATION=1` e passou 6/6. A correção T02-F restringe a asserção
  aos households dos fixtures sem afrouxar a expectativa de quatro regras.
  Integração PostgreSQL aprovada.
- [x] T17-I — gate técnico pós-T14: `billing-screen.tsx` mantém `useRouter`
  como import explícito de `next/navigation`; `rtk npm run typecheck` e lint
  focado da rota/actions passaram. `rtk npm run build` passou na segunda
  execução após uma falha transitória de chunk gerado em `.next` (`./6141.js`),
  sem bloqueio reproduzível de Server Action.
- [x] T17-J — a execução agregada confirmou as suítes S06 habilitadas:
  `credit-cards.integration.test.ts` (5), `purchase-use-cases.integration.test.ts`
  (4), `use-cases.integration.test.ts` (3) e `projections.integration.test.ts`
  (4); 16 testes passaram no banco descartável. O guard deliberado de T09 foi
  acompanhado pela suíte dedicada 6/6, portanto não há pendência local de
  integração.
- [x] T17-K — correção mínima em `src/modules/transactions/use-cases.ts`:
  `assertManualEventCanUpdate/Cancel` agora precede `assertCreatedEvent`,
  preservando `EVENT_NOT_MANUAL` para reversal e demais eventos não manuais.
  Verificação focalizada de T07: 1 arquivo/4 testes aprovados; na integração
  agregada, `maintenance.integration.test.ts` também passou 4/4.
- [x] T17-N — correção mínima de isolamento em
  `src/db/credit-cards.integration.test.ts`: a leitura final de T02-F agora
  inclui `where(inArray(creditCardBillingRules.householdId, HOUSEHOLD_IDS))`.
  O teste focalizado passou 5/5 e a integração agregada passou 23/23 arquivos.
- [x] T17-O — superseded by the final gate below: `rtk npm run lint` global
  passou após a remoção da variável `response` não utilizada em T16.
- [x] T17-L — smoke local do endpoint `/api/observability/test` executado com
  `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` vazios: token inválido retornou 404 e
  token válido retornou 503 `sentry_not_configured`, sem envio para Sentry.
  Os testes da rota e da suíte de observabilidade passaram (7 arquivos/33
  testes).
- [ ] T17-M — probe com DSN configurado, inspeção de evento publicado e revisão
  de logs/breadcrumbs no projeto Sentry correto exigem ambiente de deploy,
  credenciais e autorização externa; permanecem pendentes sem mascarar o
  resultado local.
- [x] T17-N — superseded by T17-U and the final E2E gate below: a suíte limpa
  confirmou cadastro, regra, compras 1x/3x, projeções, pagamentos globais,
  edição, cancelamento e isolamento; não houve publicação/deploy.
- [x] T17-P — A extração de `purchaseScheduleViewModel` para
  `src/components/credit-cards/purchase-schedule-view-model.ts` removeu o
  blocker Server Component/client boundary; a rota agora importa o módulo
  server-safe e os testes focados do adapter/detalhe passaram (2 arquivos/6
  testes). A repetição E2E avançou até a edição de metadata.
- [x] T17-Q — superseded by T17-R/U: the metadata expectation now matches
  `Dados da compra atualizados.`, and the complete E2E including cancellation
  and Household B isolation passed; no release/deploy was performed.

## Correção e handoff T16 — 2026-08-31

- [x] T17-R — `tests/e2e/credit-cards.spec.ts` foi executado integralmente com
  `rtk env PLAYWRIGHT_REUSE_SERVER=true E2E_PORT=3200
  ./node_modules/.bin/playwright test tests/e2e/credit-cards.spec.ts
  --reporter=line`: **2/2 passaram**. A expectativa foi alinhada à mensagem
  publicada `Dados da compra atualizados.`, e o caso confirmou edição,
  cancelamento agregado, histórico preservado e ausência de pagar parcela.
- [x] T17-S — o warning de variável `response` não usada foi removido do teste;
  lint focado, lint global, typecheck e build passaram no fechamento final.
- [x] T17-T — superseded by T17-U: Household B is now materialized by the
  strict synthetic identity fixture and its real card is rejected in A's
  authenticated context. No administrative writes, publication or deploy.

- [x] T17-U — T16-A/F/G foram efetivados: o provedor E2E agora aceita somente
  identidades sintéticas `e2e-*@example.test` via `login_hint` validado no
  endpoint local; a suíte cria cartão real B em contexto separado e confirma
  no contexto A boundary 404 sem tela/dados do cartão. Comando
  `rtk ./node_modules/.bin/playwright test tests/e2e/credit-cards.spec.ts
  --reporter=line` passou **2/2 em 2,4 min** em processo novo após uma primeira
  inicialização que excedeu timeout apenas no aquecimento de compilação.
- [x] T17-V — superseded by the final gate below: typecheck, lint global e
  build foram executados após os ajustes de T16 e passaram; não houve
  publicação/deploy.

## Fechamento local final — 2026-08-31

- [x] `rtk npm run lint` — exit 0, sem erros ou warnings.
- [x] `rtk npm run typecheck` — exit 0, sem diagnósticos TypeScript.
- [x] `rtk npm test -- --reporter=dot` — 72 arquivos/468 testes passaram; os
  24 arquivos/99 testes skipped são integrações protegidas pelo guard e não
  substituem a execução PostgreSQL abaixo.
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm run test:integration -- --reporter=dot` — 23 arquivos/93 testes passaram; o único arquivo protegido foi T09.
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test T09_INTEGRATION=1 ./node_modules/.bin/vitest run src/modules/credit-cards/purchase-maintenance.integration.test.ts --config vitest.integration.config.mts --reporter=dot` — T09 passou 1 arquivo/6 testes.
- [x] `rtk npm run build` — exit 0; Next.js compilou e gerou todas as rotas sem erro de tipo/lint.
- [x] `rtk npm run db:check` e `rtk npm run db:check:files` — exit 0; schema/migrations consistentes (`Everything's fine`).
- [x] `rtk env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/financas_gomes_test npm run db:migrate:status` — 16 migrations aplicadas, 0 pendentes e 0 divergentes.
- [x] `rtk env E2E_PORT=3117 E2E_NEXT_DIST_DIR=.next-e2e-final npm run test:e2e -- --reporter=line` — 12 testes passaram em 8,2 min, em processo limpo; inclui T16 crítico e a autenticação/isolamento A/B.
- [ ] Probe Sentry publicado com DSN, inspeção de evento/breadcrumb e smoke de deploy — dependem de credenciais, projeto/ambiente externo e autorização de publicação; não houve deploy.

## Fora de escopo

Publicar sem credenciais/autorização, fazer migration manual em produção,
copiar dados reais para fixtures ou declarar o slice pronto apenas porque o
build local passou.
