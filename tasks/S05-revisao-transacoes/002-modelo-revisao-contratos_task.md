# T02 — Modelo de revisão e contratos serializáveis

- Slice: S05 — Revisão e organização das transações
- Status: Concluída
- Onda: 1
- Dependências: T01; contratos de S03/S04
- Paralelização: Com T03, T07 e T10

## Subtasks

- [x] Consolidar as regras de origem, revisão, linhagem e segurança com T01/S03/S04.
- [x] Implementar os contratos serializáveis de lista, detalhe, query, paginação, resumo, update e erros.
- [x] Implementar e testar cursor opaco com hash dos filtros canônicos e limite.
- [x] Criar testes unitários focados para schemas, limites, cursor, categoria nula, origem e commands.
- [x] Executar typecheck e testes focados; registrar evidências e bloqueios.

## Objetivo

Criar os tipos compartilhados que permitem que backend, Server Actions e UI
tratem lançamentos manuais e importados com o mesmo fluxo de revisão.

## Escopo

- Definir `ReviewableTransactionOrigin = MANUAL | IMPORT` e evitar que
  `SYSTEM`/`REVERSAL` atravessem o contrato da fila.
- Definir `TransactionReviewState = NEEDS_REVIEW | ORGANIZED |
  NOT_APPLICABLE` e a razão extensível `UNCATEGORIZED`, sem permitir que a UI
  calcule uma regra diferente da query. `NOT_APPLICABLE` representa eventos
  cancelados, que continuam consultáveis mas não entram na fila.
- Definir a linhagem serializável, por exemplo:

  ```ts
  type TransactionSource =
    | { origin: "MANUAL"; import: null }
    | {
        origin: "IMPORT";
        import: {
          importId: string;
          rowNumber: number;
          externalId: string | null;
        };
      };
  ```

  O shape final deve manter IDs opacos, não incluir token, fingerprint,
  `candidateRows`, bytes ou CSV.
- Criar `TransactionListItemReadModel`/`TransactionDetailReadModel` com
  evento, entry assinado, conta, categoria nullable, `source`,
  `reviewState`/`reviewReason` e timestamps. Manter aliases/adapters de S03
  enquanto os consumidores existentes forem migrados.
- Definir `ListReviewableTransactionsQuery` com filtros de período, conta,
  categoria nullable, tipo, status, origem, revisão, `search`, `limit` e
  `cursor`; query recebida da URL permanece não confiável.
- Definir `pageInfo: { hasNextPage: boolean; nextCursor: string | null }` e
  `TransactionReviewSummaryReadModel` com ao menos `needsReviewCount`.
- Definir `UpdateReviewableTransactionCommand` com `commandId`,
  `financialEventId` e pelo menos um de `description`/`categoryId`; categoria
  `null` é uma operação válida. Nenhum campo financeiro ou de linhagem entra
  no command.
- Definir envelope de erros e mensagens sem vazar existência cross-tenant.
  Reutilizar códigos de S03 somente quando a semântica for igual; caso
  contrário, criar vocabulário S05 estável sem expor detalhes do banco.
- Definir o framing/serialização do cursor: data, UUID, hash dos filtros
  canônicos e limite; rejeitar cursor malformado ou incompatível.

## Critérios de aceite

- [x] O TypeScript não permite selecionar `SYSTEM` como origem revisável.
- [x] Categoria nula, origem importada e estado de pendência estão presentes
  no read model sem inferência obrigatória na UI.
- [x] O read model identifica a linhagem de S04 sem misturar dados de origem
  com `description`/`categoryId` correntes.
- [x] Commands e queries não carregam `householdId`, origem de escrita,
  `accountId` de destino ou linhas de CSV como autoridade do cliente.
- [x] O contrato de paginação é serializável e preserva ordenação determinística.
- [x] Há testes de schema/contrato para query inválida, limite, cursor,
  categoria nula, origem e command sem campo editável.

## Handoff

- T03 usa os campos e a relação de linhagem para definir constraints/índices.
- T04 implementa exatamente os predicados e o shape de paginação deste contrato.
- T05 usa o command de update e os códigos de erro sem aceitar campos extras.
- T07–T09 consomem os read models sem acessar Drizzle no browser.

Integração pública: importar diretamente
`@/modules/transactions/review-contracts`; o índice compartilhado não foi
alterado por restrição de escopo. T04/T06 devem conectar este contrato aos
reads/actions e manter os aliases legados de S03 sem ampliar a autoridade do
browser.

## Verificações

- [x] Rodar `rtk npm run typecheck` e os testes focados dos contracts.
- [ ] Confirmar que aliases legados de S03 não continuam fixando a lista em
  `origin=MANUAL` depois da migração dos consumidores.

## Evidências e limitações

- [x] `rtk npm run typecheck` — concluído com exit 0.
- [x] `rtk npm test -- --run src/modules/transactions/review-contracts.test.ts`
  — 9 testes passaram.
- [x] `rtk npm test -- --run` — 47 arquivos passaram, 15 foram pulados por
  integração; 320 testes passaram e 58 foram pulados.
- [x] `rtk git diff --check --no-index /dev/null` para os três arquivos
  autorizados — exit 1 apenas porque os arquivos são não rastreados no
  worktree; nenhuma mensagem de whitespace foi emitida.
- [ ] `rtk npx eslint src/modules/transactions/review-contracts.ts
  src/modules/transactions/review-contracts.test.ts` — bloqueado antes da
  análise: a configuração existente `.eslintrc.json` contém a propriedade
  de topo `ignorePatterns`, rejeitada pela versão do ESLint instalada.

O item de aliases legados permanece pendente por depender da migração dos
consumidores em T04/T06; os arquivos desses agentes não foram alterados para
respeitar o escopo exclusivo desta task. A nova boundary não fixa a fila em
`MANUAL` e rejeita `SYSTEM`/`REVERSAL` como origem revisável.
