# T11 — Criar testes de integração com PostgreSQL

## Status

Concluída — integração PostgreSQL real verificada em 2026-08-29.

## Objetivo

Provar no banco real que migrations, constraints, CRUD e isolamento por espaço funcionam juntos.

## Dependências

- T02 concluída;
- T04 concluída;
- T05 concluída;
- T06 concluída.

## Pode ser paralelizada?

Sim. Pode rodar em paralelo com T08, T09 e T12. Fixtures e cenários podem ser preparados antes dos use cases terminarem.

## Escopo

Executar contra PostgreSQL real, usando Testcontainers quando apropriado:

1. aplicar migrations em banco vazio;
2. criar dois households e dados independentes;
3. validar CRUD de contas;
4. validar CRUD de categorias;
5. validar listagem somente do household atual;
6. tentar editar/arquivar recurso de outro household;
7. tentar criar categoria com pai de outro household;
8. tentar criar terceiro nível;
9. validar arquivamento sem deleção física;
10. validar que deleção destrutiva é rejeitada quando houver referência;
11. validar retry com o mesmo `commandId`;
12. validar rollback quando uma operação composta falhar;
13. verificar constraints e índices essenciais.

Como a V1 não usa RLS, esses testes são uma barreira obrigatória para o isolamento baseado na aplicação.

## Critérios de conclusão

- [x] banco real é usado nos testes de persistência;
- [x] existe cenário explícito de cross-tenant;
- [x] nenhuma query retorna dados do segundo household;
- [x] FKs compostas protegem associações entre espaços;
- [x] arquivamento preserva o registro;
- [x] idempotência está comprovada no banco;
- [x] rollback deixa o banco consistente;
- [x] testes são reproduzíveis e não usam dados financeiros reais.

## Subtarefas verificadas

- [x] Criada a suíte opt-in `s02.integration.test.ts`, executada pelo
  `vitest.integration.config.mts` e pelo script `test:integration`, com
  PostgreSQL 16 real e fixtures sintéticas isoladas de T11.
- [x] Aplicadas/confirmadas migrations forward-only antes da suíte e em um
  database PostgreSQL temporário vazio; o teste verifica status sem pendências
  ou drift e a presença das tabelas e índices essenciais de contas, categorias
  e idempotência.
- [x] Criados dois households com memberships independentes; listagens e
  leituras de contas/categorias retornam somente o household do contexto.
- [x] Exercitado CRUD de contas, incluindo defaults, edição, tentativa de
  edição/arquivamento cross-tenant, arquivamento sem deleção e filtro de
  arquivadas.
- [x] Exercitado CRUD de categorias, incluindo EXPENSE/INCOME, filho válido,
  pai de outro household, terceiro nível, rename e reparenting de categoria
  utilizada.
- [x] Validada a FK composta de pai e household diretamente no PostgreSQL;
  deleção destrutiva do pai com filho é rejeitada com SQLSTATE `23503`.
- [x] Comprovada idempotência de retry compatível e rejeição de reuso de
  `commandId` com payload incompatível, verificando uma única linha de recurso
  e a linha correspondente em `application_commands`.
- [x] Comprovado rollback transacional: falhas de validação hierárquica depois
  da reserva do comando não deixam reserva nem categoria parcial persistida.

## Referências

- [`Integração e tenancy`](../../docs/techspec.md#116-testes);
- [`Integridade cross-tenant`](../../docs/techspec.md#54-integridade-cross-tenant);
- [`Idempotência`](../../docs/techspec.md#72-idempotência);
- [`Dados de produção`](../../docs/techspec.md#112-dados-de-produção).
