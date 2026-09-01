# T04 — Better Auth e Google OAuth

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 3
- Dependências: T02 e T03
- Paralelização: Pode ser desenvolvida em paralelo com T05 e T10; integração das migrations deve ser serializada

## Objetivo

Integrar autenticação real com Better Auth e Google OAuth, mantendo usuários e sessões persistidos no PostgreSQL.

## Escopo

- Configurar Better Auth no backend e no cliente.
- Configurar Google OAuth, incluindo client ID, secret e URLs de callback por ambiente.
- Criar ou registrar as tabelas exigidas pelo Better Auth através de migration.
- Persistir o usuário autenticado no banco local.
- Configurar sessões persistentes por aproximadamente 30 dias.
- Implementar obtenção da sessão no servidor.
- Implementar logout.
- Tratar falhas de callback, sessão expirada e configuração ausente sem expor detalhes sensíveis.
- Definir o contrato usado pelo frontend para login, logout, loading e erros.
- Garantir que o fluxo seja Google OAuth; senha local não faz parte da V1.

## Critérios de aceite

- [ ] Um usuário consegue iniciar e concluir o login via Google em ambiente configurado.
- [ ] O usuário e a sessão ficam persistidos no PostgreSQL.
- [ ] Uma sessão válida sobrevive a uma nova requisição e respeita a duração configurada.
- [ ] Logout invalida a sessão.
- [ ] Falhas de autenticação produzem um estado tratável no frontend.
- [ ] Tokens, cookies e secrets não aparecem em logs ou erros enviados ao Sentry.
- [ ] O schema do Better Auth é compatível com as tabelas de tenancy de T05.

## Fora de escopo

- Senha local, recuperação de senha, MFA próprio ou outros provedores OAuth.
- Convite por e-mail.
