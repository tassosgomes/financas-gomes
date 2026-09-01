# T04 — Implementar contexto e acesso tenant-scoped

## Status

Concluída — contexto e convenção de acesso isolado validados em 2026-08-29.

## Objetivo

Garantir que nenhuma leitura ou escrita de conta/categoria escape do espaço financeiro resolvido pela sessão.

## Dependências

- S01 concluído;
- T01 concluída.

## Pode ser paralelizada?

Sim. Pode rodar em paralelo com T02 e T03, mas é pré-requisito para T05 e T06.

## Escopo

1. Reutilizar ou consolidar o helper central equivalente a `requireFinancialContext()`.
2. Derivar `userId` e `householdId` exclusivamente da sessão e do membership.
3. Criar funções de leitura e escrita que:
   - recebam o contexto autenticado;
   - filtrem sempre por `household_id`;
   - verifiquem o pertencimento do recurso antes de editar ou arquivar;
   - não aceitem `householdId` enviado pelo client.
4. Para CRUD simples, usar Drizzle diretamente quando isso não esconder regra de domínio; não criar repositories apenas por simetria.
5. Padronizar o resultado de “não encontrado”, “não pertence ao espaço” e “não autenticado”.
6. Preparar fixtures/helpers para testes com pelo menos dois households.

## Fora de escopo

- PostgreSQL RLS;
- papéis ou permissões por recurso;
- convite ou gestão de membros;
- acesso direto do browser ao PostgreSQL.

## Critérios de conclusão

- [x] nenhuma API pública de S02 recebe tenant como autoridade; os comandos
  da fronteira protegida não possuem `householdId`, e o contexto só é obtido
  pelo guard server-side;
- [x] listar retorna somente recursos do contexto atual, com `household_id`
  no predicado da query;
- [x] ID de outro household não pode ser editado ou arquivado: a convenção
  de escrita exige o predicado composto `id + household_id`, comprovado pelo
  recurso protegido e reutilizável pelos use cases de T05/T06;
- [x] usuário sem sessão é rejeitado com `UNAUTHENTICATED`/401;
- [x] testes conseguem criar e isolar dois espaços, incluindo cenário
  PostgreSQL real;
- [x] queries ficam legíveis e centralizadas por `withFinancialContext`,
  `assertFinancialContext` e os helpers do recurso protegido.

## Subtarefas verificadas

- [x] Reutilizado `requireFinancialContext()` para autenticação, membership e
  seleção server-side; `householdId` recebido do cliente nunca vira
  autoridade.
- [x] Consolidada a validação runtime de `FinancialContext`; contexto vazio,
  com whitespace ou malformado é rejeitado antes de acessar Drizzle.
- [x] Repositório tenant-scoped de fixture implementa listagem, leitura,
  criação e edição com `household_id` obrigatório no filtro; os IDs de
  household e usuário da criação vêm exclusivamente do contexto.
- [x] “Ausente” e “pertence a outro household” compartilham o resultado
  `NOT_FOUND`/404; falha de sessão atravessa `FinancialContextError` como
  `UNAUTHENTICATED`/401.
- [x] Fixture de integração cobre dois households e verifica listagem,
  leitura por ID, tentativa de edição cross-tenant, payload adulterado e FK
  composta no PostgreSQL.
- [x] Adicionados testes unitários da fronteira e da coerência entre usuário,
  membership e household retornados pelo provisionamento.

As APIs concretas de contas e categorias serão entregues em T05/T06; elas
devem consumir esta fronteira e manter o mesmo predicado composto em edição e
arquivamento.

## Referências

- [`Tenant nunca confiado ao client`](../../docs/techspec.md#53-tenant-nunca-confiado-ao-client);
- [`Autorização`](../../docs/techspec.md#52-autorização);
- [`Reads e persistência`](../../docs/techspec.md#75-persistência).
