# T02 — Criar schema, constraints, índices e migrations

## Status

Concluída — schema e migration verificados em PostgreSQL real em 2026-08-29.

## Objetivo

Persistir contas e categorias com integridade por espaço financeiro e sem preparar atalhos que violem o histórico futuro.

## Dependências

- T01 concluída;
- PostgreSQL e fluxo de migrations do S01 disponíveis.

## Pode ser paralelizada?

Sim. Pode ser executada em paralelo com T03, T04 e a parte de scaffolding de T07 depois que T01 fechar o contrato.

## Escopo

1. Criar ou estender `accounts` sem duplicar a tabela caso ela pertença ao Slice 1.
2. Criar `categories`.
3. Aplicar:
   - UUIDv7 para IDs de domínio;
   - `household_id` obrigatório;
   - foreign key para o espaço financeiro;
   - enums/check constraints para tipos, `kind` e status;
   - `parent_id` nullable em categorias;
   - proteção contra categoria ser pai de si mesma;
   - integridade do pai no mesmo household por FK composta quando aplicável;
   - `ON DELETE RESTRICT` por padrão.
4. Criar índices orientados às leituras do slice, por exemplo:
   - `(household_id, status, name)` em contas;
   - `(household_id, parent_id, status, name)` em categorias.
5. Criar constraints de unicidade somente conforme a decisão registrada em T01.
6. Reutilizar `application_commands` do S01 se já existir; não criar tabela paralela de idempotência.
7. Manter a migration forward-oriented e executável em PostgreSQL real.

## Fora de escopo

- coluna `accounts.balance`;
- `FinancialEvent` ou `AccountEntry`;
- saldo inicial;
- cascade para apagar histórico;
- RLS, que não faz parte da V1.

## Critérios de conclusão

- [x] migration sobe em banco vazio;
- [x] migration sobe sobre o estado produzido pelo S01/Slice 1;
- [x] `household_id` é obrigatório;
- [x] referências entre espaços são rejeitadas;
- [x] categoria pai de outro household é rejeitada;
- [x] deleção destrutiva é bloqueada por default;
- [x] índices aparecem no schema esperado;
- [x] migration foi validada com PostgreSQL real.

## Subtarefas verificadas

- [x] Criadas as tabelas tenant-scoped `accounts` e `categories`, sem
  `accounts.balance`, com `tracking_started_on` nullable e defaults do ADR-003.
- [x] Criados os enums persistidos de tipo, status, spendability, liquidez e
  kind, além dos checks de nome, controle de self-parent e campos obrigatórios.
- [x] Aplicadas FKs para `households` com `ON DELETE RESTRICT` e FK composta
  `(parent_id, household_id)` para impedir pai de outro household.
- [x] Aplicada unicidade case-insensitive de contas e unicidade null-safe de
  categorias entre irmãos, incluindo registros arquivados.
- [x] Criados índices para listagens tenant/status/nome e parent/status/nome,
  além das chaves compostas para referências futuras do ledger.
- [x] Reutilizada a tabela única `application_commands` para idempotência, com
  chave `(household_id, command_id)` e hash do payload para detectar reuso.
- [x] Gerada migration Drizzle forward-only e snapshot/journal correspondentes;
  `db:generate` não detecta mudanças pendentes após a geração.
- [x] Verificados em PostgreSQL 16 real: banco vazio, estado do S01, defaults,
  isolamento cross-tenant, unicidade, self-parent, FKs compostas e deleções
  destrutivas bloqueadas.

## Referências

- [`Tenancy e FKs compostas`](../../docs/techspec.md#5-tenancy);
- [`Migrations`](../../docs/techspec.md#107-migrations);
- [`PostgreSQL avançado`](../../docs/techspec.md#108-postgresql-avançado);
- [`Deletes`](../../docs/techspec.md#115-deletes).
