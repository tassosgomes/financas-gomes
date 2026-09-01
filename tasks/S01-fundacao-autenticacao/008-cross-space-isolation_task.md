# T08 — Isolamento entre espaços financeiros

- Slice: S01 — Fundação, autenticação e espaço financeiro compartilhado
- Status: Concluída
- Onda: 5
- Dependências: T05 e T07
- Paralelização: Pode executar em paralelo com T09 e T11

## Objetivo

Provar e tornar obrigatório que o acesso a dados seja limitado ao household resolvido no contexto autenticado.

## Escopo

- Criar convenções/helpers para queries tenant-scoped.
- Garantir que leituras e escritas privadas recebam o contexto do servidor.
- Verificar que dados de households distintos não sejam retornados por IDs forjados.
- Verificar que um membro de A não consiga criar ou alterar membership, household ou convite de B sem autorização de contexto.
- Aplicar constraints e FKs compostas onde a integridade depender de householdId.
- Criar uma fixture/repository de recurso protegido reutilizável pelas próximas slices, sem antecipar o Ledger.
- Documentar que o browser não possui acesso direto ao PostgreSQL.
- Manter RLS fora da V1 conforme decisão da TechSpec.

## Critérios de aceite

- [ ] Um usuário de A não consegue consultar dados de B através de ID conhecido.
- [ ] Um usuário de A não consegue criar uma associação para B adulterando o payload.
- [ ] O banco rejeita uma associação cross-tenant coberta por FK composta.
- [ ] Todas as queries privadas de S01 usam o contexto server-side.
- [ ] Existe teste de integração com pelo menos dois households.
- [ ] A convenção fica documentada para adoção por S02 em diante.
