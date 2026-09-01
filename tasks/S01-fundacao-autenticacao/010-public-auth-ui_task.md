# T10 — Interface pública de autenticação

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 3
- Dependências: T04
- Paralelização: Pode executar em paralelo com T06, T07, T08 e T09 usando o contrato de T04

## Objetivo

Entregar a entrada pública mínima para login/cadastro via Google e tornar claros os estados da autenticação.

## Escopo

- Criar tela pública de entrada.
- Exibir ação para continuar com Google.
- Tratar estados de carregamento, sucesso, cancelamento e erro.
- Redirecionar usuário autenticado para a área privada.
- Redirecionar usuário não autenticado para a entrada ao acessar área privada.
- Exibir mensagens compreensíveis sem revelar secrets, tokens ou detalhes internos.
- Tratar callback incompleto, sessão expirada e falhas temporárias.
- Representar cadastro como primeiro login Google, sem formulário de senha local.

## Critérios de aceite

- [ ] Usuário não autenticado consegue iniciar o login.
- [ ] Usuário autenticado não fica preso na tela de entrada.
- [ ] O estado de loading impede ações duplicadas durante o login.
- [ ] Erros de autenticação têm estado visual tratável.
- [ ] Nenhum householdId é coletado ou enviado pelo cliente durante o login.
- [ ] A interface funciona em desktop e possui responsividade básica para consulta móvel.
