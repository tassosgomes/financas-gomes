# T08 — Lista, filtros e indicadores de revisão

- Slice: S05 — Revisão e organização das transações
- Status: Em andamento (UI, interação, contador server-side e volume backend
  verificados; fixture visual/E2E permanece pendente)
- Onda: 3
- Dependências: T04, T06 e T07
- Paralelização: Com T09; integração final depende dos contracts backend

## Objetivo

Transformar `/transactions` em uma fila de trabalho eficiente para localizar e
classificar lançamentos manuais/importados.

## Escopo

- Atualizar a Server Component de `/transactions` para carregar, em paralelo e
  com contexto server-side, lista paginada, resumo de pendências, contas e
  categorias.
- Trocar a descrição/manual-only da tela por linguagem que inclua origem
  importada e revisão, sem alterar a nomenclatura canônica do banco.
- Adicionar filtros de período, conta, categoria/sem categoria, tipo, status,
  origem, `Precisa de revisão`/`Organizado` e busca textual simples.
- Mostrar o contador de pendências e um CTA/filtro “Revisar agora”; o número
  deve vir do read model de T04, não ser calculado apenas sobre a página atual.
- Renderizar cada item com data, descrição, tipo, categoria, conta, valor,
  status, origem e indicador de revisão; manter valor assinado do entry sem
  converter centavos para float.
- Implementar paginação por cursor com limite seguro e link “Próximos” ou
  equivalente. Links de detalhe carregam todos os filtros e a posição atual
  necessários para retornar ao contexto.
- Integrar `CategoryQuickEdit` na linha/card: categoria pode ser alterada sem
  abrir outra rota, com feedback de loading/sucesso/erro e refresh/reidratação
  após commit. A edição deve funcionar para `MANUAL` e `IMPORT`.
- Preservar comportamento de empty states: nenhuma transação, nenhum resultado
  pelos filtros e nenhuma categoria cadastrada; mostrar ação de limpar filtros.
- Garantir layout utilizável com volume da página limitado, sem renderizar
  10.000 linhas de uma vez no browser.

## Critérios de aceite

- [x] Importados e manuais aparecem na mesma lista e têm origem visível.
- [x] “Sem categoria” encontra os itens pendentes; o contador server-side é
  atualizado após classificar um item com sucesso.
- [x] Filtros permanecem na URL e no link de detalhe/próxima página; refresh
  não volta para a primeira consulta vazia.
- [x] Edição rápida não recria o evento, preserva entry/valor/origem e não
  permite categoria de tipo incompatível — quick-edit envia somente
  `commandId`/`financialEventId`/`categoryId`, enquanto a integração do update
  mantém o evento/entry e valida o tipo.
- [x] Duplo clique/submit não envia duas operações; erro deixa a linha em
  estado coerente e acionável — coberto pelo teste DOM de double submit e retry.
- [x] Tabela desktop e cards mobile exibem a mesma informação essencial e
  continuam navegáveis por teclado.

## Handoff

- T09 deve reutilizar os hrefs e a semântica de fonte/pendência da lista.
- T11 valida renderização, filtros, cursor, contador e update em ambos os
  origins.
- T12 executa o fluxo importação → filtro pendente → classificação.

## Verificações

- [x] Testes de componente para filtros inválidos, origem, contador, empty
  states, quick edit, transição do contador e preservação de query —
  `transaction-review-components.test.tsx` (6),
  `transaction-review-interactions.test.tsx` (4) e
  `transaction-review-query.test.ts` (4), 14 testes focados no total.
- [ ] Teste manual com fixture de S04 e volume paginado.
- [x] `rtk npm run lint` e `rtk npm run typecheck` — ambos exit 0.

## Checkpoint / evidências reais

Data: 2026-08-30.

- `/transactions` carrega lista, resumo, contas e categorias em paralelo no
  Server Component e entrega apenas a action serializável ao quick-edit.
- `TransactionReviewListScreen` renderiza MANUAL e IMPORT na mesma tabela/card,
  usa `reviewState`/`needsReview` do read model, mostra contador server-side,
  filtros canônicos, empty states (inclusive sem contas/categorias), cursor e
  links com query preservada.
- `transaction-review-components.test.tsx` — exit 0 (6 testes), verificando
  origem, contador, empty states, filtros na URL e a equivalência desktop/mobile.
- A interação (duplo submit/erro/retry) foi executada em
  `transaction-review-interactions.test.tsx`; a lista aplica a transição
  confirmada pelo retorno da action ao contador local e chama `router.refresh`
  para revalidar o resumo server-side. A transição pendente→organizada tem
  cobertura unitária direta em `reviewCountAfterCategoryEdit`. A fixture
  visual/E2E permanece aberta.
- O cenário opt-in `T11 review volume and plan regression PostgreSQL` passou
  com 10.000 importados + 100 manuais no household A, 100 importados no B,
  páginas de 50, resumo de 3.384 pendências e cinco planos `EXPLAIN`; isso
  comprova o limite/paginação do read model, mas não substitui o teste manual
  da tela.
- `rtk npm run lint` — exit 0; `rtk npm run typecheck` — exit 0.

### Fechamento do contador após quick-edit — 2026-08-30

`TransactionReviewListScreen` tornou-se um client island somente para o estado
transitório do resumo: após sucesso, uma pendência `POSTED` que passa de
`categoryId=null` para uma categoria reduz o contador em uma unidade; a
transição inversa o incrementa, e o retorno ausente/inalterado não altera o
valor. A action continua sendo a autoridade e `router.refresh()` reidrata o
resumo do servidor. O teste de rota visual/E2E segue explicitamente pendente.
