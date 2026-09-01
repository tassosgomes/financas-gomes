# T11 — Listagem, filtros e empty state

- Slice: S03 — Transação manual end-to-end
- Status: Concluída — rota, listagem, filtros e estados verificados em 2026-08-29.
- Onda: 5
- Dependências: T06 e T09
- Paralelização: Pode ser executada em paralelo com T10

## Objetivo

Exibir lançamentos de forma rápida e compreensível, permitindo encontrar os registros mais úteis sem transformar a tela em uma busca avançada.

## Escopo

- Implementar `/transactions` como Server Component por padrão.
- Renderizar data, descrição, tipo, categoria, conta, valor e status.
- Mostrar receita e despesa com sinal/estilo coerente; distinguir cancelado sem ocultar o histórico.
- Implementar filtros mínimos via `searchParams`/URL:
  - período;
  - conta;
  - categoria;
  - tipo;
  - status.
- Preservar filtros na URL ao navegar para detalhe e voltar.
- Manter origem manual como filtro implícito ou opção estática; tags ficam fora do S03.
- Criar empty state para nenhum lançamento, incluindo CTA para primeira receita/despesa.
- Criar estados de carregamento, erro de leitura e ausência de contas/categorias.
- Garantir ordenação igual à query de T06 e paginação/limite compatível com o volume inicial.

## Critérios de aceite

- [x] Um lançamento criado aparece na listagem imediatamente após o retorno do fluxo de criação — a rota é `force-dynamic`, lê o read model de T06 a cada navegação e os pontos de entrada de T10 invalidam `/transactions` após sucesso.
- [x] Os filtros alteram a URL e são restaurados ao recarregar a página — o formulário GET usa `from`, `to`, `accountId`, `categoryId`, `kind` e `status`; os testes de utilitários verificam a query canônica e os links de detalhe.
- [x] Filtros inválidos não quebram a página nem escapam do tenant — `parseTransactionsSearchParams` ignora arrays/IDs/datas/status inválidos, informa o usuário e chama somente os reads tenant-scoped de T06.
- [x] Empty state orienta o próximo passo e não parece erro — estados distintos para lista vazia, resultado sem filtros, ausência de contas/categorias e falha de leitura, com CTAs de receita/despesa.
- [x] A tela continua legível em viewport móvel, sem prometer experiência mobile-first — tabela desktop e cards responsivos para viewport estreito, com todos os campos essenciais e ação de detalhe.

## Subtarefas e evidências

- [x] Criar a rota Server Component [`page.tsx`](../../src/app/transactions/page.tsx), com leitura tenant-scoped de lançamentos via T06 e opções de contas/categorias via T06/T09/S02.
- [x] Renderizar [`transactions-list-screen.tsx`](../../src/components/transactions/transactions-list-screen.tsx) com tabela/lista responsiva, data, descrição, tipo, categoria, conta, valor assinado e status; eventos cancelados continuam visíveis.
- [x] Implementar formulário GET e [`transaction-listing-utils.ts`](../../src/components/transactions/transaction-listing-utils.ts) para os cinco filtros, normalização segura, sentinel de “sem categoria” e preservação da query em [`routes.ts`](../../src/modules/transactions/routes.ts) ao abrir detalhe.
- [x] Implementar empty state contextual, CTAs para primeira receita/despesa, aviso de contas/categorias ausentes, [`loading.tsx`](../../src/app/transactions/loading.tsx) e erro de leitura seguro.
- [x] Adicionar cobertura automatizada em [`transaction-listing-utils.test.ts`](../../src/components/transactions/transaction-listing-utils.test.ts) e [`transactions-list-screen.test.tsx`](../../src/components/transactions/transactions-list-screen.test.tsx), cobrindo filtros/URL, ordenação recebida do read model, sinais/status, cancelamento e estados vazios.

## Verificações

- [x] `npm test -- --run src/components/transactions/transaction-listing-utils.test.ts src/components/transactions/transactions-list-screen.test.tsx` — 8 testes passaram.
- [x] `npm test` — 196 testes passaram; 39 integrações opt-in foram ignoradas sem PostgreSQL externo.
- [x] `npm run typecheck` — concluído sem erros.
- [x] ESLint focado nos arquivos de T11 — concluído sem warnings/erros.
- [x] `npm run build` — build Next.js concluiu, compilando `/transactions` e `/transactions/new`; permanece apenas o warning operacional preexistente sobre múltiplos lockfiles/workspace root.
