# S10 — Matriz de dependências, decisões e gates

**Contrato base:** [`ADR-013 — Contrato da Visão Geral consolidada`](adr/013-s10-overview-contract.md)  
**Rota autenticada:** [`AUTHENTICATED_ROUTE`](../src/modules/auth/routes.ts) = `/app`  
**Data do gate T01:** 2026-09-03

Esta matriz é o índice operacional de T01. Ela não implementa query,
composição, componente ou migration. Cada task posterior deve apontar para
esta matriz e para a ADR ao registrar sua própria evidência.

## 1. Dependências reais e autoridade

| Slice | Fonte real no repositório | O que S10 consome | O que S10 não recria | Gate atual |
| --- | --- | --- | --- | --- |
| S01 — fundação/tenancy | [`src/modules/households/contracts.ts`](../src/modules/households/contracts.ts), [`src/modules/auth/contracts.ts`](../src/modules/auth/contracts.ts), [`docs/tenancy.md`](tenancy.md) | `FinancialContext` resolvido no servidor | `householdId`/`userId` do browser | Contrato publicado; integração via T03 |
| S02 — contas/categorias | [`src/modules/accounts-categories/contracts.ts`](../src/modules/accounts-categories/contracts.ts) | `categoryId`, nomes e hierarquia para rótulos de grupo | nova categoria ou regra de archive | Contrato publicado |
| S03/S05 — transação/ledger/revisão | [`src/modules/transactions/reads.ts`](../src/modules/transactions/reads.ts), [`docs/adr/004-s03-transacao-manual-contract.md`](adr/004-s03-transacao-manual-contract.md), [`docs/adr/006-s05-revisao-transacoes-contract.md`](adr/006-s05-revisao-transacoes-contract.md) | `EXPENSE`/`INCOME`/`PURCHASE`/`REVERSAL` `POSTED`, `occurredOn`, `categoryId` | ledger paralelo, segunda lista de eventos | Contrato publicado; agregação T02 |
| S06 — cartões | [`src/modules/credit-cards/projections.ts`](../src/modules/credit-cards/projections.ts), [`docs/adr/007-s06-credit-cards-contract.md`](adr/007-s06-credit-cards-contract.md) | compra econômica `PURCHASE`, projeção de fatura | fatura como despesa do período, parcela como segunda despesa | **Entregue**; bloco informativo T06/T11 |
| S07 — forecast | [`src/modules/forecast/service.ts`](../src/modules/forecast/service.ts), [`docs/adr/008-s07-forecast-contract.md`](adr/008-s07-forecast-contract.md) | `s07.v1`, `ForecastPeriodTotals`, itens de compromisso | nova timeline, releitura de parcelas | **Entregue**; composição T03/T06 |
| S08 — Spendable | [`src/modules/spendable/service.ts`](../src/modules/spendable/service.ts), [`docs/adr/011-s08-spendable-contract.md`](adr/011-s08-spendable-contract.md) | `getSpendable` → `s08.v1` byte-a-byte | fórmula `spendable.v1`, buffer, engine | **Entregue**; bloco principal T03/T10 |
| S09 — Caixinhas | [`src/modules/budgets/service.ts`](../src/modules/budgets/service.ts), [`docs/adr/012-s09-caixinhas-contract.md`](adr/012-s09-caixinhas-contract.md) | `budgetReadAccess`, `s09.v1` | saldo derivado paralelo, provider zero default | **Entregue em `main`** (`feat: deliver S09 caixinhas`); bloco **AVAILABLE** |

### Gate S09 — fechado

O parágrafo antigo em [`tasks/S10-visao-consolidada/tasks.md`](../tasks/S10-visao-consolidada/tasks.md)
que listava S09 T04/T07–T15 como abertas está **obsoleto**. S09 está
integralmente entregue. A home **não** opera em estado default de
indisponibilidade de Caixinhas. Falha técnica isolada do bloco continua
possível (`error`), distinta de `UNAVAILABLE` estrutural do provider.

## 2. Decisões fechadas por T01

| Tema | Decisão | Prova primária | Tasks que devem consumir |
| --- | --- | --- | --- |
| Rota | home autenticada = `/app`, não `/` | [ADR-013 §Decisão](adr/013-s10-overview-contract.md#decisão) | T06, T10–T14 |
| Período atual | mês civil de `asOf`; `[from, to]` inclusivo; `Temporal.PlainDate` | [ADR-013 §Período atual](adr/013-s10-overview-contract.md#período-atual) | T02, T06, T07, T13 |
| Composição | S10 compõe; não recalcula S07/S08/S09 | [ADR-013 §Composição](adr/013-s10-overview-contract.md#composição-sem-recálculo) | T03, T06, T10 |
| Spendable | byte-a-byte `s08.v1` de `getSpendable` | [ADR-013 §Composição](adr/013-s10-overview-contract.md#composição-sem-recálculo) | T03, T06, T10, T13, T14 |
| Não dupla contagem | `PURCHASE` econômico uma vez; fatura/parcela/pagamento/transferência/Caixinha fora | [ADR-013 §Representação econômica](adr/013-s10-overview-contract.md#representação-econômica-e-não-dupla-contagem) | T02, T06, T07, T13 |
| Estornos | sinal oposto no mês do `REVERSAL`; não reescreve mês original | [ADR-013 §Representação econômica](adr/013-s10-overview-contract.md#representação-econômica-e-não-dupla-contagem) | T02, T13 |
| Categorias | folha; max 8 + `other`; soma exata; Hamilton 0–100 | [ADR-013 §Agrupamento](adr/013-s10-overview-contract.md#agrupamento-por-categoria-despesas-do-período) | T02, T07, T11, T13 |
| Estados por bloco | `ready` \| `empty` \| `error`; erro ≠ zero | [ADR-013 §Blocos](adr/013-s10-overview-contract.md#blocos-hierarquia-e-estados) | T06, T10–T12, T14 |
| Degradação | leituras concorrentes; timeout 2500 ms; slow 500 ms; sem cache | [ADR-013 §Degradação](adr/013-s10-overview-contract.md#degradação-parcial-cache-e-observabilidade) | T04, T06, T09 |
| Drill-down | mapa URL com filtros existentes; split EXPENSE vs PURCHASE | [ADR-013 §Drill-down](adr/013-s10-overview-contract.md#mapa-de-drill-down) | T07, T11, T14 |
| Alertas V1 | 5 regras determinísticas; máx. 5; sem query extra | [ADR-013 §Alertas](adr/013-s10-overview-contract.md#alertas-determinísticos-v1) | T08, T11, T13 |
| Saldo de referência | `openingBalanceCents` S08; não patrimônio total | [ADR-013 §Composição](adr/013-s10-overview-contract.md#composição-sem-recálculo) | T06, T10 |
| Tenancy | browser sem `householdId`/`userId` | [ADR-013 §Tenancy](adr/013-s10-overview-contract.md#tenancy) | T03, T06, T13 |
| Fora de escopo | sem BI/widget/IA/net-worth/cache/segundo spendable | [ADR-013 §Fora de escopo](adr/013-s10-overview-contract.md#fora-de-escopo-v1) | T10, T15 |
| Caixinhas | bloco AVAILABLE por padrão (S09 entregue) | [ADR-013 §Gate S09](adr/013-s10-overview-contract.md#gate-s09--entregue) | T03, T06, T11 |

## 3. Matriz de cenários normativos

Todos os valores são centavos. `asOf` default = data civil do servidor.

| Cenário | Dados e expectativa | Resultado obrigatório | Evidência posterior |
| --- | --- | --- | --- |
| Espaço vazio | household sem eventos, cartões ou Caixinhas | blocos `empty` ou `ready` com zeros legítimos; spendable pode ser `ready`; nenhum `error` fingindo zero; sem alertas `critical` | T12, T13, T14 |
| Apenas transações | `EXPENSE` 50000 + `INCOME` 200000 no mês | `expenseCents=50000`, `incomeCents=200000`, categorias somam 50000; drill-down `/transactions` reconcilia EXPENSE | T02, T07, T13, T14 |
| Apenas cartão | `PURCHASE` 30000 em 3× no mês | período `expenseCents=30000` uma vez; fatura/projeção +0; pagamento TRANSFER +0 | T02, T06, T13 |
| Cartão + parcelas | compra 600000 em 10× | despesa período 600000; parcelas aparecem em compromissos S07, não em realizados | T06, T13, T14 |
| Refund no período | despesa 60000 em ago; estorno 10000 em set | ago inalterado; set reduz despesa em 10000 no mês do estorno | T02, T13 |
| Caixinha saldo negativo | saldo `-2000` em uma Caixinha | bloco caixinhas `ready`; alerta `BOX_INSUFFICIENT` atenção; não entra em despesa do período | T08, T11, T13 |
| Caixinha encerrada | `closedOn` no passado | item listável com status `CLOSED`; proteção zero no spendable via S09/S08 | T03, T11, T13 |
| Forecast sem itens | horizonte sem compromissos | blocos compromissos/receitas `empty`; spendable `ready`; sem alerta falso de compromisso | T06, T12, T13 |
| Receita prevista não realizada | inflow `EXPECTED` no mês sem `INCOME` `POSTED` | alerta `EXPECTED_INCOME_UNREALIZED`; não conta como receita realizada | T08, T13, T14 |
| Volume representativo | milhares de eventos + dezenas de categorias | home legível; timeout por bloco 2500 ms; slow-query 500 ms; grupos max 8 + `other` | T09, T12, T13, T14 |

### Exemplo cartão + pagamento (reconciliação)

```text
PURCHASE 30000 (3×10000) no mês
→ periodSummary.expenseCents = 30000
→ expensesByCategory inclui 30000 na categoria da compra
→ /transactions?kind=EXPENSE reconcilia 0 PURCHASE (manual-only)
→ /credit-cards reconcilia compras do período
→ pagamento TRANSFER 10000 no mês → +0 em despesas
```

## 4. Gates por task

| Task | Pré-condição | Evidência mínima para fechar | Estado nesta T01 |
| --- | --- | --- | --- |
| [T02 — agregação](../tasks/S10-visao-consolidada/002-agregacao-periodo-categorias_task.md) | ADR-013 período e categorias | testes puros EXPENSE+PURCHASE+REVERSAL; Hamilton; soma exata | Aberta; contrato fechado |
| [T03 — composição](../tasks/S10-visao-consolidada/003-composicao-leituras-existentes_task.md) | inventário ADR-013 | orquestração tenant-safe sem recálculo S08 | Aberta; contrato fechado |
| [T04 — observabilidade](../tasks/S10-visao-consolidada/004-observabilidade-s10_task.md) | limites 2500/500 ms | allow-list/redaction S10 | Aberta; contrato fechado |
| [T05 — UI contracts](../tasks/S10-visao-consolidada/005-contratos-ui-componentes_task.md) | `s10.v1` e estados por bloco | view models serializáveis | Aberta; contrato fechado |
| [T06 — read model](../tasks/S10-visao-consolidada/006-read-model-consolidado_task.md) | T02 + T03 | `s10.v1` integrado; reconciliação | Aberta |
| [T07 — drill-down](../tasks/S10-visao-consolidada/007-drill-down-navegacao_task.md) | T06 + mapa ADR | links determinísticos; split PURCHASE | Aberta; mapa fechado |
| [T08 — alertas](../tasks/S10-visao-consolidada/008-alertas-deterministicos_task.md) | T06 + tabela ADR | 5 regras; ordenação; cap 5 | Aberta; regras fechadas |
| [T09 — performance](../tasks/S10-visao-consolidada/009-performance-volume_task.md) | T06 | volume representativo; índices motivados | Aberta |
| [T10 — UI hierarquia](../tasks/S10-visao-consolidada/010-ui-hierarquia-decisao_task.md) | T05 + T06 | ordem de blocos; spendable primeiro | Aberta |
| [T11 — UI blocos](../tasks/S10-visao-consolidada/011-ui-compromissos-caixinhas-drilldown_task.md) | T05–T08 | compromissos, caixinhas AVAILABLE, drill-down | Aberta |
| [T12 — estados](../tasks/S10-visao-consolidada/012-estados-empty-erro-responsivo_task.md) | T10 + T11 | empty/error/loading; 360px | Aberta |
| [T13 — testes](../tasks/S10-visao-consolidada/013-testes-unitarios-integracao_task.md) | T02–T09 | unitário + PostgreSQL + cenários matriz | Aberta |
| [T14 — E2E](../tasks/S10-visao-consolidada/014-testes-e2e_task.md) | T10–T13 | home → detalhes reconciliados | Aberta |
| [T15 — release](../tasks/S10-visao-consolidada/015-validacao-release-handoff_task.md) | T04, T09, T13, T14 | DoD S10 + handoff S11 | Aberta |

## 5. Critérios de aceite → tasks

| Critério (`docs/S10-visao-consolidada.md`) | Tasks | Evidência exigida |
| --- | --- | --- |
| Totalizações reconciliam com telas de detalhe | T02, T06, T07, T13, T14 | centavos iguais com filtro URL equivalente |
| "Quanto posso gastar" = S08 sem recálculo | T01, T03, T06, T10, T13, T14 | mesmo `s08.v1` que `/spendable/breakdown` |
| Drill-down de agregados | T07, T11, T14 | links da matriz §2 e mapa ADR |
| Sem dupla contagem cartão/transação | T01, T02, T06, T13 | cenários cartão+parcela+pagamento |
| Dashboard com vazio/pouco/muito dado | T09, T12, T13, T14 | matriz §3 + 360px |
| Isolamento cross-space | T02, T03, T06, T13 | IDs forjados não vazam |
| PRD §16 dashboard (parcial) | T02, T03, T06, T08, T10, T11 | período, spendable, caixinhas, compromissos, alertas; **sem** patrimônio total/líquido V1 |
| PRD §17 caixinhas | T03, T06, T11 | resumo S09; dono S09 |
| PRD §18 alertas | T08, T11 | tabela ADR-013 |
| PRD §21 ações rápidas | T10 | receita/despesa na home |
| PRD §24 mobile ocasional | T05, T12, T14 | consulta 360px |
| PRD §28 registrar pouco | T01, T10, T12 | hierarquia enxuta |
| TechSpec §86–87 navegação/dashboard | T01, T10, T11 | `/app`, ordem de blocos |
| TechSpec §76 reads | T03, T06 | composição sem CQRS infra |
| TechSpec §102 observabilidade | T04 | redaction + slow-query |
| TechSpec §114 índices | T09 | índices motivados por query real |
| TechSpec §116 testes | T13, T14 | unitário + integração + E2E home |

## 6. Gate T01 e pendências explícitas

O gate de contrato T01 fecha com:

- [`docs/adr/013-s10-overview-contract.md`](adr/013-s10-overview-contract.md)
- esta matriz
- atualização compatível de [`docs/S10-visao-consolidada.md`](S10-visao-consolidada.md)
- comandos de revisão abaixo

Pendências downstream (não são falhas da especificação):

- T02–T15 permanecem abertas.
- Read model consolidado, agregação SQL, UI completa e testes E2E ainda não
  existem como evidência de S10.
- Patrimônio total/líquido e gráficos de evolução ficam para S11+.

## 7. Comandos de revisão do gate

Registrados em
[T01](../tasks/S10-visao-consolidada/001-contrato-visao-geral-gate_task.md):

```text
git diff --check
npx tsc --noEmit --pretty false
```

Esses comandos verificam consistência estática da documentação e do
repositório; não substituem T02–T15.
