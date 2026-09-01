# T03 — Implementar tipos, invariantes e validações

## Status

Concluída — tipos, schemas e invariantes implementados e verificados em
2026-08-29.

## Objetivo

Concentrar as regras de domínio de contas e categorias para que sejam aplicadas tanto na UI quanto no servidor.

## Dependências

- T01 concluída.

## Pode ser paralelizada?

Sim. Pode rodar em paralelo com T02 e T04. T10 deve acompanhar esta task.

## Escopo

1. Definir tipos compartilhados:
   - `AccountType`: `CHECKING`, `SAVINGS`, `CASH`, `CREDIT_CARD`, `BENEFIT`, `INVESTMENT`, `OTHER`;
   - `CategoryKind`: `EXPENSE` ou `INCOME`;
   - status canônico `ACTIVE` ou `ARCHIVED`;
   - `Spendability` e `Liquidity`, se confirmados no contrato de T01.
2. Criar schemas Zod para boundary HTTP, Server Actions e formulários.
3. Criar validação de domínio para:
   - nome obrigatório, aparado e dentro do limite definido;
   - enums válidos;
   - campos imutáveis não serem alterados pelo update;
   - categoria não ser pai de si mesma;
   - categoria pai pertencer ao mesmo espaço;
   - hierarquia ter no máximo dois níveis;
   - reparenting ser rejeitado quando a categoria já tiver uso;
   - arquivamento ser explícito e não virar deleção física.
4. Mapear erros esperados para códigos estáveis, sem expor detalhes do banco.
5. Garantir que a validação rode novamente no servidor, mesmo quando o formulário já validou no client.

## Decisões a respeitar

- Não usar `float` ou `Date` para criar dependências financeiras desnecessárias.
- Não assumir que categoria é obrigatória em transações futuras; `category_id` pode ser nulo.
- Não implementar aqui a associação com Caixinhas.

## Critérios de conclusão

- [x] tipos compartilhados compilam no frontend e backend;
- [x] inputs vazios ou inválidos falham com erro previsível;
- [x] hierarquia acima de dois níveis falha;
- [x] pai de outro household falha;
- [x] reparenting de categoria utilizada falha;
- [x] status e regras de arquivamento estão cobertos por testes unitários;
- [x] schemas de client e servidor são consistentes.

## Subtarefas verificadas

- [x] Centralizados enums, defaults, commands, queries, read models e tipos de
  erro estáveis do ADR-003.
- [x] Implementada normalização NFKC, trim, colapso de whitespace, limite por
  code points e rejeição de caracteres de controle nos nomes.
- [x] Criados schemas Zod estritos e compartilhados para HTTP, Server Actions
  e formulários, com `commandId` obrigatório e sem autoridade de household.
- [x] Rejeitados updates sem campo editável e tentativas de alteração de
  campos imutáveis por meio da boundary estrita.
- [x] Implementadas invariantes de pai, household, status, `kind`, auto-pai e
  profundidade máxima de categorias.
- [x] Implementadas as regras de reparenting condicionado ao uso e de
  arquivamento explícito sem deleção física.
- [x] Adicionados testes unitários focados em normalização, schemas, erros,
  hierarquia, reparenting e arquivamento.
- [x] Confirmados `lint`, `typecheck`, suíte unitária focada e suíte unitária
  completa.

## Referências

- [`Validation`](../../docs/techspec.md#80-validação);
- [`Accounts`](../../docs/techspec.md#14-accounts);
- [`Categories e hierarquia`](../../docs/techspec.md#33-categories);
- [`Money e datas`](../../docs/techspec.md#12-money).
