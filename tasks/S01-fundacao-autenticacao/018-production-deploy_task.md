# T18 — Deploy e validação de produção

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Bloqueada — aguardando configuração e credenciais de produção
- Onda: 6
- Dependências: T02, T04, T13, T14 e T17
- Paralelização: Não; é o fechamento integrado do slice

## Objetivo

Publicar a aplicação com banco, autenticação, observabilidade e migrations funcionando de ponta a ponta.

## Escopo

- Configurar projeto Vercel.
- Configurar banco Neon e variáveis de ambiente de produção.
- Configurar URLs de callback Google para o domínio publicado.
- Configurar DSN, ambiente e release do Sentry.
- Executar migration de produção através de etapa controlada anterior ao deploy da aplicação.
- Publicar a aplicação somente após a migration compatível.
- Validar health e readiness publicados.
- Executar smoke test de login, primeiro acesso, área autenticada e logout.
- Validar o fluxo de convite com dois usuários de teste controlados.
- Confirmar que logs e eventos não contêm secrets ou dados financeiros.
- Registrar procedimento de rollback e de reexecução segura de migration.
- Validar novamente docker build/docker compose para preservar portabilidade.

## Critérios de aceite

- [ ] O deploy de produção conclui com conexão válida ao Neon.
- [ ] Migrations são aplicadas antes do tráfego da nova versão.
- [ ] Nenhuma migration roda no boot.
- [ ] Um usuário novo consegue autenticar via Google.
- [ ] O primeiro acesso cria um household persistido.
- [ ] Um segundo usuário entra no mesmo household por convite.
- [ ] Health e readiness respondem conforme esperado.
- [ ] Erros inesperados chegam ao Sentry com dados sensíveis removidos.
- [ ] O smoke test de produção passa.
- [ ] O procedimento de rollback está documentado.
