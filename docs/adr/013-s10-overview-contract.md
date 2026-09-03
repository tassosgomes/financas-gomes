# ADR-013 — Contrato da Visão Geral consolidada, fronteira e integração S10

- **Status:** Aceito
- **Data:** 2026-09-03
- **Owner:** domínio/backend do S10 — Visão financeira consolidada
- **Escopo:** T01 do slice S10 — contrato, fronteira e gate de dependências
- **Contrato externo:** `s10.v1`, consumido pela rota autenticada `/app`
- **Rota autenticada:** `AUTHENTICATED_ROUTE` = `/app` em
  [`src/modules/auth/routes.ts`](../../src/modules/auth/routes.ts)

## Decisão

Esta ADR fecha a semântica pública da home autenticada da V1 antes de qualquer
query, composição ou tela. O S10 **compõe e apresenta** leituras existentes;
ele **não recria fórmula financeira**. Nenhuma task posterior pode escolher
outra interpretação local para os pontos aqui marcados como normativos.

S10 é proprietário de:

- o read model consolidado `s10.v1` da Visão Geral;
- a definição única de **período atual** para agregados do mês civil;
- a agregação de despesas por categoria do período (T02);
- a orquestração tenant-safe de leituras existentes (T03);
- estados por bloco, degradação parcial, drill-down e alertas determinísticos
  derivados exclusivamente do read model consolidado.

S10 não é proprietário de:

- ledger, eventos e revisão (S03/S05);
- compra econômica, parcelas, fatura e pagamento de cartão (S06);
- forecast e timeline de compromissos (S07);
- fórmula, read model ou API pública de Spendable (S08);
- aggregate, saldo derivado e movimentos de Caixinhas (S09);
- autorização do browser ou resolução de tenancy (S01).

A matriz de dependências, cenários e gates está em
[`docs/S10-visao-consolidada-contract-matrix.md`](../S10-visao-consolidada-contract-matrix.md).

## Precedência e resolução de conflitos

Quando documentos diferirem, a resolução é:

1. esta ADR, para as decisões específicas de S10 explicitamente fechadas aqui;
2. os contratos consumidos sem alteração:
   [`ADR-011`](011-s08-spendable-contract.md) (`s08.v1`),
   [`ADR-008`](008-s07-forecast-contract.md) (`s07.v1`),
   [`ADR-012`](012-s09-caixinhas-contract.md) (`s09.v1`),
   [`ADR-007`](007-s06-credit-cards-contract.md) (projeções S06);
3. a TechSpec, para arquitetura e invariantes gerais não especializadas nesta
   ADR (§§76, 86–87, 102, 114, 116);
4. [`docs/S10-visao-consolidada.md`](../S10-visao-consolidada.md), para escopo
   e linguagem do produto;
5. o PRD (§§16–19, 21, 24, 28), para intenção de produto e exemplos não
   conflitantes.

A TechSpec §86 descreve a home como `/` conceitualmente; a rota real do
repositório permanece `/app`. Uma alteração estrutural que contradiga esta ADR
exige nova ADR e nova versão do contrato (`s10.v2`).

### Gate S09 — entregue

O slice S09 está **totalmente entregue** em `main` (`feat: deliver S09
caixinhas`). O bloco de Caixinhas da home opera em estado **AVAILABLE** por
padrão, consumindo `budgetReadAccess` / `s09.v1`. Não há fallback de
indisponibilidade como estado default da V1. Falha técnica isolada do bloco
continua possível e deve renderizar `error`, nunca zero monetário nem
`UNAVAILABLE` inventado.

## Período atual

**Período atual** é o mês civil do `asOf` resolvido no servidor.

| Campo | Regra |
| --- | --- |
| `asOf` | Data civil do servidor por padrão (`currentFinancialDate`, mesmo relógio de S08). Pode ser injetado em testes/composição; o browser nunca fornece o relógio de negócio. |
| `period.from` | Dia 1 do mês civil de `asOf`, inclusivo. |
| `period.to` | Último dia civil do mês de `asOf`, inclusivo. |
| `period.key` | `YYYY-MM` do mês civil. |
| Tipo de data | Somente `Temporal.PlainDate` no domínio; serialização `YYYY-MM-DD`. Proibido `Date` de JavaScript para cálculo financeiro. |

Janela inclusiva: `[from, to]`.

Nenhum bloco da home pode usar outra janela sem declará-la explicitamente no
contrato `s10.v1`:

| Bloco | Janela |
| --- | --- |
| Resumo do período, despesas por categoria | mês civil de `asOf` |
| Spendable | horizonte próprio de S08: `asOf` + 90 dias (default `CONSERVATIVE`) |
| Próximos compromissos/receitas | S07 a partir de `asOf + 1` até `asOf + horizon.days` (default 90 dias, mesmo cenário do Spendable na composição) |
| Faturas de cartão | projeção S06 no corte `asOf`; informativo, fora de despesas do período |
| Caixinhas | saldo/posição em `asOf`; lista limitada a 5 itens |

## Composição sem recálculo

O S10 monta a Visão Geral exclusivamente a partir de leituras publicadas. A
única agregação nova de propriedade do S10 é o resumo de despesas por categoria
do período (T02); todo o restante é composição ou projeção de campos já
definidos nos contratos de origem.

| Indicador na home | Fonte canônica | Regra |
| --- | --- | --- |
| Quanto posso gastar | `getSpendable` → `s08.v1` | Byte-a-byte o mesmo `SpendableBreakdown` para o mesmo contexto, cenário e horizonte. Sem reformatação de fórmula, sem arredondamento próprio, sem segundo card de spendable. |
| Planejado × realizado do mês | `getForecast` → `ForecastPeriodTotals` do mês civil | Composição do bucket `periods[]` de `s07.v1`; não é nova fórmula. |
| Saldo de referência | `openingBalanceCents` de `s08.v1` | Posição `GENERAL` `POSTED` até `asOf`. Rotulado como saldo de referência; não é patrimônio total/líquido. |
| Próximos compromissos/receitas | itens de `s07.v1` | Filtragem e limite na composição; sem releitura de fontes. |
| Caixinhas | `budgetReadAccess.list` / reads S09 | Números e estados de `s09.v1`; sem saldo derivado paralelo. |
| Faturas | projeções S06 | Informativas; não entram em despesas do período. |

## Representação econômica e não dupla contagem

### O que entra no período (realizado)

| Tipo | Condição | Efeito no agregado |
| --- | --- | --- |
| `EXPENSE` | `status = POSTED`, `occurredOn ∈ [from, to]` | soma em despesas do período |
| `PURCHASE` | `status = POSTED`, `occurredOn ∈ [from, to]` | soma o valor econômico integral da compra em despesas do período |
| `INCOME` | `status = POSTED`, `occurredOn ∈ [from, to]` | soma em receitas do período |
| `REVERSAL` / refund / correção | `status = POSTED`, `occurredOn` do estorno | aplica sinal oposto ao kind econômico original no mês do estorno; não reescreve o mês original |

### O que fica fora do período (realizado)

| Tipo | Motivo |
| --- | --- |
| `TRANSFER` (inclui pagamento de cartão) | movimentação entre contas; soma zero no household |
| Parcelas (`INSTALLMENT` schedule) | compromisso futuro via S07; não é segunda despesa |
| Agregados de fatura (projeção S06) | informativo; não é despesa do período |
| Movimentos de Caixinha (aporte/retirada/transferência) | envelope; não é despesa/receita do período |
| Eventos `CANCELLED` | excluídos dos totais |

### Exemplo normativo (centavos)

Compra parcelada `R$ 300,00` (`30000` centavos) em 3× de `10000`, todos no
mesmo mês civil:

```text
PURCHASE POSTED occurredOn=2026-09-05     amountCents=30000   → período +30000
installment rows (PLANNED)                amountCents=10000   → período +0
invoice projection (S06)                  amountCents=10000   → período +0
payment TRANSFER POSTED                   amountCents=10000   → período +0

despesa realizada do período = 30000 (uma vez, pelo PURCHASE)
```

Refund de `EXPENSE`/`PURCHASE` no mês `M` reduz despesas de `M` pelo valor do
estorno; o mês da compra original permanece inalterado.

### Reconciliação de drill-down

O total de despesas do período na home é `EXPENSE + PURCHASE` (menos estornos).

- O subconjunto `EXPENSE` reconcilia com
  `/transactions?from={from}&to={to}&kind=EXPENSE&status=POSTED`.
- O subconjunto `PURCHASE` **não** aparece em `/transactions` (lista manual
  somente `EXPENSE`/`INCOME` + `REVERSAL` compensatório). Reconcilia contra
  leituras S06 de compras no mesmo período.
- Chaves de reconciliação por agregado incluem, no mínimo:
  `from`, `to`, `expenseEventCount`, `purchaseEventCount`, `filter` (quando
  aplicável). T07 monta links a partir dessas chaves.

## Agrupamento por categoria (despesas do período)

1. Agrupar por `categoryId` folha do evento (`EXPENSE` e `PURCHASE` elegíveis).
2. Categoria ausente → chave `uncategorized`, rótulo **Sem categoria**.
3. Ordenação determinística: `amountCents` descendente, depois nome ascendente,
   depois `id` ascendente.
4. Exibir no máximo **8** grupos nomeados; o restante colapsa em chave
   `other`, rótulo **Outros**, com soma exata do residual.
5. A soma de `amountCents` dos grupos **deve** igualar o total de despesas do
   período, centavo a centavo.
6. Percentuais são inteiros `0..100` que **devem** somar `100` quando o total
   > 0, pelo método do maior resto (Hamilton):
   - `floor(share * 100)` para cada grupo;
   - pontos restantes para os maiores restos;
   - empates: `amountCents`, depois nome, depois `id`.
7. Se o total é `0`, todos os percentuais são `0`.

## Blocos, hierarquia e estados

Cada bloco de dados tem estado independente:

```ts
type OverviewBlockState = "ready" | "empty" | "error";
```

| Estado | Significado |
| --- | --- |
| `ready` | Dado válido para exibição (pode ser zero monetário legítimo). |
| `empty` | Ausência legítima de dado (household novo, lista vazia, recurso não configurado). |
| `error` | Falha técnica ou de contrato; **nunca** renderizar como zero monetário. |

A falha de um bloco não derruba a página. `empty ≠ error ≠ zero`.

### Hierarquia V1 (ordem de decisão)

1. **spendable** — S08; decisão financeira principal.
2. **periodSummary** — receitas/despesas realizadas, líquido, planejado ×
   realizado do mês (S07 `ForecastPeriodTotals` quando disponível), saldo de
   referência opcional (`openingBalanceCents` S08).
3. **expensesByCategory** — agregação T02 do período.
4. **upcomingCommitments** — outflows S07; limite 5 + link "ver todos".
5. **upcomingIncome** — inflows S07; limite 5.
6. **caixinhasSummary** — S09; limite 5; **AVAILABLE** por padrão.
7. **cardInvoices** — projeção S06; informativo.
8. **alerts** — derivados do read model; máximo 5.
9. **quickActions** — adicionar receita/despesa; não é bloco de dados.
10. **InviteShareCard** — permanece abaixo dos indicadores (comportamento atual).

## Degradação parcial, cache e observabilidade

| Parâmetro | Valor V1 |
| --- | --- |
| Leituras | concorrentes e independentes por bloco |
| Timeout por bloco | **2500 ms** |
| Limiar de query lenta | **500 ms** (T04) |
| Cache | **nenhum** na V1 |

Qualquer exceção futura exige nova decisão nesta ADR com invalidação explícita
e prova de consistência.

Telemetria segue TechSpec §102 e ADRs de observabilidade dos slices de origem:
apenas contexto operacional agregado; sem centavos, nomes, descrições, SQL,
payloads, cookies ou tokens na boundary pública ou em Sentry.

## Tenancy

O browser **nunca** envia `householdId`, `userId` ou qualquer autoridade de
tenancy. O servidor resolve `FinancialContext` uma vez via
`requireFinancialContext()` (ou resolver injetado em testes) e repassa o
contexto às leituras. IDs de categoria, conta, cartão ou Caixinha em URLs de
drill-down são candidatos revalidados no servidor.

## Alertas determinísticos V1

Derivados **somente** do read model consolidado; sem query extra, sem IA.

| `ruleId` | Severidade | Condição | Mensagem |
| --- | --- | --- | --- |
| `SPENDABLE_NOT_POSITIVE` | `attention` se `displaySpendableCents === "0"`; `critical` se `rawSpendableCents < 0` | bloco spendable `ready` | Orientativa: revisar compromissos e reservas. |
| `FORECAST_MONTH_NEGATIVE` | `critical` | algum mês civil futuro na timeline conservativa de 90 dias com `closingProjectedBalanceCents < 0` | Orientativa: mês projetado negativo. |
| `COMMITMENT_SOON` | `attention` | próximo outflow em até 7 dias civis a partir de `asOf` | Orientativa: compromisso próximo. |
| `EXPECTED_INCOME_UNREALIZED` | `attention` | inflow `EXPECTED` do mês civil atual sem `INCOME` `POSTED` correspondente reconciliado (S07) | Orientativa: receita prevista ainda não realizada. |
| `BOX_INSUFFICIENT` | `attention` | qualquer Caixinha com saldo assinado `< 0` | Orientativa: Caixinha em déficit. |

Regras adicionais:

- Máximo **5** alertas exibidos.
- Ordenação: `critical` primeiro, depois `attention`, depois data ascendente,
  depois `ruleId` estável.
- Origem ausente ou em `error` → nenhum alerta daquela origem (nunca crítico
  falso).
- Household vazio → nenhum alerta `critical`.

## Mapa de drill-down

Usar constantes de rota existentes e o mesmo dialeto de query das telas de
destino.

| Destino | Rota / query |
| --- | --- |
| Spendable | `/spendable/breakdown` (`SPENDABLE_BREAKDOWN_ROUTE`) |
| Receitas do período | `/transactions?from={from}&to={to}&kind=INCOME&status=POSTED` |
| Despesas EXPENSE do período | `/transactions?from={from}&to={to}&kind=EXPENSE&status=POSTED` |
| Categoria (real) | `...&categoryId={categoryId}` |
| Sem categoria | `...&categoryId=__none` (`UNCATEGORIZED_FILTER_VALUE`) |
| Compras PURCHASE da categoria/período | `/credit-cards` ou `/credit-cards/{cardId}` (+ filtros `from`/`to` quando aplicável); `/transactions` não cobre PURCHASE |
| Forecast completo | `/forecast?from={from}&to={to}&scenario=CONSERVATIVE` (ou cenário usado na composição) |
| Caixinhas | `/budgets` (`BUDGETS_ROUTE`) |
| Detalhe Caixinha | `/budgets/{referenceId}` (`budgetDetailRoute`) |
| Cartões | `/credit-cards` (`CREDIT_CARD_ROUTES.collection`) |
| Cartão | `/credit-cards/{cardId}` (`creditCardHref`) |

## Inventário de leituras consumidas

O S10 não reimplementa estas funções; apenas as orquestra.

### `getSpendable` — `s08.v1`

- **Módulo:** [`src/modules/spendable/service.ts`](../../src/modules/spendable/service.ts)
- **Action:** `getSpendableAction` em [`src/app/actions/spendable.ts`](../../src/app/actions/spendable.ts)
- **Assinatura:**

```ts
getSpendable(
  input?: GetSpendableInput,
  dependencies?: SpendableServiceDependencies,
): Promise<SpendableResult<SpendableBreakdown>>
```

- **Input público:** `asOf?`, `scenario?` (`CONSERVATIVE` default),
  `horizon?` (`{ days: 90 }` default).
- **Contexto:** `requireFinancialContext()` via `resolveContext(dependencies)`.
- **Erros públicos (opacos):** `FINANCIAL_CONTEXT_REQUIRED`,
  `SPENDABLE_NOT_FOUND`, `INVALID_DATE`, `INVALID_DATE_RANGE`,
  `INVALID_SCENARIO`, `INVALID_HORIZON`, `SPENDABLE_QUERY_FAILED`,
  `SPENDABLE_INCONSISTENT`, entre outros mapeados em
  [`ui-contracts.ts`](../../src/modules/spendable/ui-contracts.ts).

### `getForecast` — `s07.v1`

- **Módulo:** [`src/modules/forecast/service.ts`](../../src/modules/forecast/service.ts)
- **Action:** `getForecastAction` em [`src/app/actions/forecast.ts`](../../src/app/actions/forecast.ts)
- **Assinatura:**

```ts
getForecast(
  input?: unknown,
  dependencies?: ForecastServiceDependencies,
): Promise<ForecastResult<ForecastTimeline>>
```

- **Input público:** `from`, `to`, `scenario` (`GetForecastQuery`).
- **Contexto:** `requireFinancialContext()`; relógio `currentFinancialDate`.
- **Erros públicos:** `FINANCIAL_CONTEXT_REQUIRED`, `INVALID_DATE`,
  `INVALID_DATE_RANGE`, `INVALID_SCENARIO`, `FORECAST_RANGE_TOO_LARGE`,
  `FORECAST_NOT_FOUND`, `FORECAST_INCONSISTENT`, `FORECAST_QUERY_FAILED`.

### `budgetReadAccess` — `s09.v1`

- **Módulo:** [`src/modules/budgets/service.ts`](../../src/modules/budgets/service.ts)
- **Porta:**

```ts
interface BudgetReadAccess {
  list(input?: ListBudgetsQuery): Promise<BudgetReadResult<ListBudgetsReadModel>>;
  detail(budgetReferenceId, input?): Promise<BudgetReadResult<BudgetDetailReadModel>>;
  history(budgetReferenceId, input?): Promise<BudgetReadResult<BudgetHistoryReadModel>>;
  movements(budgetReferenceId, input?): Promise<BudgetReadResult<BudgetMovementPageReadModel>>;
}
```

- **Alias de lista:** `listBudgetsForContext(context, input, dependencies)`.
- **Contexto:** `requireFinancialContext()` em cada método da porta.
- **Erros públicos:** `FINANCIAL_CONTEXT_REQUIRED`, `INVALID_QUERY`,
  `INVALID_CURSOR`, `BUDGET_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `QUERY_FAILED`.

### Projeções de cartão — S06

- **Módulo:** [`src/modules/credit-cards/projections.ts`](../../src/modules/credit-cards/projections.ts)
- **Porta:** `creditCardProjectionUseCases` / `getCreditCardProjection`.
- **Assinatura:**

```ts
getCreditCardProjection(
  context: FinancialContext,
  query: CreditCardProjectionQuery,
  databaseOrOptions?,
): Promise<CreditCardProjectionReadModel>
```

- **Contexto:** `FinancialContext` já resolvido; `assertFinancialContext`.
- **Query:** `cardId`, `period`, `from`, `to`, `asOf` (corte civil).
- **Erros:** envelope `CreditCardResult` com códigos de domínio opacos
  (`CreditCardDomainError`).

### `listManualTransactionsForContext` — reconciliação EXPENSE

- **Módulo:** [`src/modules/transactions/reads.ts`](../../src/modules/transactions/reads.ts)
- **Assinatura:**

```ts
listManualTransactionsForContext(
  executor: TransactionReadExecutor,
  context: FinancialContext,
  query?: ListManualTransactionsQuery,
): Promise<ListManualTransactionsReadModel>
```

- **Kinds expostos:** `EXPENSE`, `INCOME` (+ `REVERSAL` compensatório).
- **Filtros URL:** `from`, `to`, `accountId`, `categoryId` (`__none` =
  sem categoria), `kind`, `status` — ver
  [`transaction-listing-utils.ts`](../../src/components/transactions/transaction-listing-utils.ts).
- **Nota:** não lista `PURCHASE`; reconciliação de cartão usa S06.

### Dinheiro, datas e IDs

- **Money:** `bigint` centavos em
  [`src/modules/transactions/money.ts`](../../src/modules/transactions/money.ts);
  strings decimais inteiras na serialização.
- **Datas:** `Temporal.PlainDate` / ISO `YYYY-MM-DD`.
- **IDs:** UUIDv7.
- **Kinds em DB:** `EXPENSE`, `INCOME`, `REVERSAL`, `PURCHASE`, `TRANSFER`.

## Contrato `s10.v1`

### Entrada

```ts
interface GetOverviewInput {
  /** ISO PlainDate. Omitido: data civil do servidor. */
  asOf?: string;
  /** Omitido: CONSERVATIVE — alinhado ao Spendable default. */
  scenario?: "CONSERVATIVE" | "EXPECTED";
  /** Omitido: { days: 90 } — alinhado ao Spendable default. */
  horizon?: { days: number };
}
```

O request não aceita `householdId`, `userId`, `accountId`, lista de contas,
categoria, cartão, Caixinha, saldo, timeline ou autorização do browser.

### Saída serializável

```ts
const OVERVIEW_CONTRACT_VERSION = "s10.v1" as const;

interface OverviewPeriod {
  key: string;          // YYYY-MM
  from: string;         // YYYY-MM-DD
  to: string;           // YYYY-MM-DD
  asOf: string;         // YYYY-MM-DD
}

interface OverviewBlockEnvelope<T> {
  state: "ready" | "empty" | "error";
  data?: T;
  error?: { code: string; field?: string | null };
}

interface OverviewPeriodSummary {
  incomeCents: string;
  expenseCents: string;
  netCents: string;
  expenseEventCount: number;
  purchaseEventCount: number;
  referenceBalanceCents?: string;   // S08 openingBalanceCents GENERAL
  planned?: {
    inflowCents: string;
    outflowCents: string;
    realizedInflowCents: string;
    realizedOutflowCents: string;
    projectedInflowCents: string;
    projectedOutflowCents: string;
  };
  reconciliation: {
    from: string;
    to: string;
    expenseFilter: string;
    incomeFilter: string;
  };
}

interface OverviewCategoryGroup {
  key: string;              // categoryId | "uncategorized" | "other"
  label: string;
  categoryId?: string;
  amountCents: string;
  percent: number;          // 0..100, soma 100 quando total > 0
  expenseEventCount: number;
  purchaseEventCount: number;
}

interface OverviewCommitmentItem {
  referenceId: string;
  date: string;
  amountCents: string;
  direction: "INFLOW" | "OUTFLOW";
  label: string;
  originKind: string;
}

interface OverviewCaixinhaItem {
  referenceId: string;
  name: string;
  balanceCents: string;
  protectedCents?: string;
  status: "ACTIVE" | "CLOSED";
}

interface OverviewCardInvoiceItem {
  cardId: string;
  cardName: string;
  period: string;           // YYYY-MM
  dueOn: string;
  amountCents: string;
  state: string;
}

type OverviewAlertSeverity = "attention" | "critical";

interface OverviewAlert {
  ruleId:
    | "SPENDABLE_NOT_POSITIVE"
    | "FORECAST_MONTH_NEGATIVE"
    | "COMMITMENT_SOON"
    | "EXPECTED_INCOME_UNREALIZED"
    | "BOX_INSUFFICIENT";
  severity: OverviewAlertSeverity;
  message: string;
  date?: string;
  referenceId?: string;
}

interface OverviewReadModel {
  contractVersion: typeof OVERVIEW_CONTRACT_VERSION;
  period: OverviewPeriod;
  scenario: "CONSERVATIVE" | "EXPECTED";
  horizonDays: number;

  spendable: OverviewBlockEnvelope<{
    breakdown: import("@/modules/spendable/contracts").SpendableBreakdown;
  }>;

  periodSummary: OverviewBlockEnvelope<OverviewPeriodSummary>;

  expensesByCategory: OverviewBlockEnvelope<{
    totalExpenseCents: string;
    groups: readonly OverviewCategoryGroup[];
  }>;

  upcomingCommitments: OverviewBlockEnvelope<{
    items: readonly OverviewCommitmentItem[];
    totalMatching: number;
    viewAllHref: string;
  }>;

  upcomingIncome: OverviewBlockEnvelope<{
    items: readonly OverviewCommitmentItem[];
    totalMatching: number;
    viewAllHref: string;
  }>;

  caixinhasSummary: OverviewBlockEnvelope<{
    status: "AVAILABLE" | "UNAVAILABLE";  // UNAVAILABLE só em falha técnica S09
    items: readonly OverviewCaixinhaItem[];
    totalCount: number;
    viewAllHref: string;
  }>;

  cardInvoices: OverviewBlockEnvelope<{
    items: readonly OverviewCardInvoiceItem[];
    viewAllHref: string;
  }>;

  alerts: OverviewBlockEnvelope<{
    items: readonly OverviewAlert[];
  }>;
}
```

O bloco `spendable.data.breakdown` é o objeto `s08.v1` retornado por
`getSpendable` sem transformação de centavos ou fórmula.

### Erros do read model consolidado

Erros são opacos na boundary (`{ code, field? }`). Códigos estáveis previstos
para T06:

| Código | Situação |
| --- | --- |
| `FINANCIAL_CONTEXT_REQUIRED` | sessão/contexto ausente |
| `INVALID_DATE` / `INVALID_DATE_RANGE` | `asOf` ou período inválido |
| `INVALID_SCENARIO` / `INVALID_HORIZON` | parâmetros de composição inválidos |
| `OVERVIEW_QUERY_FAILED` | falha técnica agregada |
| `OVERVIEW_PARTIAL_FAILURE` | metadado interno opcional; a UI usa estados por bloco |

Nenhum erro converte valor monetário em `"0"` na UI.

## Fora de escopo V1

Conforme PRD §16 (itens não assumidos por S10) e escopo do slice:

- BI configurável, widgets configuráveis, relatórios customizados, benchmark;
- insights de IA não previstos;
- gráficos de patrimônio total/líquido e engine de net-worth (S11 ou posterior);
- segundo card de spendable;
- cache na home;
- qualquer reimplementação de fórmula S07/S08/S09.

Quick actions da home limitam-se a **adicionar receita** e **adicionar despesa**
(PRD §21 parcial). Transferência entre Caixinhas e atualização de patrimônio
permanecem nas telas de origem.

## Consequências e gates

- T02 implementa a agregação de período e categorias conforme esta ADR.
- T03 orquestra as leituras inventariadas sem recálculo.
- T04 instrumenta timeout 2500 ms e slow-query 500 ms.
- T06 publica o read model `s10.v1` com estados por bloco.
- T07 monta drill-down a partir das chaves de reconciliação.
- T08 implementa a tabela de alertas sem query extra.
- T09–T15 medem volume, índices, UI, testes e release.

Esta ADR não declara schema, query, componente, migration ou endpoint
implementados; apenas fecha semântica e contrato.
