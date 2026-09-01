# S01 — Fundação, autenticação e espaço financeiro compartilhado

## Objetivo

Colocar a aplicação em produção com o caminho mínimo completo pelo stack e permitir que usuários autenticados acessem um mesmo espaço financeiro compartilhado.

## Status atual

Implementação, testes e gates de CI concluídos. O deploy e a validação em produção aguardam configuração externa (Neon, Vercel, Google OAuth, Sentry e usuários de smoke); por isso, este slice ainda não está concluído em produção.

## Valor entregue

O usuário consegue criar sua conta, entrar no sistema e chegar a uma área autenticada persistida no banco. Um segundo usuário pode fazer parte do mesmo espaço financeiro, sem modelo complexo de permissões.

## Fluxo principal

1. Usuário acessa a aplicação.
2. Cria conta ou autentica.
3. Ao primeiro acesso, é associado a um espaço financeiro.
4. Acessa a área autenticada.
5. Um segundo usuário pode ser associado ao mesmo espaço financeiro.
6. Ambos veem os dados pertencentes àquele espaço.

## Escopo

- Projeto executando localmente e em produção.
- Banco de dados e migrations funcionando.
- Autenticação.
- Entidade de usuário.
- Entidade que representa o contexto/espaço financeiro compartilhado.
- Associação de mais de um usuário ao mesmo espaço.
- Isolamento de dados entre espaços financeiros diferentes.
- Layout autenticado mínimo.
- UUIDv7 para IDs de domínio.
- Sentry configurado no frontend e backend aplicáveis.
- Health/readiness mínimos para validar a aplicação publicada.

## Fora de escopo

- Papéis e permissões diferentes entre usuários.
- Auditoria de ações por usuário.
- Convites sofisticados, aprovação ou ownership granular.
- App nativo.
- Otimização específica para uso mobile.

## Dependências

Nenhuma.

## Dados / domínio

Estruturas mínimas esperadas:

- `users`
- `financial_spaces` ou equivalente
- `financial_space_users` ou equivalente

Todos os registros futuros de domínio devem carregar referência ao espaço financeiro adequado para garantir isolamento.

## Backend

- Integração com provedor de autenticação definido na TechSpec.
- Criação/obtenção do usuário local após autenticação.
- Criação do espaço financeiro inicial.
- Middleware/guard para área autenticada.
- Helper central para obter `currentUser` e `currentFinancialSpace`.
- Proteção para impedir acesso cross-space.

## Frontend

- Tela de entrada/cadastro.
- Estado de carregamento e erro de autenticação.
- Shell/layout autenticado.
- Tela inicial vazia, suficiente para provar sessão e contexto financeiro.

## Critérios de aceite

- [ ] Usuário não autenticado não acessa rotas privadas.
- [ ] Usuário autenticado acessa a aplicação sem erro.
- [ ] Primeiro acesso cria/associa corretamente o espaço financeiro.
- [ ] Dois usuários podem pertencer ao mesmo espaço financeiro.
- [ ] Dados de um espaço financeiro nunca são retornados para usuário de outro espaço.
- [ ] IDs novos de domínio usam UUIDv7.
- [ ] Erros inesperados relevantes chegam ao Sentry.
- [ ] Deploy de produção sobe com migrations e conexão com banco válidas.

## Testes

- Unitário para helpers de contexto/autorização.
- Integração para criação do usuário/espaço.
- Integração de isolamento entre dois espaços.
- E2E mínimo: login → área autenticada → logout.

## Observabilidade

- Sentry inicializado.
- Captura de exceções do servidor.
- Captura de erro fatal no cliente.
- Contexto de ambiente/release quando disponível.

## Tarefas internas sugeridas

1. Criar projeto/base e configuração de ambientes.
2. Configurar banco e migrations.
3. Configurar geração UUIDv7.
4. Integrar autenticação.
5. Criar modelo de usuário e espaço financeiro.
6. Implementar resolução do contexto autenticado.
7. Implementar isolamento obrigatório por espaço.
8. Criar shell autenticado.
9. Configurar Sentry.
10. Criar testes de integração e E2E smoke.
11. Publicar e validar produção.

## Definition of Done

Um usuário novo consegue entrar na aplicação publicada e receber um espaço financeiro persistido; um segundo usuário pode compartilhar esse espaço; isolamento entre espaços é comprovado por teste automatizado.
