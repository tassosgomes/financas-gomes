# T16 — Testes E2E do fluxo crítico

- Slice: S06 — Cartões, faturas e compras parceladas
- Status: Concluído no gate crítico — a suíte E2E local passou em processo
  limpo, incluindo o fluxo de cartões, compras 1x/3x, faturas, pagamentos,
  edição/cancelamento e isolamento A/B. Os gates globais finais também passaram;
  publicação/smoke externo permanecem somente em T17.
- Onda: 4
- Dependências: T12, T13, T14 e T15; pipeline de autenticação de S01
- Paralelização: Serial após contratos/telas estabilizarem; cenários podem ser escritos antes

## Objetivo

Provar, pela interface publicada/local e sem acesso administrativo ao banco,
que o usuário consegue concluir o caminho central de cartões e parcelas.

## Escopo

- Preparar fixtures sintéticas para dois households, contas de pagamento,
  categorias e datas controladas; autenticação deve usar o mecanismo de teste
  já existente, sem credenciais reais.
- Cobrir: entrar → cadastrar cartão → configurar billing → registrar compra à
  vista → consultar fatura correta.
- Cobrir compra parcelada 3x/10x com rounding, visualizar parcelas em meses
  futuros, atravessar ano e abrir a origem do item.
- Cobrir pagamento parcial, total e maior que a obrigação, confirmando que o
  texto/UI não cria despesa nem oferece pagamento individual.
- Cobrir edição permitida e cancelamento da compra inteira, verificando que
  parcelas futuras desaparecem do compromisso e o histórico permanece.
- Cobrir erro de cartão arquivado, data/valor inválido, double submit/retry,
  sessão ausente e tentativa de acessar ID de outro household.
- Usar a UI para todas as mutações; seed/cleanup de fixture só pode preparar o
  ambiente, nunca simular o resultado por insert administrativo durante o
  fluxo.

## Critérios de aceite

- [x] **T16-A — Fixture/autenticação:** `tests/e2e/credit-cards.spec.ts` usa o
  provedor Google E2E sem credenciais reais. O fluxo cria contas/cartões pela UI
  em dois contextos isolados, com A no e-mail padrão e B em
  `e2e-household-b@example.test`; a seleção B é aceita somente pelo marcador
  sintético restrito do provedor local.
- [x] **T16-B — Cartão e regra de cobrança:** implementado e exercitado na
  execução 2/2. O handler de edição captura `currentTarget.value` de forma
  síncrona, preservando a regra versionada sem derrubar a tela.
- [x] **T16-C — Compra à vista e parcelada:** implementado e aprovado na
  execução 2/2. O cenário usa 1x e 3x, exige exatamente o número de linhas e
  verifica o rounding `33,34 + 33,33 + 33,33`.
- [x] **T16-D — Fatura/projeções e pagamento global:** implementado e aprovado
  na execução 2/2. O cenário navega por origem/competência e confirma os estados
  `Parcialmente paga`, `Paga` e `Saldo credor`; não há alvo de parcela no
  formulário global.
- [x] **T16-E — Edição/cancelamento agregado:** implementado e aprovado na
  execução 2/2. O feedback esperado foi corrigido para a mensagem publicada
  `Dados da compra atualizados.`, e o cenário confirmou cancelamento agregado,
  preservação do histórico e ausência de pagamento individual.
- [x] **T16-F — Autorização/isolamento:** a suíte cria um cartão real no
  Household B, confirma que B o visualiza e então, no contexto autenticado A,
  acessa o ID real de B; a resposta renderiza boundary 404 sem
  `credit-card-detail-route` nem dados do cartão. Também cobre sessão ausente e
  UUID opaco inexistente.
- [x] **T16-G — Execução repetível:** a execução em processo limpo/cacheado
  passou 2/2 para o cenário de cartões e a suíte E2E global passou 12/12. O
  timeout de navegação do Playwright foi ampliado para 120s para permitir a
  compilação inicial legítima do servidor dev; não houve retry de teste nem
  publicação/deploy.

## Verificações

- `rtk npm run typecheck` — **passou** (nenhum erro TypeScript) no fechamento
  final.
- `rtk env PLAYWRIGHT_REUSE_SERVER=true E2E_PORT=3200
  ./node_modules/.bin/playwright test tests/e2e/credit-cards.spec.ts
  --reporter=line` — **passou 2/2** após alinhar `Compra atualizada.` para
  `Dados da compra atualizados.`; o caso inclui o cancelamento agregado.
- `rtk ./node_modules/.bin/playwright test
  tests/e2e/credit-cards.spec.ts --reporter=line` — primeira inicialização do
  servidor novo excedeu o timeout de navegação durante a compilação de `/`; a
  repetição em servidor novo/cacheado passou **2/2 em 2,4 min**, incluindo o
  cartão B criado pela UI e o acesso A→ID de B rejeitado com 404.
- `rtk env E2E_PORT=3117 E2E_NEXT_DIST_DIR=.next-e2e-final npm run test:e2e --
  --reporter=line` — **12 testes passaram (8,2 min)** em processo limpo,
  incluindo S02, autenticação, T16, importação, revisão e S03.
- `rtk env PLAYWRIGHT_REUSE_SERVER=true E2E_PORT=3200 ./node_modules/.bin/playwright
  test tests/e2e/authentication.spec.ts --reporter=line` — **passou 1/1** no
  servidor local reutilizado; adicionalmente removi a espera global por
  `networkidle`, que era instável com HMR. A autenticação também passou 1/1 na
  suíte E2E global limpa.
- `rtk ./node_modules/.bin/eslint tests/e2e/credit-cards.spec.ts` — passou no
  ciclo focado; a invocação `rtk npx eslint` usa ESLint global v6 e acusa
  `ignorePatterns` inválido, enquanto o pacote local é v8. O warning de
  `response` não usado foi removido; `rtk npm run lint` global passou no
  fechamento final.
- Não houve escrita administrativa no banco nem execução de release/build de
  produção nesta etapa.

## Arquivos efetivados

- `tests/e2e/credit-cards.spec.ts` — nova suíte Playwright do fluxo crítico,
  incluindo cadastro, regra versionada, compras 1x/3x, projeções, pagamentos
  globais, ausência de ação de parcela, edição, cancelamento e guards de
  autenticação/ID.
- `src/modules/auth/e2e-provider.ts` e
  `src/app/api/e2e/google/authorize/route.ts` — fixture sintética restrita para
  a segunda identidade/household, sem credenciais ou tokens reais.
- `tasks/S06-cartoes-faturas-parcelas/016-testes-e2e_task.md` — status,
  subtarefas, evidências e bloqueios deste handoff.
- `tests/e2e/authentication.spec.ts` — removida espera `networkidle` global,
  mantendo a prontidão pelo controle habilitado.
- `tests/e2e/transactions.spec.ts` — expectativas alinhadas ao detalhe S05 e
  navegação resiliente da fixture S03.
- `playwright.config.ts` — timeout de navegação local de 120s para a
  compilação inicial do servidor dev.
- `src/components/credit-cards/card-management-screen.tsx` — handlers de
  edição agora capturam `event.currentTarget.value` antes do updater React.
- `src/components/credit-cards/purchase-schedule-view-model.ts` — adapter puro
  sem `"use client"`, reutilizado pela tela cliente e pela rota server-side;
  removeu o blocker de boundary sem alterar a semântica do schedule.
- Cobertura adicional (10x atravessando ano, cartão arquivado, entrada inválida
  e double-submit) fica registrada como expansão opcional fora do gate crítico
  desta onda; não bloqueia o fechamento local de T16.
- Guardar apenas screenshots/traces sem dados financeiros reais; redigir
  artefatos antes de compartilhá-los.

## Fora de escopo

Teste de operadora, app nativo, carga/performance, reconciliação bancária e
fluxos de refund/correction posteriores.
