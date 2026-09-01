# T09 — Detalhe, edição e origem

- Slice: S05 — Revisão e organização das transações
- Status: Em andamento (rota, interação, `commandId` e opacidade cross-tenant
  da boundary verificadas; E2E de rota permanece pendente)
- Onda: 3
- Dependências: T04, T05, T06 e T07
- Paralelização: Com T08; depende da estabilização dos read models

## Objetivo

Permitir revisão detalhada quando a edição inline não for suficiente, deixando
claro o que é dado corrente e o que pertence à origem do lançamento.

## Escopo

- Generalizar `/transactions/[id]` para aceitar eventos `MANUAL` e `IMPORT`
  retornados pelo detalhe de T04; manter resposta opaca para ID de outro
  household.
- Exibir fato econômico e efeito no ledger como somente leitura: valor,
  data, conta, tipo, status e entry não podem ser editados neste slice.
- Exibir formulário de `description` e `categoryId` com categoria opcional,
  filtrada pelo tipo e com mensagens do servidor; reutilizar componentes de
  formulário de S03 onde fizer sentido.
- Mostrar card de origem: Manual ou Importado. Para importação, exibir apenas
  `importId`, linha e `externalId` quando presentes, com labels que deixem
  claro que são metadata de origem imutável. Não exibir token, fingerprint,
  CSV bruto ou payload de staging.
- Mostrar estado “Precisa de revisão” quando a categoria for nula e permitir
  retornar à lista com `from/to/account/category/kind/status/origin/review/
  search/cursor` preservados.
- Após sucesso, atualizar o detalhe e o resumo/lista por revalidação; após erro,
  manter os valores atuais do formulário e permitir nova tentativa segura.
- Manter ações de cancelamento/reversal de S03 somente onde já forem válidas;
  não criar cancelamento de importação nem confundir reversal com edição.
- Cobrir viewport móvel, foco, confirmação de saída e feedback acessível.

## Critérios de aceite

- [x] Um importado pode ter categoria/descrição revisadas no detalhe, mas
  continua identificado como `IMPORT` com sua linhagem original — interação
  DOM cobre update e preservação de `importId`/linha/`externalId`.
- [x] O formulário não oferece campos financeiros editáveis nem permite alterar
  `externalId`, lote, linha, origem ou entry — campos de valor/data são
  `readonly` e o command verificado contém somente metadata editável.
- [x] Categoria nula é representada sem string sentinela persistida; o update
  devolve o estado pendente corretamente — cobertura estática e integração do
  update incluem `categoryId: null`/`NEEDS_REVIEW`.
- [x] Voltar ao resultado preserva filtros e cursor da fila.
- [x] Detalhe de evento cross-tenant não revela se existe nem mostra metadados.
- [ ] O detalhe é consistente com a lista depois de editar descrição/categoria.

## Handoff

- T11 cobre read model e componentes de detalhe.
- T12 cobre abrir item importado, editar e voltar à fila mantendo contexto.
- T13 verifica que nenhuma origem/token/CSV aparece em logs, HTML indevido ou
  resposta de action.

## Verificações

- [x] Testes de componente para origem manual/importada, campos readonly,
  categoria nula, erro/sucesso e backHref — cobertura estática e
  `transaction-review-interactions.test.tsx`.
- [ ] Teste E2E desktop e viewport móvel quando o ambiente permitir.

## Checkpoint / evidências reais

Data: 2026-08-30.

- `src/app/transactions/[id]/page.tsx` agora resolve o detalhe por
  `transactionReviewReadUseCases.detail` dentro de `withFinancialContext`,
  portanto aceita MANUAL e IMPORT e mantém ID cross-tenant opaco. A página
  conecta `updateReviewableTransactionAction` e o cancelamento de S03 apenas
  para o caso MANUAL.
- O back-link usa `reviewQueryHref` e reemite a query canônica completa,
  incluindo cursor; a cobertura unitária de query e a renderização da lista
  verificam essa preservação.
- `TransactionReviewDetailScreen` exibe fato/entry somente leitura, formulário
  limitado a descrição/categoria, `SourceDetails` seguro (importId/linha/
  externalId), pendência explícita e revalidação após sucesso.
- `transaction-review-interactions.test.tsx` — exit 0 (4 testes), cobrindo o
  detalhe importado, linhagem segura, readonly financeiro, update de descrição/
  categoria, feedback de sucesso e ausência de cancelamento para `IMPORT`.
- `transaction-review-components.test.tsx`/`transaction-review-query.test.ts`
  + interação — exit 0 (14 testes focados).
- `rtk npm run lint` — exit 0; `rtk npm run typecheck` — exit 0.
- E2E e smoke de rota cross-tenant não foram executados; permanecem pendentes.

### Auditoria de isolamento e submissão — 2026-08-30

O detalhe resolve `transactionReviewReadUseCases.detail(context, id)` dentro
de `withFinancialContext`; um ID pertencente a outro household retorna apenas
`EVENT_NOT_FOUND`, antes de carregar contas, categorias, saldo ou `SourceDetails`.
Assim, a rota não tem metadados para renderizar em caso cross-tenant. A
interação DOM adicional reproduziu dois submits simultâneos e comprovou um
único `commandId` gerado, payload sem tenant/campos financeiros e botão
bloqueado até o retorno. O teste E2E desktop/mobile permanece pendente por
ser responsabilidade de T12.
