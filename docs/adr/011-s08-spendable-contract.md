# ADR-011 — Contrato de disponibilidade para gastar do S08

- **Status:** Aceito
- **Data:** 2026-09-01
- **Escopo:** T01 do slice S08 — Disponível para gastar
- **Dependências:** S01–S07, ADR-003, ADR-007, ADR-008, TechSpec §§15–16 e 48–57

## Contexto e precedência

O S08 responde quanto pode ser gasto sem comprometer o menor saldo projetado
dos compromissos conhecidos. O valor é uma derivação de ledger, forecast e
configuração; não é um saldo persistido nem uma nova fonte contábil.

Esta ADR materializa o ADR-011 listado na TechSpec. Em caso de conflito, a
precedência para este slice é:

1. esta ADR e [`docs/S08-disponivel-para-gastar.md`](../S08-disponivel-para-gastar.md);
2. [`ADR-008`](008-s07-forecast-contract.md) e o contrato público `s07.v1`;
3. as seções 15–16 e 48–57 da [`docs/techspec.md`](../techspec.md);
4. os contratos de ledger/tenancy de S01–S03 e o PRD, interpretados à luz das
   decisões específicas acima.

Esta decisão fecha semântica, tipos serializáveis, exemplos e gates. Não
implementa query, migration, engine, adapter de reservas ou UI.

## Gate do S07

O contrato publicado do S07 é suficiente como fonte de compromissos para o
S08. A evidência atual é:

- `src/modules/forecast/contracts.ts` publica `FORECAST_CONTRACT_VERSION =
  "s07.v1"`, `ForecastScenario`, `ForecastItem`, `ForecastDay`,
  `ForecastPeriodTotals` e `ForecastTimeline`;
- `ForecastTimeline` carrega `scenario`, `from`, `to`,
  `openingBalanceCents`, `openingAdjustmentsCents`,
  `openingProjectedBalanceCents`, `closingProjectedBalanceCents`,
  `minimumProjectedBalanceCents`, `minimumProjectedOn`, `days` e
  `minimumBalanceReferences`;
- cada `ForecastItem` carrega data, direção, centavos, estado, certeza,
  origem/referência opaca e reconciliação; a referência top-level coincide
  com a referência da origem;
- `readForecastOpeningBalanceForContext` calcula a posição de entries
  `POSTED` até o dia anterior a `from`, e o builder preserva compromissos
  previstos atrasados em `openingAdjustmentsCents`;
- parcelas do S06 entram pelo `installmentId` uma vez. O total da compra, o
  pagamento de cartão e a parcela não são fontes concorrentes, conforme
  ADR-008.

S08 normaliza o intervalo assim, sempre no servidor:

```text
forecast.from = asOf + 1 dia civil
forecast.to   = asOf + horizon.days
```

Logo, o `openingBalanceCents` da timeline S07 é a soma de entries `POSTED`
até `asOf`, pois `asOf = from - 1 dia`. A data de referência é, portanto,
derivável sem adicionar um campo ambíguo ao `s07.v1`, e é repetida
explicitamente no read model do S08.

O `openingBalanceCents` do S07 é household-wide. Para o spendable global, o
adapter server-side não pode usá-lo cegamente quando houver contas
`RESTRICTED` ou `EXCLUDED`: T06 deve obter a abertura de entries `POSTED` de
contas `spendability=GENERAL`, no mesmo `household_id`, e replayar os itens
normalizados do S07 no engine puro. Essa abertura scoped é a autoridade do
S08; não se faz uma segunda leitura de parcelas, faturas ou regras. Fontes
futuras explicitamente vinculadas a uma conta devem ser filtradas pelo mesmo
escopo antes da normalização; fonte sem conta é compromisso household-level e
segue as regras de cenário do S07.

Assim, o gate S07 passa para o uso definido nesta ADR: S07 fornece a timeline
de compromissos e suas referências, enquanto S08 fornece a abertura de
recursos `GENERAL`. Nenhum campo de `householdId`, autorização, SQL, `Date` ou
`bigint` atravessa a boundary pública.

## Contrato de entrada

O request externo é estrito. A ausência de campos opcionais usa somente
defaults definidos aqui, resolvidos no servidor; o browser nunca fornece o
relógio de negócio.

```ts
type SpendableScenario = "CONSERVATIVE" | "EXPECTED";

interface GetSpendableInput {
  /** ISO PlainDate. Omitido: data civil do servidor. */
  asOf?: string;
  /** Omitido: CONSERVATIVE. */
  scenario?: SpendableScenario;
  /** Omitido: { days: 90 }. */
  horizon?: { days: number };
}

interface NormalizedGetSpendableInput {
  asOf: string;
  scenario: SpendableScenario;
  horizon: { days: number };
  forecastFrom: string;
  forecastTo: string;
}
```

`asOf` é o fechamento civil inclusivo da posição realizada. Entries
`POSTED` com `postedOn <= asOf` compõem o saldo de referência; o primeiro dia
projetado é `asOf + 1`. Um compromisso `PLANNED`/`EXPECTED` vencido até
`asOf`, ainda sem realização ou cancelamento explícitos, permanece em
`openingAdjustmentsCents` e não vira `POSTED` por passagem do tempo.

`horizon.days` é inteiro positivo entre 1 e 3.660, inclusivo. O horizonte
contém exatamente esse número de dias civis posteriores a `asOf`; `0`,
frações, negativos, floats, datas finais fornecidas em paralelo ou intervalos
implícitos são inválidos. O limite de 3.660 acompanha o limite operacional
default do S07 e pode ser reduzido pela configuração do serviço, nunca
silenciosamente truncado. Um horizonte sem eventos é válido; horizonte de
zero dias não é.

O request não aceita `householdId`, `userId`, `accountId`, lista de contas,
`spendability`, `buffer`, `referenceId`, status, sinal, saldo, timeline,
autorização ou qualquer seleção de fonte. O contexto financeiro é resolvido
por `requireFinancialContext()` no servidor. Referência ou contexto de outro
household é ausência/erro opaco.

## Contrato serializável de saída

Os centavos abaixo são strings decimais inteiras; podem ser assinados somente
onde indicado. Datas são `YYYY-MM-DD`. `horizonDays` é metadado inteiro e não
participa de aritmética monetária.

```ts
const SPENDABLE_CONTRACT_VERSION = "s08.v1" as const;
const SPENDABLE_RULE_VERSION = "spendable.v1" as const;

type SpendableBufferSource = "CONFIGURED" | "ABSENT_DEFAULT_ZERO";

interface SpendablePeriod {
  asOf: string;
  from: string;             // asOf + 1
  to: string;               // asOf + horizonDays
  horizonDays: number;
  scenario: SpendableScenario;
  forecastContractVersion: "s07.v1";
}

interface OperationalBufferSnapshot {
  amountCents: string;      // inteiro decimal >= 0
  source: SpendableBufferSource;
  effectiveFrom: string | null;
  revision: string | null;  // referência opaca da configuração
}

interface SpendableCausalItem {
  referenceId: string;      // opaco e autorizado pelo servidor
  sourceKind:
    | "RECURRING"
    | "PLANNED_EVENT"
    | "INSTALLMENT"
    | "REALIZED_EVENT"
    | "RESERVE";
  date: string;
  amountCents: string;       // inteiro > 0
  direction: "INFLOW" | "OUTFLOW";
  status: "PLANNED" | "EXPECTED" | "POSTED" | null;
  certainty: "REALIZED" | "COMMITTED" | "EXPECTED" | null;
}

interface SpendableCausalPoint {
  kind: "OPENING" | "DAY_CLOSE";
  date: string;
  projectedBalanceCents: string;
  references: readonly string[];
  items: readonly SpendableCausalItem[];
}

interface SpendableReserveSnapshot {
  contractVersion: "s09.v1";
  status: "UNAVAILABLE" | "AVAILABLE";
  protectedCents: string;
  appliedOpeningAdjustmentCents: string;
  components: readonly {
    referenceId: string;
    amountCents: string;
    effectiveOn: string;
  }[];
}

interface SpendableBreakdown {
  contractVersion: typeof SPENDABLE_CONTRACT_VERSION;
  ruleVersion: typeof SPENDABLE_RULE_VERSION;
  period: SpendablePeriod;

  // Abertura e projeção, sempre no escopo global GENERAL.
  openingBalanceCents: string;
  openingAdjustmentsCents: string;
  openingProjectedBalanceCents: string;
  closingProjectedBalanceCents: string;
  minimumProjectedBalanceCents: string;
  minimum: {
    projectedBalanceCents: string;
    points: readonly SpendableCausalPoint[];
  };

  operationalBuffer: OperationalBufferSnapshot;
  reserve: SpendableReserveSnapshot;
  rawSpendableCents: string;
  displaySpendableCents: string;
  deficitToPreserveReserveCents: string;
}
```

`minimum` é a explicação completa do mínimo. `kind=OPENING` usa a data
`asOf`, mesmo que o S07 represente esse ponto com `minimumProjectedOn=null`;
`kind=DAY_CLOSE` usa o fechamento do dia indicado. `points` contém todos os
pontos empatados no menor valor, em ordem civil e depois por referência
canônica. Para um ponto de abertura sem ajuste causal, `references` e `items`
são vazios: isso significa que a própria posição de abertura é o mínimo, não
que o saldo seja desconhecido. Para uma abertura com compromissos atrasados,
as referências de `openingAdjustmentsCents` são preservadas; itens disponíveis
no dia são copiados de `ForecastDay.items` do S07. Um item `RESERVE` usa
`status=null` e `certainty=null`; os demais preservam o status/certeza do S07.
Labels seguros podem ser resolvidos posteriormente pelo drill-down, mas não
são necessários para reconciliar o cálculo.

`openingBalanceCents` é a posição realizada de `POSTED` GENERAL até `asOf`.
`openingAdjustmentsCents` é a soma líquida dos itens ativos projetados antes
de `from` mais `reserve.appliedOpeningAdjustmentCents` (zero no S08 V1);
`openingProjectedBalanceCents` é a soma dos dois. O mínimo inclui essa
abertura e todos os fechamentos diários. `minimumProjectedBalanceCents` é
exatamente `minimum.projectedBalanceCents`; não há segundo mínimo escondido.

## Fórmula e invariantes

No S08 V1 o adapter de reserva é neutro, portanto
`reserve.appliedOpeningAdjustmentCents = "0"`. O engine aplica qualquer
ajuste de reserva futuro antes de encontrar o mínimo, e a fórmula não muda:

```text
minimumProjectedBalance = min(
  openingProjectedBalance,
  closingProjectedBalance de cada dia do horizonte
)

rawSpendable = minimumProjectedBalance - operationalBuffer
displaySpendable = max(0, rawSpendable)
deficitToPreserveReserve = max(0, -rawSpendable)
```

Todos os operadores são inteiros em centavos (`bigint` no domínio). Não se
aplica `max(0)` antes de guardar `rawSpendable`; o bruto negativo é parte do
breakdown. O resultado deve satisfazer:

```text
minimum.projectedBalanceCents = minimumProjectedBalanceCents
rawSpendableCents = minimumProjectedBalanceCents - operationalBuffer.amountCents
displaySpendableCents >= 0
deficitToPreserveReserveCents >= 0
displaySpendableCents > 0  ⇒  deficitToPreserveReserveCents = 0
rawSpendableCents < 0      ⇒  displaySpendableCents = 0
                              e deficit = abs(rawSpendable)
```

O agrupamento intradiário segue o S07: todos os inflows e outflows do mesmo
dia são agregados antes de atualizar o saldo. A ordem de rows não pode criar
um mínimo artificial. A mesma entrada, cenário, período, configuração e
versão de regra devem produzir os mesmos centavos, pontos e ordenação.

## Buffer operacional, configuração e versionamento

`operational_buffer_cents` é absoluto, por household, inteiro `>= 0`; não é
percentual, média de despesa, saldo de conta, limite de cartão ou reserva de
caixinha. O valor usado é selecionado no servidor pela última configuração
com `effectiveFrom <= asOf`.

Não existe hoje uma coluna/tabela de buffer no schema de S01–S07. T06 deve,
portanto, entregar uma migration tenant-safe para uma relação equivalente a:

```text
spendable_settings
  id                       UUIDv7 primary key
  household_id             UUID not null, FK para households
  effective_from           DATE not null
  operational_buffer_cents BIGINT not null CHECK (>= 0)
  created_at               timestamp técnico not null
  UNIQUE (household_id, effective_from)
```

A relação é efetiva-datada, não um campo sobrescrito: uma mudança cria nova
versão a partir de uma data, preserva valores anteriores e não reinterpreta
consultas históricas. `revision` no DTO é uma referência opaca e não é usada
como autoridade pelo client. Alterar a fórmula exige `ruleVersion=
"spendable.v2"` e ADR nova; alterar apenas o valor/configuração não altera a
versão da regra.

Se não houver linha aplicável até `asOf`, o cálculo não bloqueia e não inventa
percentual: usa `amountCents="0"`, `source="ABSENT_DEFAULT_ZERO"`,
`effectiveFrom=null` e `revision=null`. A ausência é explícita no breakdown e
é telemetria de resultado esperado, não exceção técnica. Uma linha inválida,
negativa ou de outro household falha fechado.

## Recursos, cartões e fontes previstas

O spendable global é uma posição consolidada de recursos `GENERAL`:

| Classificação | Global | Tratamento contextual |
| --- | --- | --- |
| `GENERAL` | Soma entries `POSTED` signed das contas do household; compromissos S07 aplicáveis reduzem/aumentam a projeção | Pode compor o global |
| `RESTRICTED` | Nunca é usado para aumentar ou compensar o global | Pode ser mostrado separadamente por contexto/regra |
| `EXCLUDED` | Nunca entra no global nem no saldo de disponibilidade | Fora do cálculo |

O filtro de conta repete `household_id` em toda relação. Patrimônio,
investimento preservado, limite de cartão, fatura, saldo de fatura e saldo de
caixinha não são sinônimos de recurso gastável. Uma conta de cartão só
participa pelos efeitos signed do ledger quando estiver no escopo de leitura;
limite, purchase total e fatura não são adicionados como recursos. A
obrigação futura de cartão entra pelo item `INSTALLMENT` consolidado do S07,
uma vez por `installmentId`. O evento econômico `PURCHASE` e o pagamento
`TRANSFER` não viram duas saídas adicionais.

Fontes `PLANNED`/`EXPECTED` obedecem ao cenário S07: `CONSERVATIVE` inclui
obrigações conhecidas e receitas `REALIZED`/`COMMITTED` confiáveis; `EXPECTED`
também inclui receitas previstas. Data vencida não realiza fonte. Uma fonte
cancelada não produz item ativo. O S08 não consulta recorrências, eventos,
parcelas, compras ou pagamentos em paralelo para “confirmar” o resultado.

## Porta de reservas do S09

Antes do S09, a implementação é um `ZeroReserveAdapter` que sempre devolve:

```ts
{
  contractVersion: "s09.v1",
  status: "UNAVAILABLE",
  protectedCents: "0",
  appliedOpeningAdjustmentCents: "0",
  components: [],
}
```

A porta é server-only e recebe a data `asOf` normalizada, cenário e horizonte
como contexto técnico; não aceita household vindo do client. Quando S09 for
habilitado, `components` será uma coleção de referências opacas da reserva e
valores em centavos, derivados dos movimentos da caixinha na data de corte.
O adapter transforma somente a parcela protegida ainda não refletida no
ledger/forecast em ajuste de abertura negativo; depois o engine encontra o
mesmo mínimo e aplica a mesma fórmula. Não se subtrai a reserva novamente de
`rawSpendable`.

Uma contribuição, retirada ou despesa já representada por `POSTED` entry ou
item de forecast não pode ser devolvida também como componente de reserva
aplicado. A chave da contribuição/movimento é usada para deduplicar; se a
reserva já estiver refletida, o ajuste aplicado é zero para aquela parcela.
Retirada libera proteção e aumenta a abertura uma vez. S09 pode futuramente
fornecer ajustes por data, mas deve manter esta mesma regra de não dupla
contagem e o contrato versionado.

### Handoff operacional publicado por T08

O proprietário da implementação final é o domínio/backend do S09 (Caixinhas e
movimentos). A porta server-side, sem dependência de persistência, está em
[`src/modules/spendable/reserve-adapter.ts`](../../src/modules/spendable/reserve-adapter.ts)
e é exportada pelo módulo `spendable`. Ela publica `s09.v1`, recebe somente o
contexto técnico normalizado (`asOf`, cenário, horizonte e referências já
refletidas) e produz internamente valores `Money`/`Temporal.PlainDate`; a
serialização continua usando strings de centavos e datas ISO.

O componente de v1 é discriminado por `kind=BOX_BALANCE`,
`rule=BOX_BALANCE_PROTECTED` e `boxReferenceId`. Ele carrega a proteção
positiva da caixinha, o ajuste de abertura assinado e as referências opacas
dos movimentos considerados. O saldo por caixinha é derivado como
`CONTRIBUTION - WITHDRAWAL` na data de corte; saldo negativo é mantido para o
histórico, mas sua proteção e seu ajuste global são zero. `closedOn` libera a
proteção na data de encerramento, sem apagar a série histórica.

O contrato de comportamento, os cenários que S09 deve habilitar e o owner
estão detalhados no [handoff S08 → S09](../S09-caixinhas.md#handoff-s08--s09-t08).
O `ZeroReserveAdapter` comprova o caminho pré-S09: retorna `UNAVAILABLE`,
centavos zero e componentes vazios; portanto, a ausência de S09 não bloqueia
nem altera a API pública de S08.

## Matriz normativa de exemplos

Todos os valores são centavos. O intervalo projetado começa no dia seguinte
ao `asOf`; o `minimum` inclui a abertura em `asOf`.

| Caso | Entrada relevante | Resultado obrigatório |
| --- | --- | --- |
| Positivo | `asOf=2026-09-01`, horizonte 90, abertura GENERAL `1200000`, mínimo no fechamento de `2026-09-15` `734500`, buffer `500000` | `raw=234500`, `display=234500`, `deficit=0`; mínimo é `DAY_CLOSE` em `2026-09-15`. |
| Zero | Abertura/mínimo `500000`, buffer `500000` | `raw=0`, `display=0`, `deficit=0`; zero não é déficit. |
| Bruto negativo | Abertura `600000`, fechamento mínimo `300000`, buffer `500000` | `raw=-200000`, `display=0`, `deficit=200000`; o bruto negativo permanece no breakdown. |
| Mesmo dia | Abertura `100000`; em `2026-09-02`, inflow `150000` e outflows `30000`/`20000` | O dia fecha com net `100000` e saldo `200000`; a ordem intradia não altera o saldo diário nem cria mínimo artificial. A abertura `100000` continua candidata ao mínimo. |
| Horizonte sem eventos | `asOf=2026-09-01`, abertura `800000`, buffer `100000`, nenhum item em 90 dias | `days=[]`, abertura=fechamento=mínimo `800000`, ponto `OPENING` em `2026-09-01`, `raw=700000`; ausência de events não significa saldo desconhecido. |
| Parcela futura | Compra S06 `3x100000`, ciclos/datas distintos | S07 entrega três itens `INSTALLMENT`, um por `installmentId`; S08 não soma `PURCHASE=300000`, fatura ou pagamento `TRANSFER`. |
| Cenário | Abertura `500000`, despesa conhecida `500000`, receita `EXPECTED=300000` sem flag conservadora | `CONSERVATIVE` exclui a receita e mantém a despesa; `EXPECTED` inclui a receita e a mesma despesa; o item não é duplicado nem realizado por estar vencido. |
| Recursos | Entries GENERAL `100000`, RESTRICTED `900000`, EXCLUDED `500000` | Abertura global é `100000`; recursos restritos/excluídos não compensam déficit nem inflamam disponibilidade. |
| Buffer ausente | Nenhuma linha de configuração aplicável a `asOf` | `operationalBuffer.amountCents="0"`, source `ABSENT_DEFAULT_ZERO`, cálculo continua disponível e a ausência é declarada. |
| Mudança de buffer | Linha `effectiveFrom=2026-09-10` com `50000`; consulta em `2026-09-09` e em `2026-09-10` | Consulta de 09/09 usa zero/linha anterior; consulta de 10/09 usa `50000`; nenhuma consulta anterior é reescrita. |
| Reserva pré-S09 | Zero adapter | `status=UNAVAILABLE`, componentes vazios e ajuste zero; fórmula e resultado não mudam por S09 ausente. |
| Reserva refletida | S09 informa reserva `100000`, mas a contribuição correspondente já é `POSTED` no ledger | Componente já refletido não é aplicado de novo; ajuste efetivo é `0` para ele. |

## Handoff para as tasks

| Task | Obrigação contratual |
| --- | --- |
| [T02 — tipos/fixtures](../../tasks/S08-disponivel-para-gastar/002-tipos-fixtures-e-timeline-normalizada_task.md) | Modelar entrada normalizada, período, cents strings, cenário, itens/referências de S07 e fixtures da matriz; não usar float/Date. |
| [T03 — engine](../../tasks/S08-disponivel-para-gastar/003-engine-puro-spendable-breakdown_task.md) | Receber abertura, itens, janela, cenário, buffer e reserva já normalizados; incluir abertura no mínimo, agregar o dia, preservar bruto/déficit e empates. |
| [T04 — UI contract](../../tasks/S08-disponivel-para-gastar/004-contrato-ui-estados-apresentacao_task.md) | Consumir somente `SpendableBreakdown`; comunicar período, cenário, buffer, zero e déficit sem recalcular fórmula. |
| [T05 — observabilidade](../../tasks/S08-disponivel-para-gastar/005-observabilidade-segura_task.md) | Usar versão, cenário, horizonte, contagens e códigos agregados; nunca registrar centavos, saldos, descrições, nomes, referências financeiras ou timeline. |
| [T06 — query/service](../../tasks/S08-disponivel-para-gastar/006-query-tenant-safe-servico-disponibilidade_task.md) | Resolver contexto no servidor; ler abertura apenas de `POSTED` GENERAL; selecionar buffer efetivo; consumir S07 no intervalo explícito; usar ZeroReserveAdapter; não duplicar fontes. |
| [T07 — breakdown/origem](../../tasks/S08-disponivel-para-gastar/007-breakdown-origem-minimo-nao-dupla-contagem_task.md) | Mapear pontos empatados, refs e itens causais; manter drill-down opaco, limite/truncamento explícito e uma parcela uma única vez. |
| [T08 — reservas](../../tasks/S08-disponivel-para-gastar/008-adaptador-reservas-handoff-s09_task.md) | Publicar `s09.v1`, zero antes de S09, componentes effective-dated e deduplicação contra ledger/forecast; nunca pós-subtrair a mesma reserva. |
| [T09 — card](../../tasks/S08-disponivel-para-gastar/009-ui-card-principal_task.md) | Mostrar `display`, cenário conservador default, `asOf`, horizonte e estado de ausência de configuração sem mascarar `raw`. |
| [T10 — breakdown UI](../../tasks/S08-disponivel-para-gastar/010-ui-breakdown-acessivel_task.md) | Mostrar os quatro componentes, mínimo, buffer, déficit e origem causal; tratar lista vazia/truncada/origem ausente com acessibilidade. |
| [T11 — testes](../../tasks/S08-disponivel-para-gastar/011-testes-unitarios-integracao_task.md) | Automatizar a matriz, precisão bigint, cenário, classes de conta, configuração ausente/efetiva, isolamento, parcelas e zero adapter. |
| [T12 — E2E](../../tasks/S08-disponivel-para-gastar/012-testes-e2e_task.md) | Verificar valor, data/horizonte, card/parcelas, zero/déficit, fallback de configuração e isolamento sem vazamento. |
| [T13 — release](../../tasks/S08-disponivel-para-gastar/013-validacao-release-handoff-s09_task.md) | Auditar `s08.v1`/`spendable.v1`, migration de configuração, evidências, redaction, gates e handoff S09. |

## Fora de escopo

Forecast ou probabilidade novos, recomendação, orçamento, metas, CRUD de
caixinhas, conta bancária separada, investimento, limite/fatura de cartão,
saldo materializado, persistência de timeline, UI final e fórmula contextual
por categoria. Essas extensões exigem contrato/ADR próprio e não podem alterar
silenciosamente `spendable.v1`.
