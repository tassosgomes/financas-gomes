# T15 — Testes unitários e de integração

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 5
- Dependências: T06, T07, T08 e T09
- Paralelização: Pode executar em paralelo com T12 e T16 quando os contratos de backend estiverem estáveis

## Objetivo

Comprovar automaticamente autenticação, provisionamento, associação compartilhada e isolamento entre households.

## Escopo

- Configurar Vitest para testes unitários.
- Configurar PostgreSQL real para testes de integração, usando Docker/Testcontainers quando apropriado.
- Criar fixtures determinísticas para usuários, households, memberships e convites.
- Cobrir unitariamente:
  - resolução do usuário;
  - requireAuth;
  - requireFinancialContext;
  - erros esperados de contexto;
  - geração UUIDv7.
- Cobrir por integração:
  - criação do usuário e household no primeiro acesso;
  - idempotência em chamadas repetidas;
  - concorrência básica ou constraint equivalente;
  - dois usuários no mesmo household;
  - dois households isolados;
  - tentativa de acesso com ID forjado;
  - convite válido, expirado, inválido e já utilizado;
  - constraints e FKs cross-tenant;
  - rollback de uma operação parcial.
- Garantir que os testes limpem ou recriem o banco sem depender de estado compartilhado.

## Critérios de aceite

- [ ] Os testes rodam contra PostgreSQL real, não SQLite.
- [ ] Existe teste automatizado para o fluxo de primeiro acesso.
- [ ] Existe teste automatizado para dois usuários no mesmo espaço.
- [ ] Existe teste automatizado de isolamento entre dois espaços.
- [ ] Existe teste para convite de uso único e expiração.
- [ ] Existe teste para tentativa de associação cross-tenant.
- [ ] A suíte é reproduzível localmente e no CI.
