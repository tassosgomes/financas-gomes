# T13 — Sentry e observabilidade segura

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 2
- Dependências: T01
- Paralelização: Pode executar em paralelo com T02, T03, T04, T05 e frontend

## Objetivo

Detectar erros inesperados no cliente e no servidor sem enviar informações financeiras ou credenciais para terceiros.

## Escopo

- Inicializar Sentry no frontend.
- Inicializar Sentry no backend e nos pontos de erro aplicáveis do Next.js.
- Configurar ambiente e release quando disponíveis.
- Capturar exceções inesperadas do servidor.
- Capturar erro fatal do cliente.
- Adicionar contexto operacional permitido, como tipo de evento, use case, duração e IDs opacos.
- Remover ou bloquear cookies, tokens, Authorization, payloads financeiros, descrições, nomes de contas e notas.
- Evitar registrar token bruto de convite.
- Criar um caminho controlado para validar que um erro de teste chega ao projeto correto.
- Documentar como configurar DSN local, Preview e produção.

## Critérios de aceite

- [ ] Cliente e servidor inicializam Sentry somente quando configurados.
- [ ] Uma exceção controlada é capturada no ambiente esperado.
- [ ] Eventos não contêm cookies, tokens, Authorization ou payload financeiro.
- [ ] Ambiente e release aparecem quando disponíveis.
- [ ] Falhas de Sentry não derrubam o fluxo principal da aplicação.
- [ ] Logs operacionais não permitem reconstruir a vida financeira do usuário.
