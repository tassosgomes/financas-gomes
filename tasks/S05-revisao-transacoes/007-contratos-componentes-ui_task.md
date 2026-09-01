# T07 — Contratos e componentes base de UI

- Slice: S05 — Revisão e organização das transações
- Status: Em andamento (componentes e interação verificados; integração/E2E do slice permanece fora deste gate)
- Onda: 1
- Dependências: T01 e T02; componentes compartilhados de S02/S03
- Paralelização: Com T03–T06

## Objetivo

Preparar pequenas ilhas reutilizáveis para filtros, origem, pendência e edição
de categoria sem colocar dados financeiros ou regra de tenancy no browser.

## Subtasks

- [x] **Leitura, alinhamento documental/ADR e inspeção de contratos existentes:**
  alinhar a task ao ADR-006, aceito e fonte de verdade, e inspecionar os
  contratos de T02 em `src/modules/transactions/review-contracts.ts` e
  `src/modules/transactions/review-contracts.test.ts`, sem alterá-los.
- [x] **Parser/encoder dos filtros canônicos:** implementar e testar a leitura
  e a reemissão de `from`, `to`, `accountId`, `categoryId=__none`, `kind`,
  `status`, `origin`, `review`, `search`, `limit` e `cursor`, ignorando valores
  inválidos com aviso seguro e preservando os valores válidos.
- [x] **Preservação da query:** garantir que links de detalhe, voltar, próxima
  página e ação de revisão reemitam a query canônica completa, mantendo filtros,
  busca e cursor sem aceitar ou confundir `householdId` com cursor.
- [x] **Badges e labels:** definir e renderizar os badges/labels de origem
  (`Manual`, `Importado`), estado (`Revisar`, `Organizado`) e categoria ausente,
  com texto acessível e sem inferir pendência diferente do read model.
- [x] **Contratos de componentes:** formalizar os contratos serializáveis de
  `ReviewSummary`, `SourceDetails` e `CategoryQuickEdit`, incluindo categorias
  carregadas pelo Server Component, action tipada/serializável e somente os
  campos editáveis permitidos.
- [x] **Estados acessíveis e test IDs:** cobrir estados idle/loading/sucesso/
  erro/disabled, prevenção de submit duplicado, navegação por teclado, labels,
  `aria-live` nos feedbacks e test IDs estáveis para testes de componente/E2E.
- [x] **Testes e verificações:** criar testes unitários para parser/encoder,
  preservação de query, badges, contratos e renderização dos estados; executar
  `rtk npm run lint` e `rtk npm run typecheck`, registrando evidências e
  bloqueios.

## Escopo

- Definir parser/encoder de `searchParams` para os filtros canônicos: período,
  conta, categoria/`__none`, tipo, status, origem, `review`, `search`, limite e
  cursor. Valores inválidos devem ser ignorados com aviso seguro, mantendo os
  filtros válidos.
- Preservar a query completa em links de detalhe, voltar, próxima página e
  ação de revisão; cursor não deve ser confundido com `householdId`.
- Criar badges/labels de origem (`Manual`, `Importado`), estado (`Revisar`,
  `Organizado`) e categoria ausente, com texto acessível.
- Criar contrato para `ReviewSummary`, `SourceDetails` e `CategoryQuickEdit`:
  opções recebem somente categorias já carregadas pelo Server Component e o
  update recebe uma action tipada/serializável.
- Reusar `MoneyInput`, `DateInput`, `DataTable`, `ResourceList` e estados
  compartilhados de S03 quando possível; não introduzir store global ou fetch
  geral no client.
- Definir estados idle/loading/sucesso/erro/disabled, prevenção de submit
  duplicado e test IDs estáveis para testes de componente/E2E.
- Garantir que categorias sejam filtradas por `kind` e que opção arquivada não
  seja oferecida para classificação nova, embora a categoria arquivada atual
  possa ser exibida como histórico.

## Critérios de aceite

- [x] A mesma query canônica pode ser lida da URL e reemitida sem perder
  origem, review, busca ou cursor.
- [x] Parser de UI nunca aceita `householdId` nem trata origem como autoridade;
  a action continua responsável pela validação.
- [x] Item sem categoria tem indicação clara e o editor permite selecionar
  categoria compatível ou manter `null`.
- [x] Componentes funcionam em desktop/mobile e são acessíveis por teclado,
  labels e `aria-live` nos feedbacks.
- [x] O contrato não força otimisticamente uma categoria antes do resultado
  do servidor quando isso poderia esconder erro de tenant/estado.

## Handoff

- T08 recebe `TransactionReviewBadges`, `ReviewSummary` e
  `CategoryQuickEdit`; a integração com a action real e a query permanece
  pendente.
- T09 recebe `SourceDetails` e `CategoryQuickEdit`; back-link e parser/encoder
  continuam sendo responsabilidade da integração da tela.
- T12 recebe os test IDs estáveis, estados idle/loading/success/error e
  feedbacks acessíveis para o fluxo Playwright; os testes de interação ainda
  não foram executados neste ambiente.
- T02 deve permanecer intocado; os contratos existentes em
  `src/modules/transactions/review-contracts.ts` e
  `src/modules/transactions/review-contracts.test.ts` não fazem parte da
  implementação T07.

## Checkpoint / evidências reais

Data: 2026-08-30.

- ADR-006 está `Aceito` e é a fonte de verdade.
- T02 concluiu; existem `src/modules/transactions/review-contracts.ts` e
  `src/modules/transactions/review-contracts.test.ts`. Eles não foram
  alterados pela T07.
- O parser/encoder foi publicado em
  `src/components/transactions/transaction-review-query.ts`, cobrindo os
  filtros canônicos e links com query preservada.
- T07-B criou `transaction-review-badges.tsx` com `TransactionReviewBadges`,
  `SourceDetails`, `ReviewSummary` e contratos de props pequenos, baseados
  somente em valores do read model. O parser não foi alterado nem auditado.
- T07-B criou `category-quick-edit.tsx` com categorias carregadas por props,
  filtro por `kind`, opção `Sem categoria`, histórico arquivado desabilitado,
  command serializável (`commandId`, `financialEventId`, `categoryId`),
  estados acessíveis e bloqueio de submit duplicado.
- `src/components/transactions/transaction-listing-utils.ts` continua
  S03/manual-only, força `origin=MANUAL` e não cobre `review`, `search`,
  `limit` ou `cursor`; permanece fora das alterações T07.
- A interação real do client foi coberta em
  `src/components/transactions/transaction-review-interactions.test.tsx` com
  ambiente `jsdom`; o teste verifica double submit, estado loading, erro,
  retry e rotação/reuso de `commandId`.
- `rtk npm run typecheck` — concluído com exit 0 após os componentes T07-B.
- A preservação foi integrada em `reviewQueryHref`: detalhe, back-link e
  paginação reemitem a ordem canônica completa (`from`, `to`, `accountId`,
  `categoryId`, `kind`, `status`, `origin`, `review`, `search`, `limit` e
  `cursor`), descartando `householdId`. `transaction-review-query.test.ts` e
  `transaction-review-components.test.tsx` verificam a reemissão.
- `transaction-review-components.test.tsx` cobre badges manual/importado,
  origem segura, resumo, lista desktop/mobile, empty states e opções de
  quick-edit compatíveis.
- `rtk npm test -- --run src/components/transactions/transaction-review-components.test.tsx`
  — exit 0 (5 testes).
- `rtk npm test -- --run src/components/transactions/transaction-review-interactions.test.tsx`
  — exit 0 (3 testes de interação).
- `rtk npm test -- --run src/components/transactions/transaction-review-components.test.tsx src/components/transactions/transaction-review-query.test.ts src/components/transactions/transaction-review-interactions.test.tsx`
  — exit 0 (12 testes).
- `rtk npm run lint` — exit 0 (sem warnings).
- O worktree não tem baseline Git rastreável: os arquivos aparecem como `??`;
  a auditoria de escopo fica limitada à inspeção de caminhos e listagem.

## Bloqueios e limitações

- Integração pendente: T06 ainda precisa fornecer a action real de update;
  T08/T09 devem conectar a action aos componentes T07-B e preservar o contexto
  da query na navegação.
- Limitação de testes de interação: o ambiente principal usa Vitest em Node e
  não possui Testing Library, JSDOM ou happy-dom. Isso limita a execução de
  testes de interação, mas não constitui evidência para marcar a task como
  concluída.

## Verificações

- [x] Testes unitários do parser/encoder e renderização de estados — parser,
  links, badges e estados iniciais cobertos; `transaction-review-interactions.test.tsx`
  cobre loading/success/error, double submit e retry com `commandId`.
- [x] `rtk npm run lint` — exit 0.
- [x] `rtk npm run typecheck` — exit 0.
