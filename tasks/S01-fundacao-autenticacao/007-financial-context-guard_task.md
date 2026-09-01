# T07 — Contexto autenticado e guards de tenancy

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 4
- Dependências: T06
- Paralelização: Desbloqueia T08, T09 e T11

## Objetivo

Centralizar autenticação e resolução do espaço financeiro para impedir que cada módulo implemente sua própria interpretação de usuário ou tenant.

## Escopo

- Implementar helper para obter o usuário autenticado.
- Implementar requireAuth para rotas, layouts e actions privadas.
- Implementar requireFinancialContext retornando userId e householdId validados.
- Resolver o household a partir da sessão e da membership persistida.
- Quando houver mais de uma membership, aplicar a decisão server-side registrada em T01 e revalidar a associação.
- Impedir que householdId vindo de formulário, query string ou payload seja usado como autoridade.
- Aplicar o guard também a Server Actions e endpoints privados; middleware pode ser usado apenas como otimização de navegação.
- Padronizar erros esperados de não autenticado, membership ausente e contexto inválido.
- Evitar que objetos de domínio ou dados sensíveis atravessem boundaries do React/Next sem necessidade.

## Critérios de aceite

- [ ] Usuário não autenticado não acessa rotas privadas.
- [ ] Usuário autenticado obtém um contexto válido.
- [ ] Um usuário sem membership não recebe acesso arbitrário a um household.
- [ ] Um householdId adulterado no request não altera o contexto resolvido.
- [ ] Todas as entradas de T07 são revalidadas no servidor.
- [ ] Existem testes unitários para os casos autenticado, não autenticado e membership inválida.
- [ ] A API do helper é reutilizável pelas próximas slices.
