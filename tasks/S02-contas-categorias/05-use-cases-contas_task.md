# T05 — Implementar use cases de contas

## Status

Concluída — use cases, idempotência, isolamento e arquivamento verificados em
2026-08-29.

## Objetivo

Disponibilizar o CRUD de contas como operações explícitas, idempotentes e protegidas pelo contexto do espaço financeiro.

## Dependências

- T02 concluída;
- T03 concluída;
- T04 concluída.

## Pode ser paralelizada?

Sim. Deve ser desenvolvida em paralelo com T06. T10 pode criar os testes unitários enquanto esta task avança.

## Escopo

1. Implementar:
   - `CreateAccount`;
   - `ListAccounts`;
   - `UpdateAccount`;
   - `ArchiveAccount`.
2. No create:
   - validar o comando no servidor;
   - preencher `household_id` a partir do contexto;
   - gerar UUIDv7;
   - aplicar defaults aprovados em T01;
   - registrar `commandId` quando o padrão de idempotência se aplicar.
3. No list:
   - retornar contas do household atual;
   - exibir ativas por padrão;
   - permitir consulta explícita das arquivadas;
   - não calcular saldo neste slice.
4. No update:
   - permitir somente campos editáveis;
   - impedir alteração de ID e household;
   - respeitar as invariantes de domínio.
5. No archive:
   - mudar o status para `ARCHIVED`;
   - ser seguro em retry;
   - não apagar referências;
   - deixar a conta fora das opções de novos fluxos.
6. Usar transaction no nível do use case quando houver mais de uma escrita, sem transactions independentes dentro de repositories.
7. Retornar `Result` para erros esperados e deixar exceções inesperadas para observabilidade.

## Fora de escopo

- saldo inicial;
- criação de entries;
- saldo atual ou disponível;
- fatura, limite ou regras de cartão;
- hard delete;
- dashboard.

## Critérios de conclusão

- [x] conta é criada com todos os campos obrigatórios;
- [x] retry com o mesmo `commandId` não duplica a conta;
- [x] listagem respeita o household;
- [x] edição não altera campos protegidos;
- [x] arquivamento preserva o registro;
- [x] conta arquivada não aparece na leitura de contas ativas;
- [x] erros esperados têm contrato estável.

## Subtarefas verificadas

- [x] Criado o port persistente `AccountsUseCases`, com `CreateAccount`,
  `ListAccounts`, `UpdateAccount` e `ArchiveAccount`, além de aliases de
  composição e funções de conveniência.
- [x] Create valida novamente o command no servidor, normaliza o nome, aplica
  defaults do ADR-003, gera UUIDv7, deriva `householdId` do contexto e mantém
  `trackingStartedOn` nulo.
- [x] List usa o household do contexto, filtra `ACTIVE` por padrão, aceita
  `ARCHIVED`/`ALL`, ordena por nome e ID e não calcula saldo.
- [x] Update aceita somente campos editáveis, aplica o predicado composto
  `id + household_id` e rejeita contas arquivadas ou nomes conflitantes.
- [x] Archive faz soft delete para `ARCHIVED`, preserva o registro e retorna
  `RESOURCE_ARCHIVED` em nova tentativa após o arquivamento.
- [x] Todos os writes reservam `application_commands` na mesma transaction;
  retries compatíveis retornam o recurso original, enquanto reuso incompatível
  retorna `COMMAND_ID_REUSED`, inclusive sob concorrência.
- [x] Erros de domínio e de unicidade esperados atravessam `S02Result`; falhas
  inesperadas continuam disponíveis para a camada de observabilidade.
- [x] Verificados typecheck, lint isolado do módulo, testes unitários focados,
  migration check e smoke/integridade no PostgreSQL 16 de testes.

## Referências

- [`Application Commands`](../../docs/techspec.md#69-application-commands);
- [`Server Actions`](../../docs/techspec.md#70-server-actions);
- [`Idempotência`](../../docs/techspec.md#72-idempotência);
- [`Accounts`](../../docs/techspec.md#14-accounts).
