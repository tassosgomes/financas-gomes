# T09 — Implementar UI de categorias

## Status

Concluída — UI de categorias, hierarquia e validações visuais entregues em
2026-08-29.

## Objetivo

Entregar o fluxo visual para criar, editar e arquivar categorias, incluindo a hierarquia simples definida na TechSpec.

## Dependências

- T06 concluída;
- T07 concluída.

## Pode ser paralelizada?

Sim. Pode ser desenvolvida em paralelo com T08, T11 e T12.

## Escopo

1. Implementar a área de Categorias em Configurações com:
   - listagem ativa;
   - visualização de categorias pai e filhas;
   - consulta explícita de arquivadas;
   - ação de criar;
   - ação de editar;
   - ação de arquivar.
2. Implementar formulário com:
   - nome;
   - `kind`;
   - pai opcional;
   - seleção de pai limitada a opções válidas;
   - bloqueio visual para terceiro nível.
3. Não oferecer categorias arquivadas como pai para novos cadastros, salvo decisão explícita de T01.
4. Exibir erros de validação e conflito de reparenting de forma compreensível.
5. Exibir empty state para primeiro cadastro de categorias.
6. Atualizar a árvore/lista após criar, editar ou arquivar.

## Fora de escopo

- caixinha padrão;
- orçamento;
- transações;
- categorização automática;
- drag-and-drop ou hierarquia livre.

## Critérios de conclusão

- [x] usuário cria categoria de despesa;
- [x] usuário cria categoria de receita;
- [x] usuário cria subcategoria válida;
- [x] terceiro nível não é permitido;
- [x] categoria pode ser editada;
- [x] categoria pode ser arquivada sem desaparecer do histórico;
- [x] categorias arquivadas não aparecem como opções ativas;
- [x] estados vazio, erro e carregamento funcionam.

## Subtarefas verificadas

- [x] Rota `/settings/categories` renderiza a coleção ativa no servidor e
  possui estado de erro com retry; o alias `/app/settings/categories` continua
  apontando para a rota canônica.
- [x] `CategoriesScreen` usa as Server Actions de T07 para criar, editar,
  arquivar, consultar arquivadas e atualizar a coleção após cada operação.
- [x] A leitura plana de T06 é projetada como árvore pai/filha, com indicação
  visual de nível, suporte desktop/mobile e categorias arquivadas somente para
  consulta.
- [x] `CategoryForm` usa React Hook Form + Zod para nome, `kind` e pai
  opcional; categoria editada mantém `kind` somente leitura conforme o
  contrato de T06.
- [x] O seletor de pai oferece exclusivamente categorias `ACTIVE` de primeiro
  nível e do mesmo `kind`; categorias filhas e arquivadas não são opções, com
  mensagem visual explícita do limite de dois níveis.
- [x] Erros de nome/campos inválidos aparecem no formulário e erros de conflito
  (incluindo reparenting e pai com filhas ativas) aparecem em estado acessível
  e com mensagens allow-listed do contrato.
- [x] Estados vazio, carregamento, erro, sucesso e confirmação explícita de
  arquivamento foram conectados aos componentes compartilhados de T07.
- [x] Typecheck, testes Vitest e build de compilação da implementação foram
  executados; o build completo permanece bloqueado por erro preexistente de
  lint em `src/modules/categories/use-cases.ts` (T06), fora do escopo desta
  task.

## Referências

- [`Categories`](../../docs/techspec.md#33-categories);
- [`Hierarquia`](../../docs/techspec.md#331-hierarquia);
- [`Settings`](../../docs/techspec.md#95-settings);
- [`S02 — Frontend e aceite`](../../docs/S02-contas-categorias.md#frontend).
