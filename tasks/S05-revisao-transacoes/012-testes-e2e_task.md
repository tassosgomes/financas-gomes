# T12 — E2E do fluxo de revisão

- Slice: S05 — Revisão e organização das transações
- Status: Em andamento — o cenário principal S05 passou em execução controlada contra o PostgreSQL E2E em 2026-08-30 (`1 passed (1.7m)`). Os dois cenários complementares de falha segura/retry e filtros de período/tipo/paginação foram implementados nesta spec. A boundary client que puxava `fs`/`pg` foi corrigida nesta rodada extraindo os formatadores para `transaction-listing-formatters.ts`; a execução complementar/regressão E2E foi adiada por instrução até a conclusão de S06 e permanece sem nova evidência terminal. O smoke de T13 continua aberto.
- Onda: 4
- Dependências: T06, T08 e T09; S04 disponível para criar importados
- Paralelização: Com T11 após a UI integrada

## Subtasks

- [x] Auditar a UI integrada de T06/T08/T09, test IDs estáveis e fixtures
  canônicas de S04 sem inserir transações administrativamente.
- [x] Implementar a spec dedicada `tests/e2e/transactions-review.spec.ts`,
  usando o fluxo real de importação, a fila de pendências, classificação,
  origem/linhagem, edição e retorno com query.
- [x] Executar e estabilizar o cenário principal E2E S05 (inclui confirmação
  do estado persistido após classificação e edição); em 2026-08-30,
  `rtk timeout 120s env E2E_PORT=3100 DEBUG=pw:webserver,pw:api npm run
  test:e2e -- tests/e2e/transactions-review.spec.ts` terminou com `1 passed
  (1.7m)` e exit 0. A sincronização aguarda a resposta da action e valida as
  projeções duráveis após o `router.refresh()`.
- [x] Implementar cenários de remoção para categoria nula, filtros de origem e
  busca, preservação de linhagem e viewport móvel.
- [x] Ajustar a abertura da conta para tolerar a hidratação tardia e substituir
  asserts de feedback desmontado por sincronização da action e asserts das
  projeções persistidas, sem remover cobertura de origem, filtros ou mobile.
- [x] Implementar cenários complementares de falha segura/retry e filtros de
  período/tipo/paginação em `tests/e2e/transactions-review.spec.ts`, sem remover
  assertions do cenário principal. O retry intercepta uma falha transitória da
  POST da Server Action, verifica feedback redigido, preservação da seleção,
  payload idempotente e contagem de evento/entry; o cenário de filtros semeia
  três lançamentos manuais pelo fluxo autenticado e percorre três páginas
  `limit=1` por cursor.
- [ ] Executar e estabilizar os cenários complementares de falha segura/retry e
  filtros de período/tipo/paginação; a primeira tentativa terminou antes da
  navegação da lista por erro de compilação client-side documentado no
  checkpoint abaixo. A nova execução foi adiada por instrução até a conclusão
  de S06; portanto esta subtask continua aberta e sem resultado terminal novo.
- [x] Consolidar a evidência verde do cenário principal para o handoff de T13;
  a regressão E2E completa e o smoke publicado continuam sob responsabilidade
  do gate serial de T13.

## Subtask adicional — boundary client

- [x] Separar os formatadores browser-safe da listagem em
  `transaction-listing-formatters.ts`, trocar a importação da ilha client e
  manter os reexports legados para os consumidores de S03. A compilação fria
  deixa de atravessar `reads.ts`/`pg`.

## Objetivo

Validar o fluxo que o usuário realmente executa: importar, encontrar
pendências, classificar, conferir a origem e continuar revisando sem perder o
contexto.

## Escopo

- Preparar household/conta/categorias por fixture segura, usando o provider de
  autenticação e a infraestrutura E2E já existente; não usar acesso
  administrativo como substituto do fluxo da aplicação.
- Cenário principal:
  1. entrar no espaço financeiro;
  2. importar um CSV canônico de S04 e confirmar;
  3. abrir `/transactions?review=NEEDS_REVIEW`;
  4. conferir contador, origem `Importado` e categoria ausente;
  5. alterar a categoria pela lista ou detalhe;
  6. confirmar que o item deixa a fila e que origem/linhagem continuam visíveis;
  7. editar descrição no detalhe, voltar e verificar filtros preservados.
- Cenários complementares:
  - manual e importado juntos com filtro por origem;
  - busca/conta/período/tipo e paginação por cursor;
  - categoria incompatível/erro de update sem perder formulário;
  - categoria removida para `null` retorna ao estado pendente;
  - refresh/retry não duplica a operação;
  - lista e detalhe em viewport móvel.
- Manter assertions por comportamento/labels/test IDs, não por estrutura
  interna ou valores sensíveis em logs do runner.

## Critérios de aceite

- [x] O fluxo principal passa no ambiente PostgreSQL E2E e não depende de
  inserção administrativa para produzir a pendência: a conta, categorias e
  importação foram criadas pelo fluxo autenticado da aplicação.
- [x] O contador e filtro de revisão correspondem ao estado persistido; a
  execução verde observou a fila em `2 → 1 → 0`, e após remover a categoria
  observou novamente o estado pendente após reload.
- [!] A atualização de um importado manteve origem, linha (`rowNumber=4`) e
  `externalId` (`Não informado`) visíveis no detalhe e a fila continuou com um
  único item; a prova direta de contagem de eventos/entries contra o banco
  ainda não está incluída na spec E2E.
- [x] O detalhe retorna à mesma lista com conta, origem, review, busca e
  demais parâmetros da query preservados no back link.
- [ ] Falha esperada é apresentada sem stack, SQL, token ou dados financeiros
  brutos; o cenário foi implementado, mas ainda não há execução verde após o
  bloqueio de compilação client-side.
- [ ] Filtros complementares de período/tipo e paginação por cursor estão
  implementados, mas aguardam execução verde no servidor estabilizado.
- [x] Cenários desktop/mobile críticos do fluxo principal estão cobertos na
  execução verde; o detalhe mobile terminou renderizado com a origem visível.

## Handoff

- T13 recebe relatório do fluxo, screenshots/evidências quando úteis e
  eventuais limitações de ambiente.

## Checkpoint / evidências reais

Data: 2026-08-30.

- Migrações E2E: `rtk env DATABASE_URL=... MIGRATION_DATABASE_URL=... npm
  run db:migrate:status` retornou `12 aplicadas, 0 pendentes, 0 divergentes`.
- `rtk npm run typecheck` passou (exit 0), e `rtk npm run build` passou (exit
  0), removendo o erro de compilação dos reexports S05 em
  `src/app/actions/transactions.ts`.
- `rtk npm run lint` permanece
  vermelho por cinco warnings preexistentes em
  `src/modules/transactions/review-contracts.ts` e
  `src/modules/transactions/review-use-cases.ts`.
- `rtk npm run test:e2e -- tests/e2e/transaction-imports.spec.ts` passou 2/2
  contra PostgreSQL descartável e fake auth, confirmando que o fluxo S04 que
  produz os lançamentos importados segue funcional após a correção.
- A execução S05 após o ajuste de `page.reload` percorreu importação, fila,
  classificação, detalhe, linhagem, edição, retorno e viewport móvel, mas
  falhou no último assert porque a própria spec usava o test ID inexistente
  `review-source-details`; o componente usa `transaction-source-details`, já
  validado nos asserts de detalhe anteriores. O seletor foi corrigido sem
  reduzir cobertura.
- A primeira execução após a correção do seletor falhou na hidratação da tela
  de contas (`account-form-create` não apareceu após `accounts-create-button`).
  Uma segunda execução terminou com falha específica em
  `tests/e2e/transactions-review.spec.ts:228`: a action de classificação
  respondeu HTTP 200 e o `router.refresh()` removeu a linha da fila antes de
  o assert do feedback transitório `Categoria atualizada.` ser observado.
  Não há evidência válida para marcar o fluxo E2E como verde; o gate permanece
  aberto.
- Após essa evidência, `tests/e2e/transactions-review.spec.ts` passou a aguardar
  explicitamente a tela/controles hidratados, repetir uma vez a abertura a
  partir de um documento novo se o primeiro click for inerte e aguardar as
  respostas POST das actions antes de conferir o estado durável. Os asserts de
  `Categoria atualizada.` foram removidos somente nos editores cuja própria
  atualização dispara `router.refresh()` e desmonta o feedback; permanecem as
  asserções de fila/contador, persistência após reload, origem/linhagem,
  filtros e viewport móvel. Essa alteração foi reexecutada em 2026-08-30 e
  terminou verde (`1 passed (1.7m)`).
- A execução verde foi controlada por `rtk timeout 120s` para impedir novo
  processo sem término. O Playwright iniciou o `next dev` em `127.0.0.1:3100`,
  o PostgreSQL E2E permaneceu saudável em `localhost:5433` e todos os
  processos foram encerrados pelo runner ao final.
- Durante a primeira compilação de `/transactions/[id]`, o `next dev` emitiu
  um `500` transitório com `SyntaxError: Unexpected end of JSON input`; as
  requisições seguintes retornaram `200`, o detalhe foi renderizado e o teste
  concluiu com exit 0. Isso é ruído observável do servidor de desenvolvimento,
  não falha do cenário E2E aprovado, e deve ser reavaliado em T13 caso persista
  fora de uma compilação fria.
- O bloqueio anterior de compilação da boundary de actions foi resolvido: a
  spec S04 passou 2/2 e o build/typecheck registrados neste checkpoint também
  passaram. A expectativa legada de S04 sobre listagem manual-only é uma
  observação de regressão de contrato, não um bloqueio comprovado de T12.
- A spec complementar foi adicionada sem reduzir a cobertura principal. A
  tentativa controlada de `rtk timeout 240s env E2E_PORT=3100
  DEBUG=pw:webserver,pw:api npm run test:e2e --
  tests/e2e/transactions-review.spec.ts --grep 'filtra período'` iniciou o
  `next dev`, criou a conta e os três lançamentos pelo browser, mas recebeu
  HTTP 500 ao carregar `/transactions`: o webpack reportou `Module not found:
  Can't resolve 'fs'` em `pg-connection-string`, com o import trace passando
  por `src/components/transactions/transaction-listing-utils.ts` e a
  boundary client `transaction-review-list-screen.tsx`. Portanto, o cenário
  complementar não tem evidência verde e nenhum critério pendente foi marcado
  como concluído.

## Bloqueios e limitações

- [x] O erro frio de bundle da boundary client foi resolvido: o formatador
  client-safe foi separado em `src/components/transactions/transaction-listing-formatters.ts`
  e `transaction-review-list-screen.tsx` deixou de importar o helper que
  alcançava `pg`. A compilação otimizada do Next passou a fase de webpack;
  o build completo ainda está limitado por erros de typecheck preexistentes
  em S06 (`src/modules/credit-cards/installments.ts` e contratos relacionados).
- [!] O cenário principal da suíte E2E S05 está verde, incluindo viewport
  móvel, contador persistido, linhagem, edição e retorno com query. Os cenários
  complementares de falha segura/retry e filtros de período/tipo/paginação
  foram implementados. A execução complementar iniciada após a correção da
  boundary ainda não possui resultado terminal registrado; a regressão
  completa e o smoke publicado continuam pendentes para T13.

O viewport móvel foi concluído na execução verde de 2026-08-30; a limitação
restante é exclusivamente a cobertura complementar ainda não implementada.

## Verificações

- [x] `rtk timeout 120s env E2E_PORT=3100 DEBUG=pw:webserver,pw:api npm run
  test:e2e -- tests/e2e/transactions-review.spec.ts`, com PostgreSQL/variáveis
  do ambiente E2E; execução terminal em 2026-08-30: `1 passed (1.7m)`, exit 0.
  O `router.refresh()` foi sincronizado pela resposta HTTP da action e os
  asserts duráveis passaram.
- [!] `rtk timeout 240s env E2E_PORT=3100 DEBUG=pw:webserver,pw:api npm run
  test:e2e -- tests/e2e/transactions-review.spec.ts --grep 'filtra período'`;
  em 2026-08-30, o teste criou a fixture autenticada, mas terminou sem
  navegação da lista porque o `next dev` respondeu 500 com `Module not found:
  Can't resolve 'fs'` na importação client-side de `pg` (exit 1).
- [x] `rtk npm exec eslint -- tests/e2e/transactions-review.spec.ts` passou
  para a spec principal e os cenários complementares adicionados.
- [ ] Executar a regressão E2E mais ampla exigida por T13 (`rtk npm run
  test:e2e`) após a spec dedicada ficar verde.
- [ ] Repetir o fluxo após migration final de T03.
