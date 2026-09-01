# T06 — Implementar use cases de categorias

## Status

Concluída — use cases tenant-scoped, hierarquia e idempotência verificados em
2026-08-29.

## Objetivo

Disponibilizar o CRUD de categorias com hierarquia simples, preservação de histórico e isolamento por espaço financeiro.

## Dependências

- T02 concluída;
- T03 concluída;
- T04 concluída.

## Pode ser paralelizada?

Sim. Deve ser desenvolvida em paralelo com T05. T10 pode criar os testes unitários enquanto esta task avança.

## Escopo

1. Implementar:
   - `CreateCategory`;
   - `ListCategories`;
   - `UpdateCategory`;
   - `ArchiveCategory`.
2. No create:
   - validar nome e `kind`;
   - aceitar `parent_id` nulo;
   - validar pai no mesmo household;
   - rejeitar hierarquia acima de dois níveis;
   - gerar UUIDv7 e preencher o household pelo contexto.
3. No list:
   - retornar apenas categorias do household atual;
   - permitir leitura plana ou em árvore conforme o read model;
   - filtrar arquivadas por padrão;
   - fornecer uma leitura de categorias ativas para futuros novos lançamentos.
4. No update:
   - permitir edição de nome;
   - aplicar a regra de reparenting para categorias já utilizadas;
   - respeitar as decisões de T01 para alteração de `kind` e pai.
5. No archive:
   - mudar o status para `ARCHIVED`;
   - ser seguro em retry;
   - não apagar histórico nem referências;
   - remover a categoria das opções ativas futuras.
6. Aplicar idempotência e `Result` conforme o padrão de T05.

## Fora de escopo

- caixinha padrão;
- orçamento;
- lançamento de transação;
- categorização automática;
- hard delete.

## Critérios de conclusão

- [x] categoria de despesa e receita pode ser criada;
- [x] categoria filha válida pode ser criada;
- [x] terceiro nível é rejeitado;
- [x] pai de outro household é rejeitado;
- [x] categoria pode ser renomeada;
- [x] categoria utilizada não pode ser reparented;
- [x] arquivamento preserva o registro;
- [x] categorias arquivadas não aparecem na leitura de ativas;
- [x] retry idempotente não duplica a operação.

## Subtarefas verificadas

- [x] Implementados `CreateCategory`, `ListCategories`, `UpdateCategory` e
  `ArchiveCategory` como port tenant-scoped com factory injetável de banco.
- [x] Create valida nome/kind, deriva `householdId` do contexto, gera UUIDv7,
  aceita raiz e valida pai ativo do mesmo household/kind e profundidade máxima.
- [x] List retorna read model plano, filtra `ACTIVE` por padrão e suporta
  `ARCHIVED`/`ALL`, sempre com predicado de `household_id` e ordem de pais/nome/id.
- [x] Update permite nome e `parentId`, mantém `kind`/status/tenant imutáveis,
  consulta uso no mesmo transaction hook e rejeita reparenting de categoria usada.
- [x] Archive usa `ARCHIVED`, bloqueia pai com filhos ativos e preserva filhos,
  referências e histórico sem hard delete.
- [x] Writes registram `categories.create|update|archive` em
  `application_commands`, distinguem retry compatível de `COMMAND_ID_REUSED` e
  deixam retry de archive idempotente.
- [x] Smoke test em PostgreSQL 16 verificou EXPENSE/INCOME, hierarquia,
  isolamento cross-tenant, rename, uso/reparenting, archive e listagens.
- [x] Typecheck do módulo passou; falhas restantes do typecheck global são
  preexistentes/pertencentes ao use case de contas e seus testes em T05.

## Referências

- [`Categories`](../../docs/techspec.md#33-categories);
- [`Hierarquia`](../../docs/techspec.md#331-hierarquia);
- [`Categoria opcional`](../../docs/techspec.md#332-categoria-opcional);
- [`Deletes`](../../docs/techspec.md#115-deletes).
