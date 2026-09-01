# T14 — Health e readiness

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 3
- Dependências: T02
- Paralelização: Pode executar em paralelo com T04, T05, T10 e T13

## Objetivo

Disponibilizar sinais mínimos para saber se a aplicação está viva e se está pronta para receber tráfego.

## Escopo

- Criar endpoint público de health/liveness.
- Criar endpoint público de readiness.
- Fazer health verificar apenas a capacidade do processo responder.
- Fazer readiness verificar conexão com PostgreSQL.
- Fazer readiness detectar schema ausente ou incompatível quando isso puder ser verificado com segurança.
- Retornar status HTTP coerente para estados saudável e indisponível.
- Não retornar secrets, connection strings ou detalhes internos do banco.
- Documentar os endpoints para Vercel, monitoramento e smoke test.

## Critérios de aceite

- [ ] Health responde quando a aplicação está viva, mesmo que o banco esteja indisponível.
- [ ] Readiness falha quando o banco não pode ser alcançado.
- [ ] Readiness não retorna informação sensível.
- [ ] Os endpoints não exigem sessão de usuário.
- [ ] A aplicação não executa migration automaticamente como efeito de health/readiness.
