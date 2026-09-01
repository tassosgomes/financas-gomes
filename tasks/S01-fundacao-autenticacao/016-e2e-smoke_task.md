# T16 — E2E smoke de autenticação

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 5
- Dependências: T10 e T11
- Paralelização: Pode executar em paralelo com T15; depende da UI autenticada pronta

## Objetivo

Validar no navegador o caminho crítico de entrada e saída da aplicação.

## Escopo

- Configurar Playwright para o fluxo E2E crítico.
- Criar um mecanismo de teste para autenticação Google, como provider fake ou callback controlado apenas em ambiente de teste.
- Garantir que o mecanismo de teste não seja habilitado em Preview ou produção.
- Cobrir login.
- Cobrir redirecionamento para a área autenticada.
- Cobrir criação/persistência do contexto no primeiro acesso.
- Cobrir logout e retorno à área pública.
- Validar que uma rota privada não é acessível após logout.

## Critérios de aceite

- [ ] O teste executa de forma determinística sem depender de uma conta Google real.
- [ ] O fluxo login → área autenticada → logout passa.
- [ ] O primeiro acesso deixa usuário e household persistidos no banco de teste.
- [ ] Após logout, a rota privada redireciona ou responde como não autenticada.
- [ ] O bypass/test provider não é possível em produção.
