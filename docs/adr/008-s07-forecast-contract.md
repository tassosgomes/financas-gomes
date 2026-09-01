# ADR-008 — Contrato do forecast e gate do S07

- **Status:** Aceito
- **Data:** 2026-08-31
- **Escopo:** T01 do slice S07 — Fluxo futuro
- **Dependências:** S03, S06, ADR-004, ADR-007 e ADR-010 da TechSpec

## Contexto e precedência

O S07 precisa projetar compromissos conhecidos sem criar uma segunda fonte de
verdade para fatos financeiros, parcelas ou saldo. Esta ADR é o contrato
normativo que desbloqueia T02–T13. Em caso de conflito, a ordem é:

1. `docs/S07-fluxo-futuro.md` e esta ADR;
2. as seções 42–57, 93, 116, 121 e ADR-010 da
   [`docs/techspec.md`](../../docs/techspec.md);
3. as seções 6–11 do [`docs/prd.md`](../../docs/prd.md), interpretadas à luz
   dos contratos mais específicos acima;
4. o contrato de cartões em
   [`docs/S06-cartoes-faturas-parcelas.md`](../../docs/S06-cartoes-faturas-parcelas.md)
   e [`ADR-007`](007-s06-credit-cards-contract.md).

Assim, a formulação antiga do PRD que lista orçamento, caixinha e metas na
projeção não amplia as fontes do S07: esses conceitos entram em seus próprios
slices. O PRD continua sendo a referência de produto para receitas,
despesas, parcelamentos e eventos futuros, mas a implementação deve consumir
somente os tipos públicos definidos aqui.

Esta decisão não implementa schema, readers, engine, action, UI ou migration.
Ela fecha a semântica que essas implementações devem consumir.

## Gate de dependências

### S03 — fato, ledger e contexto

O S07 reutiliza o contrato de S03:

- `FinancialEvent` é o fato econômico, com `amount_cents` absoluto, positivo
  e em centavos inteiros;
- `AccountEntry` é o efeito assinado em uma conta; o saldo é a soma de entries
  `POSTED`, nunca uma coluna materializada;
- `POSTED` financeiro é preservado e corrigido por reversal/correction no
  slice apropriado, não por overwrite silencioso;
- datas financeiras são `Temporal.PlainDate`/PostgreSQL `DATE`, serializadas
  como `YYYY-MM-DD`; `Money` atravessa a boundary como string de centavos;
- `application_commands` é a única tabela compartilhada de idempotência;
- `requireFinancialContext()`/`withFinancialContext()` resolvem o household
  a partir da sessão e da membership no servidor.

Um evento `POSTED` de S03/S04 pode aparecer em uma visão histórica ou como a
realização de uma fonte do S07. Uma ocorrência planejada não é marcada como
realizada pela passagem do tempo: a realização exige vínculo explícito com um
`FinancialEvent`/entry `POSTED`.

### S06 — compra, parcela e transferência

O S07 não soma o evento econômico `PURCHASE`, o total da compra e suas
parcelas. Para fluxo de caixa, cada parcela materializada pelo S06 é a única
linha da obrigação daquele ciclo. O `billingCycle`/`competence` congelado no
S06 identifica a competência; a data efetiva do item é:

```text
POSTED installment → entry.postedOn
PLANNED/EXPECTED installment → billingDueOnOverride ?? billingDueOn
```

Cada parcela ativa produz no máximo um item de forecast, com
`referenceId=installment.id`. Parcela `CANCELLED` não produz item ativo. O
evento `PURCHASE` `POSTED` permanece no histórico, mas não cria uma segunda
saída. Pagamento de cartão é `TRANSFER`, com duas entries e soma zero; não é
despesa e não cria item de forecast household. Uma projeção por conta futura
pode reutilizar os mesmos itens e as pontas da transferência quando S10
definir essa extensão, sem alterar o contrato household do S07.

O estado normalizado de uma parcela usa `POSTED` quando seu único entry está
publicado e `EXPECTED` quando o entry ainda é esperado; `PLANNED` fica
reservado a uma fonte agendada que ainda não tenha entry esperado. Assim, a
diferença entre o status do aggregate S06 (`PLANNED`) e o status do seu efeito
(`EXPECTED`) não cria uma segunda linha. `PENDING`, embora exista no enum
geral de S03, não é um estado de item V1: deve ser resolvido por uma transição
explícita ou falhar fechado no builder.

## Decisões de domínio

### Vocabulário e estados

Os conceitos têm responsabilidades distintas:

| Conceito | Papel no S07 | Fonte canônica |
| --- | --- | --- |
| `FinancialEvent` | fato econômico realizado ou explicitamente planejado | `financial_events` de S03 |
| `AccountEntry` | efeito assinado/posição realizada de uma conta | `account_entries` de S03 |
| `RecurringRule` | regra mensal/anual e sua vigência | schema de T02 |
| `RecurringOccurrence` | ocorrência virtual ou exceção identificada | domínio/schema de T02–T03 |
| `Installment` | uma cobrança da compra parcelada | S06 |
| `ForecastItem` | representação normalizada de uma fonte no fluxo | somente em memória/read model |
| `ForecastTimeline` | resultado derivado para um intervalo e cenário | somente em memória/read model |

Os estados persistidos mantêm o significado do ledger e da fonte:

| Estado | Significado | Tratamento no forecast |
| --- | --- | --- |
| `PLANNED` | compromisso ou evento explicitamente agendado, ainda sem efeito realizado | pode gerar item projetado; nunca é realizado por data |
| `EXPECTED` | ocorrência/receita esperada, ainda sem efeito realizado | gera item projetado conforme cenário e certeza |
| `POSTED` | efeito financeiro efetivamente publicado, com entry/posted date válida | item realizado; substitui a previsão reconciliada |
| `CANCELLED` | fonte anulada de forma explícita e preservada para histórico | não gera item ativo; não é convertido em zero silencioso |

`occurredOn` é a data econômica do evento; `postedOn` é a data do efeito no
ledger; `expectedOn`/data agendada é a data da obrigação prevista. A data do
servidor, inclusive “hoje”, serve somente para resolver o saldo de abertura e
o default de período. Ela nunca muda `PLANNED`/`EXPECTED` para `POSTED`, nem
classifica uma ocorrência como realizada.

### Fontes V1 e exclusões

O builder T04 pode ler somente estas fontes de compromisso:

1. recorrência mensal/anual (`MONTHLY`/`YEARLY`) com regra de dia
   `FIXED_DAY`, `FIRST_BUSINESS_DAY` ou `LAST_BUSINESS_DAY`, vigência e
   ocorrência virtual;
2. override, skip/cancelamento e realização explicitamente vinculados à
   ocorrência;
3. evento planejado explícito, inclusive receita extraordinária ou despesa
   futura;
4. parcela futura/realizada do S06 pela competência materializada.

Um `FinancialEvent` `POSTED` independente pode ser mostrado no período
histórico/atual como realizado, mas não vira uma nova previsão. Essa leitura
é uma observação de ledger (`REALIZED_EVENT`), não uma quinta fonte de
compromisso. Se tiver relação com ocorrência ou evento planejado, a relação é
a fonte de reconciliação; o evento não é lido uma segunda vez como lançamento
avulso.

Ficam fora da V1 do S07: orçamento variável, caixinha/envelope, metas,
spendable, operational buffer, valorização de investimento, forecast
probabilístico, IA, integração de operadora, pagamento de cartão como
despesa, transferências como entrada/saída household, refund, reversal ou
correction genérico. A lista não impede o S10 de acrescentar uma extensão
versionada; impede que T02–T13 inventem essas fontes.

### Reconciliação e não duplicidade

Uma fonte prevista e sua realização representam a mesma obrigação. A chave de
reconciliação é estável e server-side:

```text
recurringRuleId + occurrenceKey
plannedEventId                  (evento planejado explícito)
installmentId                   (parcela S06)
```

Para recorrência, `occurrenceKey` é `YYYY-MM` para `MONTHLY` e `YYYY` para
`YEARLY`; a data normalizada, o override e a regra vigente são dados da
ocorrência, não uma nova chave. Para outras fontes, `referenceId` é o UUIDv7
opaco do recurso autorizado pelo servidor. O client nunca escolhe uma chave
para atravessar households.

As regras são:

1. uma chave ativa só pode produzir uma previsão por cenário;
2. uma realização `POSTED` vinculada substitui a previsão correspondente;
3. a realização pode ter valor diferente: o item realizado usa o valor
   publicado e o read model pode expor a variação contra o valor planejado;
4. realização parcial, quando explicitamente registrada pela fonte, produz o
   realizado mais o restante não realizado (`planned - realized`, mínimo
   zero) como uma única obrigação reconciliada. O restante não é inferido por
   data nem por saldo;
5. realização maior que a previsão não cria uma segunda previsão; a diferença
   é somente variação explicável;
6. ocorrência `CANCELLED`, evento planejado `CANCELLED` e parcela
   `CANCELLED` não entram; cancelamento não apaga o histórico;
7. a mesma parcela nunca é lida pelo `installmentId`, pelo `PURCHASE` e por
   `account_entry` como três saídas.

Conflitos que não possam ser reconciliados deterministicamente (duas fontes
ativas com a mesma chave ou parcela com dois entries) falham fechado com
`FORECAST_INCONSISTENT`; não se escolhe uma linha pelo acaso ou pela ordem do
banco.

### Certeza e cenários

O contrato público usa os seguintes valores:

```ts
type ForecastScenario = "CONSERVATIVE" | "EXPECTED";
type ForecastCertainty = "REALIZED" | "COMMITTED" | "EXPECTED";
```

Mapeamento:

- `POSTED` → `REALIZED`;
- obrigação conhecida (`PLANNED` ou parcela ativa) → `COMMITTED`;
- receita prevista sem confirmação → `EXPECTED`;
- recorrência de receita marcada como confiável pode ser `COMMITTED`;
- uma ocorrência não confirmada nunca se torna `REALIZED` apenas por estar
  vencida.

`CONSERVATIVE` inclui todos os outflows/obrigações conhecidas e entradas
`REALIZED` ou `COMMITTED`/explicitamente marcadas pela fonte como confiáveis
(`includeInConservativeForecast=true`). `EXPECTED` inclui todas as fontes
ativas, incluindo receitas esperadas. A V1 não possui despesa opcional que
seja removida do cenário conservador depois de cadastrada como compromisso.
Cancelamento e realização são tratados antes do filtro de cenário.

### Datas, intervalo e saldo

`from` e `to` são inclusivos, válidos como `PlainDate`, e `from <= to`. O
default público é o mês civil atual do servidor: primeiro ao último dia do
mês resolvido por `Temporal.PlainDate`; não é calculado no browser. O usuário
pode pedir qualquer mês/intervalo futuro sem limite conceitual de 12 meses.
Um limite operacional de consulta, caso necessário, deve retornar erro
explícito e permitir paginação/novos intervalos; nunca truncar silenciosamente
o resultado.

O saldo inicial real de um intervalo é derivado de entries `POSTED` até o dia
anterior a `from`. O builder também deve preservar compromissos ativos
previstos anteriores a `from` (por exemplo, uma despesa vencida ainda não
realizada) em `openingAdjustments`, para que não desapareçam ao navegar. O
resultado separa:

- `openingBalanceCents`: posição realizada do ledger;
- `openingAdjustmentsCents`: soma líquida de itens ativos anteriores ao
  intervalo, por cenário;
- `openingProjectedBalanceCents`: soma dos dois;
- `closingProjectedBalanceCents`: abertura projetada mais o net do intervalo.

Itens `POSTED` no intervalo usam a data do efeito (`postedOn`) e entram uma
vez. Itens previstos usam a data agendada/due date e continuam previstos
mesmo se a data já passou. Nenhum saldo é armazenado pelo S07.

### Agregação e determinismo

O engine recebe somente itens normalizados, saldo inicial, intervalo e
cenário. Para cada data, ele:

1. ordena os itens por `date`, precedência de estado (`POSTED` antes de
   projetado para apresentação), `source.kind`, `referenceId` e
   `occurrenceKey`/sequence quando presentes;
2. agrega todos os inflows e outflows da data antes de alterar o saldo;
3. calcula `net = inflows - outflows` e o saldo de fechamento da data;
4. calcula o menor saldo e as referências que explicam o ponto mínimo.

A ordem física de rows do banco, a hora atual, timezone, locale e float não
participam do resultado. IDs UUIDv7 já persistidos são usados somente como
tie-break estável; não se ordena por `createdAt` quando isso puder mudar a
semântica. A mesma entrada, período e cenário produzem a mesma forma e os
mesmos valores serializados.

## Contrato serializável

Os tipos abaixo são o boundary público entre T06, T08/T09, S08 e S10. Todos
os centavos são strings decimais inteiras; datas são `YYYY-MM-DD`; não há
`bigint`, `Date`, objeto Drizzle, SQL, sessão, autorização ou household no
payload.

```ts
type ForecastDirection = "INFLOW" | "OUTFLOW";
type ForecastItemStatus = "PLANNED" | "EXPECTED" | "POSTED";
type ForecastSourceKind =
  | "RECURRING"
  | "PLANNED_EVENT"
  | "INSTALLMENT"
  | "REALIZED_EVENT";

interface ForecastSource {
  kind: ForecastSourceKind;
  /** Opaque, server-authorized UUID/reference for drill-down. */
  referenceId: string;
  /** Safe display label; no raw financial description is required. */
  label: string;
  /** Present only for a recurring source; never accepted as query authority. */
  recurringRuleId?: string;
  occurrenceKey?: string;
  /** Present only for an installment source. */
  billingCycle?: string; // YYYY-MM, the materialized S06 competence
  installmentSequence?: number;
}

interface ForecastReconciliation {
  key: string;
  replacesReferenceId: string | null;
  plannedAmountCents: string | null;
  realizedAmountCents: string | null;
  remainingAmountCents: string | null;
  varianceAmountCents: string | null;
}

interface ForecastItem {
  date: string;
  amountCents: string;
  direction: ForecastDirection;
  status: ForecastItemStatus;
  certainty: ForecastCertainty;
  source: ForecastSource;
  referenceId: string;
  reconciliation: ForecastReconciliation | null;
}
```

`amountCents` é sempre positivo; a direção determina o sinal. Um item
`CANCELLED` não é serializado como item ativo. O `referenceId` no topo é
igual a `source.referenceId` para permitir drill-down sem consultar tabelas
internas; a duplicação é intencional e deve ser validada pelo adapter.
Labels são seguros para apresentação e não são usados para ordenar ou
reconciliar. Se uma origem não puder ser detalhada, o serviço mantém a
referência opaca e retorna `sourceUnavailable=true` no envelope de detalhe,
sem vazar metadados; isso não altera o total.

```ts
interface ForecastDay {
  date: string;
  items: readonly ForecastItem[];
  inflowCents: string;
  outflowCents: string;
  netCents: string;
  openingProjectedBalanceCents: string;
  closingProjectedBalanceCents: string;
}

interface ForecastPeriodTotals {
  period: string; // YYYY-MM
  inflowCents: string;
  outflowCents: string;
  netCents: string;
  realizedInflowCents: string;
  realizedOutflowCents: string;
  projectedInflowCents: string;
  projectedOutflowCents: string;
}

type ForecastTotals = Omit<ForecastPeriodTotals, "period">;

interface ForecastTimeline {
  contractVersion: "s07.v1";
  scenario: ForecastScenario;
  from: string;
  to: string;
  openingBalanceCents: string;
  openingAdjustmentsCents: string;
  openingProjectedBalanceCents: string;
  closingProjectedBalanceCents: string;
  minimumProjectedBalanceCents: string;
  minimumProjectedOn: string | null;
  totals: ForecastTotals;
  periods: readonly ForecastPeriodTotals[];
  days: readonly ForecastDay[];
  minimumBalanceReferences: readonly string[];
}
```

`periods` contém um bucket por mês civil atravessado pelo intervalo, inclusive
meses sem itens, em ordem crescente. `totals` é a soma desses buckets.
`days` contém dias que possuem itens ou ajuste de abertura; a ausência de um
dia não significa saldo desconhecido. Em um mês vazio, as listas de itens e
days são vazias, os totais são zero e os saldos inicial/final permanecem
iguais. O engine pode expor uma lista diária completa em uma versão posterior
sem mudar a semântica dos buckets.

O envelope de T06 para leitura é:

```ts
interface GetForecastQuery {
  from?: string;
  to?: string;
  scenario?: ForecastScenario; // default: CONSERVATIVE
}

type ForecastResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ForecastError };

interface ForecastError {
  code:
    | "INVALID_DATE"
    | "INVALID_DATE_RANGE"
    | "INVALID_SCENARIO"
    | "FORECAST_RANGE_TOO_LARGE"
    | "FINANCIAL_CONTEXT_REQUIRED"
    | "FORECAST_NOT_FOUND"
    | "FORECAST_INCONSISTENT"
    | "FORECAST_QUERY_FAILED";
  field: string | null;
}
```

`getForecast(query)` é uma leitura server-only. A implementação resolve o
contexto e o relógio de negócio no servidor; o client pode enviar somente
`from`, `to` e `scenario`. Não aceita `householdId`, `userId`, autorização,
status, sinal, saldo, `referenceId`, tabela ou conta como autoridade. Uma
referência de origem inexistente ou de outro household retorna
`FORECAST_NOT_FOUND`/ausência indistinguível, sem revelar qual dos dois casos
ocorreu. Erros de validação não ampliam o intervalo consultado.

O contrato de leitura não usa `commandId`: é uma operação sem efeitos. Os
writes futuros de T02/T03/T10 usam a tabela existente
`application_commands`, chave `(household_id, command_id)`, hash do payload
canônico e uma transaction única. Operações mínimas são:

```text
recurring_rule.create
recurring_rule.update_future
recurring_rule.end
recurring_occurrence.override
recurring_occurrence.cancel
recurring_occurrence.realize
planned_event.create
planned_event.update
planned_event.cancel
```

Repetição com mesma operação e payload normalizado retorna o resultado
original; mesmo `commandId` com payload/operação diferente retorna
`COMMAND_ID_REUSED`. Falha de qualquer write faz rollback do agregado e da
linha de idempotência. `household_id`, autorização, origem, status e sinais
são derivados no servidor.

## Matriz normativa de exemplos

Os exemplos usam centavos, para tornar arredondamento e soma verificáveis.

| Caso | Fonte/entrada | Itens ativos e resultado obrigatório |
| --- | --- | --- |
| Salário previsto e realizado | Regra salário `R$10.000` em `2026-09` (`EXPECTED`, chave `ruleA+2026-09`); realização `POSTED` de `R$11.500` vinculada | Um item `POSTED` `INFLOW=1150000`; a previsão de `1000000` é substituída; `variance=+150000`; não há dois inflows. |
| Receita parcial | `EXPECTED=2000000`, realização vinculada `POSTED=1200000`, com partial explícito | Item realizado `1200000` + residual projetado `800000`, ambos com a mesma chave reconciliada e papéis diferentes; sem reintroduzir `2000000`. Se a fonte não declarar partial, só o realizado entra. |
| Recorrência alterada | Regra antiga `R$100` vigente até `2026-09-30`; nova `R$120` inicia `2026-10-01` | `2026-09` mantém `10000` e overrides históricos; `2026-10` usa `12000`; chaves `old+2026-09` e `new+2026-10`; nenhuma linha histórica é reescrita. |
| Parcela cancelada | Compra S06 `3x R$100`, parcelas em agosto/setembro/outubro; cancelamento integral do purchase antes de outubro | Parcelas futuras ficam `CANCELLED` e não aparecem; parcelas/entries históricos preservados; não existe ação de cancelar/pagar parcela isolada. |
| Compra e pagamento de cartão | Purchase `R$300` com parcelas; pagamento `TRANSFER` banco→cartão | Forecast household contém cada parcela uma vez; não contém `R$300` do purchase nem o pagamento como despesa. S10 poderá projetar pontas da transferência por conta em extensão própria. |
| Virada de ano | Recorrência anual `2026-12` e parcela S06 com `billingCycle=2027-01` | Períodos `2026-12`, `2027-01` seguem ordem civil; a parcela pertence somente ao bucket/competência materializado `2027-01`; não há perda nem duplicação. |
| Mês vazio | Intervalo `2027-02-01..2027-02-28`, nenhuma fonte ativa | `periods` contém `2027-02` com inflow/outflow/net zero; `days=[]`; abertura e fechamento projetados iguais. |
| Planejado atrasado | Despesa `PLANNED` em `2026-08-10`, consulta em setembro, sem realização | Continua projetada/comprometida em `openingAdjustments`; não muda para `POSTED` por estar atrasada e não desaparece do saldo futuro. |
| Mesmo dia | Entrada `+1500000` e saídas `-300000`, `-200000` em `2026-09-01` | Dia agrega antes do saldo: inflow `1500000`, outflow `500000`, net `1000000`; o resultado não depende da ordem dos rows. |
| Cenário | Receita `EXPECTED=2000000` sem flag conservadora e despesa conhecida `PLANNED=500000` | `CONSERVATIVE` inclui somente a despesa; `EXPECTED` inclui a receita e a despesa; item realizado sempre entra em ambos. |
| Parcela arredondada | Compra S06 `10000/3` | Três itens `3334`, `3333`, `3333`, soma `10000`; nenhuma linha adicional para o total econômico. |
| Cancelamento e realização | Ocorrência cancelada e ocorrência realizada com mesmo mês | Cancelada não entra; realizada substitui a ocorrência apenas pela chave explícita; duas fontes com a mesma chave sem vínculo geram `FORECAST_INCONSISTENT`. |

## Handoff explícito

| Task | Contrato que deve consumir desta ADR |
| --- | --- |
| [T02 — schema](../../tasks/S07-fluxo-futuro/002-schema-recorrencias-eventos-planejados_task.md) | Persistir regras, vigência, exceções e eventos planejados; `DATE`, centavos, UUIDv7, FKs compostas por household, `(recurring_rule_id, occurrence_key)` único; não persistir timeline/saldo. |
| [T03 — recorrência/calendário](../../tasks/S07-fluxo-futuro/003-regras-recorrencias-calendario_task.md) | Gerar `MONTHLY`/`YEARLY`, regras de dia e chaves estáveis; aplicar vigência, override, skip/cancelamento e realização sem inferir por data. |
| [T04 — fontes/timeline builder](../../tasks/S07-fluxo-futuro/004-fontes-normalizadas-timeline_task.md) | Ler somente as quatro fontes V1, reconciliar por chave, usar a data efetiva do S06 e emitir `ForecastItem[]` independente de SQL/Drizzle. |
| [T05 — engine puro](../../tasks/S07-fluxo-futuro/005-forecast-engine-puro_task.md) | Receber itens, abertura, intervalo e cenário; agregar por dia, calcular buckets/saldos/mínimo e ordenar deterministicamente. |
| [T06 — serviço/query](../../tasks/S07-fluxo-futuro/006-servico-projecao-contrato-api_task.md) | Expor `getForecast`/`ForecastTimeline`, validar boundary, resolver contexto no servidor, aplicar limites operacionais sem truncar e retornar erros opacos. |
| [T07 — observabilidade](../../tasks/S07-fluxo-futuro/007-observabilidade-segura_task.md) | Instrumentar fonte/builder/engine/query sem descrição, valor, saldo, referência ou payload financeiro cru; classificar códigos acima. |
| [T08 — contratos UI](../../tasks/S07-fluxo-futuro/008-contratos-componentes-ui_task.md) | Renderizar status/cenário, totals, labels e datas a partir do read model; não recalcular regras nem acessar banco no client. |
| [T09 — visão por período](../../tasks/S07-fluxo-futuro/009-visao-futura-por-periodo_task.md) | Usar somente T06, default do mês civil, períodos vazios, virada de ano e distinção textual realizado/projetado. |
| [T10 — drill-down/manutenção](../../tasks/S07-fluxo-futuro/010-drilldown-origens-e-manutencao_task.md) | Resolver `referenceId` no household do servidor; permitir apenas actions das fontes; parcela abre origem S06 e não recebe pagamento/edição isolados. |
| [T11 — testes](../../tasks/S07-fluxo-futuro/011-testes-unitarios-integracao_task.md) | Automatizar a matriz acima, precisão, estados, reconciliação, cancelamento, isolamento, idempotência, rollback, intervalo e independência do relógio/timezone. |
| [T12 — E2E](../../tasks/S07-fluxo-futuro/012-testes-e2e_task.md) | Cobrir consulta, navegação, mês vazio, parcela única, origem, realização/cancelamento e proteção de referências no browser. |
| [T13 — release](../../tasks/S07-fluxo-futuro/013-validacao-release_task.md) | Auditar contrato versionado, evidências, privacy/observabilidade, query limits, migration controlada e handoff de tipos para S08/S10. |

## Extensão para S08 e S10

S08 recebe `ForecastTimeline`/`ForecastPeriodTotals` e usa
`minimumProjectedBalanceCents`, sem consultar parcelas, regras ou tabelas
internas e sem aplicar novamente a regra de não duplicidade. O operational
buffer, `rawSpendable` e `displaySpendable` pertencem ao S08 e não são
campos de `ForecastTimeline` V1.

S10 pode adicionar uma leitura versionada com `scope="ACCOUNT"` e uma
coleção de timelines por conta, reutilizando `ForecastItem`, as mesmas chaves
e as mesmas regras de deduplicação. Essa extensão deve ser server-side,
tenant-safe e manter transferências como transferência entre contas; não pode
alterar o significado de `Household Forecast`, introduzir `householdId` no
payload do client ou fazer o S10 consultar tabelas do S07/S06 diretamente.

## Invariantes e fora de escopo do gate

O contrato exige, no mínimo:

- `ForecastEngine` não importa persistência, Drizzle, cartão, recorrência ou
  relógio;
- soma de entradas/saídas e saldo final fecham em centavos inteiros;
- `POSTED` não é futuro, mas item previsto atrasado continua previsto até
  realização/cancelamento explícitos;
- uma parcela, uma ocorrência ou um evento planejado não aparecem duas vezes;
- nenhuma resposta aceita ou confia em `householdId`/autorização do client;
- referências cross-tenant são ausência/erro opaco;
- a projeção não cria `PAID` para parcela, não paga parcela isolada e não
  materializa saldo/timeline.

Não fazem parte deste gate: implementação dos itens acima, probabilidades,
metas, orçamento, caixinhas, spendable, investimento, refund, reversal ou
correction genérico, endpoint público adicional, cache que altere
consistência e UI final.
