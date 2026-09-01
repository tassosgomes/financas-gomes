# S02 — Contas e categorias

Plano executável do slice definido em [`docs/S02-contas-categorias.md`](../../docs/S02-contas-categorias.md).

## Objetivo do slice

Permitir que o usuário prepare a estrutura mínima para os próximos fluxos financeiros:

- cadastrar, listar, editar e arquivar contas;
- cadastrar, listar, editar e arquivar categorias;
- manter todos os registros isolados pelo espaço financeiro;
- preservar histórico por meio de arquivamento, em vez de deleção destrutiva;
- disponibilizar entidades ativas para os próximos fluxos.

## Fronteira adotada

Existe uma sobreposição entre este documento e a TechSpec: o Slice 1 da TechSpec também menciona `Conta`, enquanto o S02 inclui contas e categorias. Para evitar retrabalho, este plano considera:

- o S02 responsável pelo CRUD dos metadados de contas;
- saldo inicial, `FinancialEvent`, `AccountEntry`, saldo derivado e extrato fora deste slice;
- nenhum campo `accounts.balance`;
- status persistido canônico `ACTIVE | ARCHIVED`, ainda que a UI possa dizer “Ativa” e “Arquivada”;
- categorias com no máximo dois níveis, conforme a TechSpec;
- associação categoria → caixinha padrão adiada para o slice de Caixinhas;
- nenhuma operação de hard delete exposta pelo S02.

Se a implementação do Slice 1 já tiver criado `accounts`, as tasks de schema e backend devem estender e reutilizar essa tabela, nunca recriá-la.

## Pré-requisito

S01 precisa estar concluído e fornecer, no mínimo:

- autenticação funcionando;
- resolução do usuário atual e do espaço financeiro atual;
- membership entre usuário e espaço;
- isolamento entre espaços;
- migrations e PostgreSQL funcionando;
- geração de UUIDv7.

Referências: [`S01`](../../docs/S01-fundacao-autenticacao.md), [`Tenancy`](../../docs/techspec.md#5-tenancy), [`UUID`](../../docs/techspec.md#79-uuid).

## Ordem das tasks

| Ordem | Task | Status | Dependências | Paralelização | Entrega principal |
|---|---|---|---|---|---|
| 1 | [Contrato e fronteira](01-contrato-do-slice_task.md) | Concluída | S01 | Bloqueia todas | Contrato fechado e decisões registradas |
| 2 | [Schema e migrations](02-schema-migrations_task.md) | Concluída | T01 | Paralela com T03, T04 e T07 | Tabelas, constraints e índices |
| 3 | [Domínio e validações](03-dominio-validacoes_task.md) | Concluída | T01 | Paralela com T02 e T04 | Tipos e invariantes testáveis |
| 4 | [Acesso tenant-scoped](04-tenant-scoped-acesso_task.md) | Concluída | S01, T01 | Paralela com T02 e T03 | Contexto e queries isoladas |
| 5 | [Use cases de contas](05-use-cases-contas_task.md) | Concluída | T02, T03, T04 | Paralela com T06 | CRUD de contas |
| 6 | [Use cases de categorias](06-use-cases-categorias_task.md) | Concluída | T02, T03, T04 | Paralela com T05 | CRUD de categorias |
| 7 | [Adapters e base de UI](07-adapters-ui-base_task.md) | Concluída | T01, T03, T04 | Pode iniciar antes de T05/T06 | Server Actions e componentes comuns |
| 8 | [UI de contas](08-ui-contas_task.md) | Concluída | T05, T07 | Paralela com T09 | Fluxo visual de contas |
| 9 | [UI de categorias](09-ui-categorias_task.md) | Concluída | T06, T07 | Paralela com T08 | Fluxo visual de categorias |
| 10 | [Testes unitários](10-testes-unitarios_task.md) | Concluída | T03 | Paralela com T05 e T06 | Cobertura de regras de domínio |
| 11 | [Testes de integração](11-testes-integracao_task.md) | Concluída | T02, T04, T05, T06 | Paralela com T08, T09 e T12 | Prova de persistência e isolamento |
| 12 | [Observabilidade e erros](12-observabilidade-erros_task.md) | Concluída | T05, T06, T07 | Paralela com T08, T09 e T11 | Erros operáveis e sem vazamento de dados |
| 13 | [E2E e integração final](13-e2e-integracao-final_task.md) | Bloqueada | T08, T09, T10, T11, T12 | Etapa final | Aceite do slice e gate de entrega |

## Ondas de execução

### Onda 0 — Gate

Executar T01. Nenhuma implementação deve começar antes de resolver a sobreposição com o Slice 1 e os campos obrigatórios.

### Onda 1 — Fundação paralela

Executar T02, T03 e T04 em paralelo. T07 pode começar com contratos estáveis e mocks, sem esperar o CRUD completo.

### Onda 2 — Backend

Executar T05 e T06 em paralelo. T10 pode acompanhar as duas implementações.

### Onda 3 — Produto e qualidade

Executar T08, T09, T11 e T12 em paralelo, respeitando suas dependências específicas.

### Onda 4 — Gate final

Executar T13 somente quando as duas interfaces, os testes automatizados e o tratamento de erros estiverem integrados.

## Grafo resumido

```text
S01 → T01
       ├─→ T02 ─┐
       ├─→ T03 ─┼─→ T05 ─→ T08 ─┐
       └─→ T04 ─┘    └→ T06 ─→ T09 ─┼─→ T13
              └──────────→ T07 ─────┘
                  T10, T11 e T12 funcionam como trilhas de qualidade
```

## Caminho crítico

`S01 → T01 → T02/T03/T04 → T05/T06 → T08/T09 → T13`

## Definition of Done do S02

- usuário autenticado cria pelo menos uma conta;
- usuário cria e edita uma categoria;
- nenhum usuário acessa conta ou categoria de outro espaço;
- campos obrigatórios são rejeitados no client e no servidor;
- conta/categoria arquivada não é apagada nem quebra referências futuras;
- entidades arquivadas não aparecem nas opções de novos lançamentos;
- testes unitários, integração e E2E passam;
- erros inesperados chegam ao Sentry sem dados financeiros sensíveis;
- lint, typecheck, build e migrations passam no CI.

Referências: [`Critérios de aceite do S02`](../../docs/S02-contas-categorias.md#critérios-de-aceite), [`Deletes`](../../docs/techspec.md#115-deletes), [`Testes`](../../docs/techspec.md#116-testes).
