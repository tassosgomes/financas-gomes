# T08 — Implementar UI de contas

## Status

Concluída — UI, integração das actions e verificações entregues em
2026-08-29.

## Objetivo

Entregar o fluxo visual para criar e manter contas financeiras sem misturar saldo ou movimentações que pertencem a outros slices.

## Dependências

- T05 concluída;
- T07 concluída.

## Pode ser paralelizada?

Sim. Pode ser desenvolvida em paralelo com T09, T11 e T12.

## Escopo

1. Implementar `/accounts` com:
   - listagem de contas ativas;
   - consulta explícita de arquivadas;
   - identificação de tipo e status;
   - ação de criar;
   - ação de editar;
   - ação de arquivar.
2. Implementar formulário com os campos definidos em T01, sem adicionar saldo inicial se ele pertencer ao Slice 1.
3. Exibir empty state orientando o cadastro da primeira conta.
4. Exibir erros de validação por campo e erros de operação de forma compreensível.
5. Confirmar arquivamento antes da alteração e atualizar a lista após sucesso.
6. Garantir responsividade suficiente para cadastro simples no navegador móvel, sem transformar o slice em mobile-first.

## Fora de escopo

- saldo;
- extrato;
- saldo inicial;
- fatura e limite de cartão;
- dashboard.

## Critérios de conclusão

- [x] usuário cria a primeira conta pelo fluxo real;
- [x] conta aparece na listagem correta;
- [x] edição persiste e é refletida na tela;
- [x] arquivamento não remove o registro do histórico;
- [x] arquivada não aparece na lista ativa;
- [x] formulário impede campos obrigatórios ausentes;
- [x] estados vazio, erro e carregamento funcionam.

## Subtarefas verificadas

- [x] Rota `/accounts` renderiza a coleção ativa no servidor por meio de
  `listAccountsAction`, com estado de erro seguro e recarregável.
- [x] Criado formulário client-side com React Hook Form + Zod para nome, tipo,
  disponibilidade, liquidez e inclusão no patrimônio; `commandId` e
  `accountId` permanecem fora da edição do usuário e são anexados no boundary.
- [x] Criados estados de cadastro e edição, com feedback de sucesso, erros por
  campo e erros operacionais sem detalhes de infraestrutura.
- [x] Listagem responsiva usa tabela em telas largas e cards em telas estreitas;
  tipo, status, disponibilidade, liquidez e patrimônio são identificados.
- [x] Consulta explícita de arquivadas usa `status: ARCHIVED`; a listagem ativa
  permanece filtrada por `status: ACTIVE` e contas arquivadas ficam somente para
  leitura.
- [x] Arquivamento exige confirmação explícita, chama `archiveAccountAction` e
  recarrega a coleção após sucesso, preservando o registro no histórico.
- [x] Ações reais de T05/T07 (`createAccountAction`, `updateAccountAction`,
  `archiveAccountAction` e `listAccountsAction`) são usadas sem autoridade de
  `householdId` no navegador.
- [x] `rtk npm run typecheck`, Vitest (123 testes passando, 18 ignorados) e
  ESLint focado nos arquivos de T08 passaram.

### Verificação pendente fora do escopo de T08

O lint/build global continua bloqueado por um erro preexistente em
`src/modules/categories/use-cases.ts:744` (`@typescript-eslint/no-empty-object-type`)
e dois warnings preexistentes em `src/modules/accounts-categories/validation.test.ts`;
nenhum deles pertence aos arquivos desta task.

## Referências

- [`Frontend — Accounts`](../../docs/techspec.md#90-accounts);
- [`Frontend architecture`](../../docs/techspec.md#81-frontend-architecture);
- [`S02 — Frontend e aceite`](../../docs/S02-contas-categorias.md#frontend).
