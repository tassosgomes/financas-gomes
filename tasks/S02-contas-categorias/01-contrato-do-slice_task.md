# T01 — Fechar contrato e fronteira do slice

## Status

Concluída — contrato aprovado e verificado em 2026-08-29.

## Objetivo

Transformar o S02 e as regras relevantes da TechSpec em um contrato implementável, eliminando ambiguidades antes de alterar o banco ou iniciar as telas.

## Dependências

- S01 concluído;
- contexto autenticado capaz de resolver usuário e espaço financeiro;
- decisão sobre a tabela de contas caso o Slice 1 já tenha iniciado o ledger.

## Pode ser paralelizada?

Não. Esta task é o gate do slice e bloqueia T02–T13.

## Escopo

1. Confirmar que o S02 será dono do CRUD de metadados de `accounts` e `categories`.
2. Confirmar que saldo inicial, `FinancialEvent`, `AccountEntry`, saldo derivado, extrato e transações permanecem fora do S02.
3. Definir o contrato de `Account`:
   - `id`;
   - `household_id`;
   - `name`;
   - `type`;
   - `status`;
   - `spendability`;
   - `liquidity`;
   - `include_in_net_worth`;
   - `tracking_started_on`, se exigido pelo contrato do Slice 1.
4. Definir o contrato de `Category`:
   - `id`;
   - `household_id`;
   - `name`;
   - `parent_id` opcional;
   - `kind`;
   - `status`.
5. Definir os comandos e leituras:
   - `CreateAccount`, `ListAccounts`, `UpdateAccount`, `ArchiveAccount`;
   - `CreateCategory`, `ListCategories`, `UpdateCategory`, `ArchiveCategory`.
6. Definir payloads serializáveis, `commandId`, códigos de erro e formato dos read models.
7. Fechar as decisões que não estão explícitas nos documentos:
   - unicidade e normalização dos nomes;
   - limites de tamanho;
   - campos obrigatórios e defaults de conta;
   - possibilidade de reativação;
   - compatibilidade do `kind` entre categoria pai e filha;
   - momento da verificação de “categoria já utilizada”;
   - adiamento da categoria → caixinha padrão.

## Regras que devem ficar registradas

- `household_id` vem da sessão, nunca do formulário;
- o status persistido usa `ACTIVE | ARCHIVED`;
- categoria possui no máximo um nível de filho;
- categoria utilizada não pode sofrer reparenting;
- entidade arquivada não é oferecida para novos lançamentos;
- contas com movimentação não sofrem hard delete;
- saldo não é armazenado em `accounts`.

## Critérios de conclusão

- [x] contrato de campos e operações aprovado;
- [x] sobreposição com o Slice 1 resolvida;
- [x] decisões abertas registradas no ADR-003 do S02;
- [x] payloads e erros definidos para frontend e backend;
- [x] escopo fora do S02 explicitamente documentado.

## Subtarefas verificadas

- [x] Confirmada a responsabilidade do S02 pelo CRUD de metadados de
  `accounts` e `categories`, com reuso da tabela de contas caso ela exista.
- [x] Confirmado que saldo inicial, `FinancialEvent`, `AccountEntry`, saldo
  derivado, extrato, transações e saldo persistido ficam fora do S02.
- [x] Fechado o contrato de `Account`, incluindo `tracking_started_on` como
  `DATE NULL` controlado pelo fluxo posterior de saldo inicial.
- [x] Fechado o contrato de `Category`, hierarquia máxima de dois níveis e
  vínculo de `kind` entre pai e filha.
- [x] Fechados os oito commands/reads, payloads serializáveis, `commandId`,
  read models e códigos de erro estáveis.
- [x] Registradas normalização, limites, unicidade, defaults, imutabilidade,
  arquivamento sem reativação no S02, verificação de uso para reparenting e
  adiamento de categoria → caixinha padrão.
- [x] Registradas as regras de tenancy, status canônico, ausência de hard
  delete e ausência de `accounts.balance`.

## Referências

- [`S02 — escopo e dependências`](../../docs/S02-contas-categorias.md#escopo);
- [`TechSpec — Accounts`](../../docs/techspec.md#14-accounts);
- [`TechSpec — Categories`](../../docs/techspec.md#33-categories);
- [`TechSpec — Application Commands`](../../docs/techspec.md#69-application-commands).
- [`ADR-003 — Contrato de contas e categorias do S02`](../../docs/adr/003-s02-contas-categorias-contract.md).
