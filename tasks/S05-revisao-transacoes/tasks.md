# Tasks — S05: Revisão e organização das transações

## Objetivo

Entregar uma fila de revisão que permita organizar lançamentos manuais e
importados sem criar uma segunda fonte de verdade. O usuário deve encontrar
rapidamente o que está sem categoria, corrigir os metadados permitidos e
continuar na mesma posição/contexto da lista.

Este plano detalha [S05 — Revisão e organização das transações](../../docs/S05-revisao-transacoes.md), usando o ledger de [`FinancialEvent` e `AccountEntry`](../../docs/techspec.md:338), as regras de categoria opcional ([TechSpec, seção 33.2](../../docs/techspec.md:1140)), os reads separados dos writes ([TechSpec, seções 75–80](../../docs/techspec.md:2077)) e a experiência de transações ([TechSpec, seções 88–89](../../docs/techspec.md:2303)). A motivação de produto vem da categoria como classificação ([PRD, seção 5.2](../../docs/prd.md:164)), da edição de lançamentos ([PRD, seção 27](../../docs/prd.md:712)) e da experiência de baixa burocracia ([PRD, seção 28](../../docs/prd.md:726)).

## Premissas e decisões que orientam o slice

- S01, S02, S03 e S04 são dependências de execução. S03 fornece o ledger,
  isolamento, categorias e update seguro de metadata; S04 fornece eventos com
  `origin=IMPORT` e a linhagem `transaction_import_items`.
- A fonte de verdade continua sendo `financial_events` + `account_entries`.
  Não criar tabela paralela `transactions`, saldo materializado ou acesso do
  browser ao PostgreSQL.
- A tela lista somente eventos econômicos revisáveis (`EXPENSE`/`INCOME`) de
  origem `MANUAL` ou `IMPORT`. Eventos `REVERSAL`/`SYSTEM` aparecem somente
  como relação/histórico do evento original, nunca como item independente da
  fila.
- O estado `NEEDS_REVIEW` significa, nesta versão, evento `POSTED` de origem
  `MANUAL` ou `IMPORT` com `category_id IS NULL`. Evento cancelado não entra
  na fila de pendências, embora continue filtrável e consultável; categoria
  arquivada continua sendo histórico classificado e não é reclassificada
  automaticamente.
- Os únicos campos mutáveis neste slice são `description` e `categoryId` (que
  pode voltar a `null`). Valor, data, conta, tipo, status, entry, origem,
  `external_id`, lote, linha e demais dados de linhagem são somente leitura.
  Nenhuma alteração pode recriar o evento ou apagar sua origem.
- A origem é exposta como `MANUAL` ou `IMPORT`. Para importação, o read model
  pode mostrar `importId`, `rowNumber` e `externalId` vindos da relação
  tenant-scoped de S04; token, CSV bruto e linhas inválidas nunca entram na
  resposta.
- A busca textual, se usada, é simples e limitada à descrição atual do
  evento, com comparação case-insensitive. A busca não transforma texto do
  usuário em log ou autoridade de tenancy.
- A listagem usa paginação por cursor/keyset, ordenada por
  `occurred_on DESC, id DESC`, com limite padrão e máximo definidos no T02.
  O cursor é opaco, validado no servidor e não substitui o predicado de
  `household_id`.
- Writes continuam usando commands serializáveis, `Result<T, E>`, uma única
  transaction PostgreSQL e idempotência por `(household_id, commandId)`, em
  linha com [Application Commands](../../docs/techspec.md:1930) e
  [Idempotência](../../docs/techspec.md:2006).

## Ordem de execução

### Onda 0 — Contrato e gate

1. [T01 — Contrato do slice e gate de dependências](001-contrato-e-gate-revisao_task.md)

T01 é obrigatória. Ela fecha a definição de pendência, o conjunto de origens,
os campos editáveis, a linhagem e o contrato de cursor antes de alterar schema,
queries ou UI.

### Onda 1 — Fundamentos em paralelo

2. [T02 — Modelo de revisão e contratos serializáveis](002-modelo-revisao-contratos_task.md)
3. [T03 — Linhagem, schema, constraints e índices](003-lineage-schema-indices_task.md)
4. [T07 — Contratos e componentes base de UI](007-contratos-componentes-ui_task.md)
5. [T10 — Observabilidade e contrato de consultas lentas](010-observabilidade-consultas-lentas_task.md)

T02, T03, T07 e o desenho de T10 podem começar após T01. T03 deve aplicar
migrations de forma serial; T07 pode trabalhar com fixtures/ports enquanto o
backend evolui; T10 só precisa ser integrado aos use cases e reads nas ondas
seguintes.

### Onda 2 — Backend de leitura e escrita

6. [T04 — Reads, filtros, busca, pendências e paginação](004-reads-filtros-busca-paginacao_task.md)
7. [T05 — Update seguro de transação revisável](005-update-seguro-reviewable_task.md)

T04 e T05 podem ser desenvolvidas em paralelo depois de T02/T03. T04 depende
do read model e dos índices; T05 depende do command/validação e das relações
tenant-scoped. T10 continua em paralelo, com integração após os contratos
concretos existirem.

### Onda 3 — Adapters e experiência completa

8. [T06 — Server Actions, adapters e revalidação](006-adapters-actions-cache_task.md)
9. [T08 — Lista, filtros e indicadores de revisão](008-lista-filtros-pendencias_task.md)
10. [T09 — Detalhe, edição e origem](009-detalhe-edicao-origem_task.md)

T06 depende de T05 e fornece a boundary para T08/T09. T08 depende de T04,
T06 e T07; T09 depende de T04–T07. A construção visual de T08/T09 pode
avançar em paralelo depois que os contracts estiverem estáveis, mas a
integração da UI depende das actions reais.

### Onda 4 — Verificação

11. [T11 — Testes unitários, integração e performance](011-testes-unitarios-integracao-performance_task.md)
12. [T12 — E2E do fluxo de revisão](012-testes-e2e_task.md)

T11 pode ser escrita incrementalmente desde T02/T04/T05 e deve fechar depois
de T06/T10. T12 depende das telas T08/T09, da action T06 e de dados de S04;
os dois gates podem executar em paralelo quando o contrato de UI estiver
integrado.

### Onda 5 — Fechamento

13. [T13 — Validação de release](013-validacao-release_task.md)

T13 é serial: só fecha o slice após migrations, suíte de testes,
observabilidade, performance básica e smoke test publicado.

## Matriz de dependências

| ID | Task | Dependências | Paralelização principal |
|---|---|---|---|
| T01 | Contrato e gate | S03, S04 | — |
| T02 | Modelo e contracts | T01 | Com T03, T07 e T10 |
| T03 | Linhagem/schema/índices | T01; schema de S03/S04 | Com T02, T07 e T10; migration serial |
| T04 | Reads e paginação | T02, T03, S03, S04 | Com T05 e integração de T10 |
| T05 | Update revisável | T02, T03, S03 | Com T04 e T10 |
| T06 | Actions/adapters | T02, T04, T05 | Antes de integrar T08/T09 |
| T07 | UI base/contracts | T01, T02 | Com T03–T06 |
| T08 | Lista e pendências | T04, T06, T07 | Com T09 |
| T09 | Detalhe/edição/origem | T04–T07 | Com T08 |
| T10 | Observabilidade | T01 | Com T02–T09; integração final em T04–T06 |
| T11 | Unit/integration/perf | T02–T06, T10 | Incremental; gate antes de T13 |
| T12 | E2E | T06, T08, T09 | Com T11 após UI integrada |
| T13 | Release | T03, T10–T12 | Fechamento serial |

## Caminho crítico

`T01 → (T02 + T03) → (T04 + T05) → T06 → (T08 + T09) → (T11 + T12) → T13`

T07 reduz risco de integração visual e T10 reduz risco operacional; ambos
podem evoluir em paralelo, mas precisam estar incorporados antes do release.

## Definition of Done do slice

- [ ] A lista reúne eventos `MANUAL` e `IMPORT` do household atual sem expor
  `SYSTEM`/`REVERSAL` como transações revisáveis.
- [ ] O usuário filtra por período, conta, categoria (inclusive sem categoria),
  tipo, status, origem, estado de revisão e busca textual simples.
- [ ] Lançamentos sem categoria são identificados com indicador explícito e
  existe uma consulta/contagem tenant-scoped para a fila de revisão.
- [ ] A listagem é paginada por cursor, tem ordenação estável e permanece
  utilizável sobre volume representativo de extrato real.
- [ ] Categoria pode ser alterada sem recriar a transação; descrição pode ser
  ajustada sem alterar valor, entry, tipo ou data.
- [ ] Edição manual e importada usa command idempotente, valida categoria por
  tenant/tipo/status e preserva origem e linhagem de S04.
- [ ] Detalhe e lista exibem origem; eventos importados mantêm lote/linha/
  `external_id` consultáveis sem guardar ou exibir CSV bruto/token.
- [ ] Filtros, cursores, IDs e ações não atravessam household; erro de outro
  tenant permanece opaco.
- [ ] Testes cobrem categoria nula, update manual/importado, origem, linhagem,
  isolamento, paginação, performance básica e regressão de S03/S04.
- [ ] Sentry/logs registram apenas contexto técnico permitido e não recebem
  valor, descrição, nomes, busca ou payload financeiro.
- [ ] Migration, checks, CI, E2E e smoke test publicado estão documentados.
