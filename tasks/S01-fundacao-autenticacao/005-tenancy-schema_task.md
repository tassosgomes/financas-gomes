# T05 — Schema de tenancy e espaço financeiro

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 3
- Dependências: T02 e T03
- Paralelização: Pode ser desenvolvida em paralelo com T04, mas a migration final deve ser integrada depois de confirmado o schema do Better Auth

## Objetivo

Criar a raiz de isolamento e o relacionamento entre usuários e espaços financeiros.

## Escopo

- Criar a tabela households, com ID UUIDv7 e metadados mínimos do espaço.
- Criar household_members com:
  - chave composta por householdId e userId;
  - foreign keys para usuário e household;
  - timestamp de associação;
  - unicidade que impeça membership duplicada.
- Criar household_invites com:
  - ID UUIDv7;
  - householdId;
  - tokenHash;
  - expiresAt;
  - usedAt;
  - createdBy;
  - foreign keys e índices necessários.
- Criar índices para buscar memberships por usuário e convites por hash/validade.
- Aplicar constraints para impedir referências inexistentes.
- Usar FKs compostas quando uma referência depender simultaneamente de recurso e household.
- Integrar o schema com as tabelas de usuário do Better Auth.
- Gerar e aplicar a migration versionada.

## Critérios de aceite

- [ ] Um usuário pode pertencer a mais de um household no schema.
- [ ] A mesma associação usuário/household não pode ser inserida duas vezes.
- [ ] Um convite sempre pertence a um household e a um criador válido.
- [ ] O banco rejeita referências para usuário ou household inexistentes.
- [ ] Tokens de convite não são armazenados em texto puro.
- [ ] Os IDs de domínio usam UUIDv7.
- [ ] Não existem colunas ou tabelas de papéis, ownership granular ou permissões por recurso.
- [ ] RLS não é introduzido nesta slice, conforme a TechSpec.

## Notas de implementação

O nome de persistência deve ser único em todo o projeto. A recomendação é usar households, mantendo Espaço financeiro apenas como termo de apresentação.
