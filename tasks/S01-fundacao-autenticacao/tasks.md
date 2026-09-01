# Tasks — S01: Fundação, autenticação e espaço financeiro compartilhado

## Objetivo

Implementar o caminho mínimo completo da aplicação: projeto executável, PostgreSQL, migrations, Google OAuth, usuário local, espaço financeiro compartilhado, isolamento entre espaços, shell autenticado, observabilidade, health/readiness, testes e deploy.

O índice segue o escopo e os critérios de aceite de [S01](../../docs/S01-fundacao-autenticacao.md:20), o modelo de tenancy de [TechSpec — Tenancy](../../docs/techspec.md:181), o fluxo de autenticação de [TechSpec — Autenticação](../../docs/techspec.md:280) e as regras de primeiro acesso da [PRD](../../docs/prd.md:630).

## Status atual

T01–T17 estão concluídas e validadas localmente/CI. T18 está bloqueada até que a configuração e as credenciais de produção estejam disponíveis; portanto, o slice permanece em validação de produção.

## Premissas e decisões

- Household/households é o nome canônico de domínio e persistência; Espaço financeiro é o texto da interface.
- O usuário persistido pelo Better Auth será a entidade de usuário local, salvo decisão documentada em contrário.
- Cadastro e login da V1 significam Google OAuth. Senha local não faz parte do slice.
- O relacionamento será N:N através de household_members, mesmo que normalmente cada usuário tenha um único household.
- Convites serão links copiáveis, com token armazenado apenas como hash, sem serviço de e-mail.
- O tenant será sempre derivado da sessão e da membership. O cliente nunca será autoridade para escolher householdId.
- RLS, papéis, permissões, auditoria, Redis, rate limiting preventivo e onboarding financeiro estão fora do slice.

## Ordem de execução

### Onda 1 — Bootstrap

1. [x] [T01 — Bootstrap técnico e contratos](001-bootstrap_task.md)

### Onda 2 — Infraestrutura independente

2. [x] [T02 — PostgreSQL, Drizzle e migrations](002-database-migrations_task.md)
3. [x] [T03 — Geração centralizada de UUIDv7](003-uuidv7_task.md)
4. [x] [T13 — Sentry e observabilidade segura](013-sentry-observability_task.md)

T02, T03 e T13 podem ser executadas em paralelo depois de T01.

### Onda 3 — Autenticação, schema e entrada pública

5. [x] [T04 — Better Auth e Google OAuth](004-better-auth-google_task.md)
6. [x] [T05 — Schema de tenancy e espaço financeiro](005-tenancy-schema_task.md)
7. [x] [T10 — Interface pública de autenticação](010-public-auth-ui_task.md)
8. [x] [T14 — Health e readiness](014-health-readiness_task.md)

T04 e T05 podem ser desenvolvidas em paralelo, mas a integração das migrations deve ser serializada. T10 pode usar o contrato de autenticação enquanto o backend é implementado. T14 pode avançar em paralelo após T02.

### Onda 4 — Provisionamento e contexto

9. [x] [T06 — Provisionamento idempotente do primeiro acesso](006-first-access-provisioning_task.md)
10. [x] [T07 — Contexto autenticado e guards de tenancy](007-financial-context-guard_task.md)

T06 deve estar concluída antes de T07.

### Onda 5 — Compartilhamento, UI privada e testes

11. [x] [T08 — Isolamento entre espaços financeiros](008-cross-space-isolation_task.md)
12. [x] [T09 — Convites por link no backend](009-invite-backend_task.md)
13. [x] [T11 — Shell autenticado e tela inicial vazia](011-authenticated-shell_task.md)
14. [x] [T12 — Interface de compartilhamento e aceite de convite](012-invite-ui_task.md)
15. [x] [T15 — Testes unitários e de integração](015-unit-integration-tests_task.md)
16. [x] [T16 — E2E smoke de autenticação](016-e2e-smoke_task.md)

T08 e T09 podem ser executadas em paralelo depois de T07. T11 também pode avançar em paralelo com elas. T12 depende de T09 e T11. T15 pode ser desenvolvida em paralelo com T12 e T16 quando os contratos de backend estiverem estáveis. T16 depende da UI pública e privada.

### Onda 6 — Gates e produção

17. [x] [T17 — CI e gates de qualidade](017-ci-quality-gates_task.md)
18. [ ] [T18 — Deploy e validação de produção](018-production-deploy_task.md)

T18 é a etapa de fechamento e não deve ser considerada concluída apenas porque o build passou: exige migration, smoke test, convite e observabilidade em produção.

## Matriz de dependências

| ID | Task | Dependências | Paralelização principal |
|---|---|---|---|
| T01 | Bootstrap técnico e contratos | — | Desbloqueia todas |
| T02 | PostgreSQL, Drizzle e migrations | T01 | Com T03 e T13 |
| T03 | UUIDv7 | T01 | Com T02 e T13 |
| T04 | Better Auth e Google OAuth | T02, T03 | Com T05 e T10 |
| T05 | Schema de tenancy | T02, T03 | Com T04; migration integrada em série |
| T06 | Primeiro acesso | T04, T05 | Com T10 |
| T07 | Contexto e guards | T06 | — |
| T08 | Isolamento | T05, T07 | Com T09 e T11 |
| T09 | Convites backend | T05, T07 | Com T08 e T11 |
| T10 | UI pública de auth | T04 | Com T06–T09 |
| T11 | Shell autenticado | T07, T10 | Com T08 e T09 |
| T12 | UI de convite | T09, T11 | Com T15 e T16 |
| T13 | Sentry | T01 | Com T02–T12 |
| T14 | Health/readiness | T02 | Com T04, T05 e T10 |
| T15 | Unitários/integração | T06–T09 | Com T12 e T16 |
| T16 | E2E smoke | T10, T11 | Com T15 |
| T17 | CI | T15, T16 | Configuração pode começar antes |
| T18 | Deploy/produção | T02, T04, T13, T14, T17 | Fechamento serial |

## Caminho crítico

T01 → T02/T03 → T04/T05 → T06 → T07 → T09/T11 → T12 → T16 → T17 → T18

T13 e T14 ficam parcialmente fora do caminho crítico, mas são gates obrigatórios para considerar o slice pronto.

## Definition of Done do slice

- [ ] Usuário não autenticado não acessa rotas privadas.
- [ ] Usuário novo autentica via Google e recebe um household persistido.
- [ ] Repetição do primeiro acesso não cria duplicidades.
- [ ] Um segundo usuário pode entrar no mesmo household via link.
- [ ] Um usuário de outro household não consegue acessar dados do primeiro.
- [ ] IDs de domínio usam UUIDv7.
- [ ] Sentry captura erros inesperados sem dados sensíveis.
- [ ] Health/readiness validam a aplicação publicada.
- [ ] CI executa os gates definidos.
- [ ] Produção sobe com migration controlada, banco válido e smoke test aprovado.
