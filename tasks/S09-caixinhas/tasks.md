# Tasks — S09: Caixinhas

## Objetivo

Entregar as Caixinhas ponta a ponta: o usuário poderá criar uma finalidade,
reservar recursos por meio de movimentos auditáveis, acompanhar saldo,
progresso e rollover, e ver a reserva protegida refletida no cálculo de
“Quanto posso gastar”. O saldo da Caixinha será sempre derivado; nenhuma
coluna de saldo persistido será criada.

Este plano foi derivado de [`docs/S09-caixinhas.md`](../../docs/S09-caixinhas.md),
[`docs/prd.md`](../../docs/prd.md) e [`docs/techspec.md`](../../docs/techspec.md),
com atenção especial às seções 5.1, 6.2–6.3, 8, 9, 12, 17, 21 e 27 do PRD e
às seções 32, 35–41, 69–80, 102, 114–117 e 121 da TechSpec.

## Fronteira do slice

- O S09 é o proprietário do domínio/backend de Caixinhas, movimentos, saldo
  derivado, rollover e progresso. A porta `s09.v1` criada no S08 é o contrato
  de integração; o S08 continua sendo o proprietário da fórmula e do read
  model público de Spendable.
- A UI usa o termo **Caixinhas** e a rota prevista é `/budgets`. Nomes
  internos como `Budget` ou `BudgetEnvelope` podem ser usados somente se o
  mapeamento ficar explícito no contrato.
- A posição da Caixinha é derivada em centavos: aportes somam, retiradas
  subtraem, despesas associadas reduzem e estornos seguem a data efetiva. O
  saldo negativo é preservado e explicado, mas nunca aumenta a proteção global.
- Aporte, retirada e transferência entre Caixinhas são writes idempotentes,
  tenant-scoped, atômicos e com referências únicas. Alterações financeiras
  preservam histórico por movimento compensatório/correção, sem hard delete.
- Datas financeiras usam `Temporal.PlainDate`/PostgreSQL `DATE`, dinheiro usa
  `Money`/`bigint`, valores serializados usam strings de centavos e IDs usam
  UUIDv7. O browser nunca escolhe `householdId` nem fornece autoridade de
  autorização.

## Decisões normativas do plano

- A Caixinha tem vigência. `activeFrom` inicia a proteção; `closedOn` é
  efetivo: consultas anteriores ao encerramento preservam a proteção
  histórica, enquanto a data de encerramento e as posteriores não protegem o
  spendable global. O histórico de movimentos permanece consultável.
- Não existe `boxes.balance`, `budgets.balance` ou snapshot de proteção. O
  read model calcula a posição a partir dos movimentos/fontes financeiras até
  `asOf`, com rollover positivo ou negativo entre períodos.
- A porta do S08 recebe apenas `asOf`, cenário, horizonte e referências já
  refletidas. O provider do S09 resolve tenancy antes da porta e devolve
  `BOX_BALANCE_PROTECTED`/`BOX_BALANCE` no formato `s09.v1`.
- Uma contribuição, retirada, despesa ou ocorrência já representada por entry
  `POSTED` ou item do forecast não pode gerar ajuste de reserva novamente.
  Parcelas, compra econômica e pagamento de cartão não são fontes concorrentes
  de reserva.
- A associação entre Caixinha e categoria, a representação da regra de
  alocação (percentual da receita do PRD versus valor efetivo-datado previsto
  na TechSpec), a data de aplicação de aportes e a semântica de ausência de
  regra são decisões obrigatórias da T01. Nenhuma task posterior deve
  escolher uma interpretação silenciosa.
- A soma de uma distribuição automática de receita deve ser exatamente o
  valor distribuído, com arredondamento determinístico e histórico de regras;
  alterações futuras não reescrevem períodos anteriores.

## Dependências e gates

S01 fornece autenticação, `Household`, contexto financeiro e migrations. S02
fornece categorias e contas; S03 fornece o ledger e eventos realizados; S06
fornece a semântica de compras/parcelas; S07 fornece as referências de forecast;
S08 fornece a porta `SpendableReserveAdapter`, a versão `s09.v1` e os cenários
de não dupla contagem. A modelagem pura pode começar após os contratos de S01 e
do handoff S08, mas a integração vertical exige os contratos de S02/S03/S06/S07.

## Ordem de execução

### Onda 0 — Contrato e gate

1. [T01 — Contrato, fronteira e gate de dependências](001-contrato-e-gate-dependencias_task.md)

T01 é serial. Ela fecha as ambiguidades de categoria, alocação, vigência,
movimentos e integração antes de schema, use cases ou telas.

### Onda 1 — Fundações paralelas

2. [T02 — Domínio, saldo derivado e rollover](002-dominio-saldo-rollover_task.md)
3. [T03 — Schema, migrations e integridade](003-schema-migrations-integridade_task.md)
4. [T04 — Vigência, alocação e regras temporais](004-regras-vigencia-alocacao_task.md)
5. [T09 — Observabilidade segura](009-observabilidade-segura_task.md)
6. [T10 — Contratos de UI e componentes compartilhados](010-contratos-ui-componentes_task.md)

T02–T04, T09 e T10 podem ser desenvolvidas depois de T01. T03 pode preparar
schema enquanto T02/T04 implementam regras puras; a aplicação das migrations
deve ser serializada. T09 e T10 não devem esperar o CRUD completo, mas só
fecham quando os contratos de backend estiverem estáveis.

### Onda 2 — Backend vertical

7. [T05 — Reads tenant-safe, saldo e progresso](005-reads-tenant-safe-saldo-progress_task.md)
8. [T06 — CRUD e ciclo de vida da Caixinha](006-use-cases-crud-lifecycle_task.md)
9. [T07 — Aportes, retiradas e transferências](007-movimentos-aportes-retiradas-transferencias_task.md)
10. [T08 — Provider `s09.v1` e integração com Spendable](008-adapter-s09-integracao-spendable_task.md)

T05 integra domínio, schema e regras. T06 pode ser preparada junto com T05,
mas a integração final depende dos reads/constraints. T07 depende da forma
final de lifecycle e idempotência de T06. T08 pode preparar seu adapter puro
em paralelo a T06/T07, mas só integra com S08 depois de existirem reads
tenant-safe e movimentos persistidos.

### Onda 3 — Experiência do produto

11. [T11 — UI de lista, criação e manutenção](011-ui-lista-criacao-manutencao_task.md)
12. [T12 — UI de movimentos, progresso e impacto](012-ui-movimentos-progresso-impacto_task.md)

T11 depende de T06/T10 e T12 depende de T07/T08/T10. As duas podem ser
desenvolvidas em paralelo após os contratos serializáveis; ambas devem usar
Server Actions finas e revalidação server-side.

### Onda 4 — Qualidade e fechamento

13. [T13 — Testes unitários e integração PostgreSQL](013-testes-unitarios-integracao_task.md)
14. [T14 — Testes E2E do fluxo crítico](014-testes-e2e_task.md)
15. [T15 — Validação de release e handoff](015-validacao-release-handoff_task.md)

T13 pode evoluir incrementalmente desde T02/T03 e acompanhar T05–T08/T11/T12,
mas só fecha após o backend estar integrado. T14 depende da experiência
completa e de uma matriz de dados determinística. T15 é serial.

## Matriz de dependências e paralelização

| ID | Onda | Dependências | Pode ocorrer em paralelo com |
|---|---:|---|---|
| T01 | 0 | S01–S08 e decisões do handoff | — |
| T02 | 1 | T01 | T03, T04, T09, T10 |
| T03 | 1 | T01; tipos de T02 | T02, T04, T09, T10; aplicação da migration é serial |
| T04 | 1 | T01, T02 | T03, T09, T10 |
| T05 | 2 | T02, T03, T04, S02/S03 | preparação de T06, T09, T13 |
| T06 | 2 | T03, T04, T05 | acabamento de T07, T08, T09, T13 |
| T07 | 2 | T02, T03, T04, T05, T06 | T08 após o contrato do provider, T09, T13 |
| T08 | 2 | T05, T07, S08; S03/S06/S07 | T09 e preparação de T11/T12 |
| T09 | transversal | T01 e infraestrutura S01 | T02–T08, T10–T13 |
| T10 | transversal | T01, T02 | T02–T09 |
| T11 | 3 | T06, T10 | T12, T13 |
| T12 | 3 | T07, T08, T10 | T11, T13 |
| T13 | 4 | T02–T09 | T11/T12 durante escrita incremental |
| T14 | 4 | T11, T12, T13 | — |
| T15 | 4 | T09, T13, T14 | — |

## Caminho crítico

`T01 → (T02 + T03 + T04) → T05 → T06 → T07 → T08 → (T11 + T12) → T13 → T14 → T15`

T09 e T10 são trilhas transversais. T13 pode reduzir o risco ao ser escrita
desde a fundação, mas seu gate final permanece depois do provider e das telas.

## Definition of Done do S09

- [x] O usuário autenticado cria, edita e encerra uma Caixinha sem hard delete;
  encerramento preserva histórico e tem efeito temporal definido.
- [x] Nome, categoria/associação, meta e data-alvo (quando configurados) são
  validados no client e no servidor; uma categoria não possui duas Caixinhas
  ativas quando essa regra estiver habilitada pelo contrato.
- [x] Aportes, retiradas e transferências entre Caixinhas usam movimentos
  positivos com semântica explícita, referências únicas, idempotência,
  atomicidade e histórico preservado.
- [x] Saldo, rollover, gasto do período, aporte do período, progresso e
  valores negativos são derivados em centavos, sem `float`, `Date` ou saldo
  materializado.
- [x] Regras de alocação são efetivas no tempo; distribuições automáticas,
  receitas realizadas, despesas por categoria, compras parceladas e estornos
  não reinterpretam o passado nem contam a mesma realidade duas vezes.
- [x] O provider server-side entrega `s09.v1`, `CONTRIBUTION`/`WITHDRAWAL`,
  `BOX_BALANCE_PROTECTED`, `closedOn`, saldo negativo e referências opacas à
  porta do S08, sem receber tenancy do browser.
- [x] A reserva reduz a disponibilidade uma única vez; retirada libera uma
  única vez; saldo negativo/encerrado não aumenta o spendable; recursos
  `RESTRICTED`/`EXCLUDED` não são somados à abertura `GENERAL`.
- [x] `/budgets` mostra lista, criação/edição/encerramento, movimentos, saldo,
  progresso, estados vazios/erro/loading e impacto autorizado no “Quanto posso
  gastar”, com consulta mobile responsiva.
- [x] Logs, breadcrumbs e Sentry usam somente contexto operacional agregado e
  não carregam centavos, saldos, descrições, nomes, referências financeiras,
  cookies, tokens, SQL ou payloads.
- [x] Testes puros, PostgreSQL real, E2E e gates de release comprovam precisão,
  rollback, isolamento, idempotência, vigência, não dupla contagem e os cinco
  cenários de integração definidos no handoff S08 → S09.

### Fechamento T15 — 2026-09-03

Os dez critérios acima têm evidência atual em T01–T14, na matriz PostgreSQL e
na matriz E2E ampla final (28/28). O typecheck e os dois specs que falharam na
execução histórica foram regularizados, e T15 registra os comandos e o handoff;
Sentry/produção permanece fora deste ambiente por falta de autorização.
