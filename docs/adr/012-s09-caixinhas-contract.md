# ADR-012 — Contrato de Caixinhas, fronteira e integração S09

- **Status:** Aceito
- **Data:** 2026-09-02
- **Owner:** domínio/backend do S09 — Caixinhas e movimentos
- **Escopo:** T01 do slice S09 — contrato, fronteira e gate de dependências
- **Contrato externo:** `s09.v1`, consumido pela porta do S08

## Decisão

Esta ADR fecha a semântica pública e interna de Caixinhas, a associação com
categorias, o saldo derivado, as regras de alocação, o ciclo de vida, as metas
e a fronteira com o Spendable. Nenhuma task posterior pode escolher outra
interpretação local para os pontos aqui marcados como normativos.

S09 é o proprietário de:

- aggregate e ciclo de vida de Caixinhas;
- movimentos de aporte, retirada, correção e transferência entre Caixinhas;
- associação temporal entre categoria, despesa e Caixinha;
- saldo, rollover, progresso e leitura histórica derivados;
- regras effective-dated de alocação;
- provider server-side da porta `s09.v1`.

S09 não é proprietário de:

- `FinancialEvent`/`AccountEntry` e sua autoridade de ledger, que continuam no
  S03 e nos slices financeiros que os estendem;
- compra econômica, parcelas e referências de forecast, que continuam nos
  contratos de S06/S07;
- fórmula, read model ou API pública de Spendable, que continuam no S08;
- autorização do browser, que é resolvida pelo contexto server-side do S01.

S09 não cria uma segunda fonte de ledger, forecast, saldo de conta ou
Spendable. A matriz de dependências e os gates de implementação estão em
[`docs/S09-caixinhas-contract-matrix.md`](../S09-caixinhas-contract-matrix.md).

## Precedência e resolução de conflitos

Quando documentos diferirem, a resolução é:

1. esta ADR, para as decisões específicas de S09 explicitamente fechadas
   aqui;
2. a porta publicada em
   [`src/modules/spendable/reserve-adapter.ts`](../../src/modules/spendable/reserve-adapter.ts)
   e o contrato/handoff S08 em
   [`docs/adr/011-s08-spendable-contract.md`](011-s08-spendable-contract.md),
   para compatibilidade de `s09.v1`, serialização e fórmula de Spendable;
3. a TechSpec, para arquitetura e invariantes gerais que não foram
   especializadas nesta ADR;
4. [`docs/S09-caixinhas.md`](../S09-caixinhas.md), para escopo e linguagem do
   produto;
5. o PRD, para intenção de produto e exemplos não conflitantes.

Uma alteração estrutural que contradiga esta ADR exige nova ADR e nova versão
do contrato quando a mudança alcançar a porta S08. O ordinal `ADR-012` usado
na lista histórica da TechSpec para tenancy não muda a versão publicada:
`s09.v1` e este arquivo são a referência de contrato do S09 neste repositório;
as regras de tenancy continuam as decisões de S01/TechSpec e não são
redefinidas aqui.

## Vocabulário público e interno

| Camada | Nome normativo | Regra de uso |
| --- | --- | --- |
| UI e produto | **Caixinha** | Termo exibido ao usuário; plural **Caixinhas**. |
| Módulo de domínio | `Budget` / `BudgetMovement` | Um aggregate de envelope; não é conta bancária nem saldo. |
| Persistência | `budgets`, `budget_movements`, `budget_allocation_rules` | Nomes canônicos para T03; `boxes`/`box_movements` só são aliases físicos documentados, nunca um segundo modelo. |
| Porta S08 | `ReserveBox`, `boxReferenceId` | Projeção opaca do aggregate para a reserva; não expõe o ID interno nem tenancy. |
| Regra de proteção | `BOX_BALANCE_PROTECTED` | Única regra de reserva de `s09.v1` na V1. |

Uma Caixinha não é categoria, conta, meta, orçamento mensal descartável ou
saldo persistido. Ela é uma finalidade ligada a uma categoria e cuja posição
é derivada de movimentos e efeitos financeiros elegíveis.

## Categoria e associação temporal

1. Toda Caixinha V1 tem exatamente uma `categoryId` server-validada. A
   categoria deve ser do tipo `EXPENSE`; categoria de receita não recebe
   despesa de Caixinha.
2. Uma categoria pode ter no máximo uma Caixinha vigente em cada instante. A
   restrição é temporal, não apenas uma validação de tela: os intervalos
   `[activeFrom, closedOn)` não podem se sobrepor para a mesma categoria.
3. Uma despesa em subcategoria escolhe a Caixinha ativa mais específica na
   data econômica. Se não houver Caixinha na subcategoria, sobe a hierarquia
   até a categoria ancestral ativa. Não divide uma despesa entre Caixinhas.
4. A escolha é feita por `occurredOn`/data econômica do evento, nunca pela
   data em que o usuário consulta ou edita o registro. Criar uma Caixinha
   depois da despesa não reclassifica o passado.
5. Categoria arquivada não é apagada e não fecha automaticamente a Caixinha.
   Ela deixa de aceitar nova associação e deixa de ser origem de atribuição
   automática de novas despesas/alocações. A Caixinha já existente continua
   legível e pode receber movimento explícito enquanto estiver ativa; o
   encerramento é uma operação separada.
6. Uma categoria arquivada continua válida para explicar despesas/refunds
   históricos. Uma Caixinha associada a ela mostra aviso de configuração
   arquivada, sem perder saldo, progresso ou referências.

### Ciclo de vida

O intervalo de proteção é:

```text
activeFrom <= asOf < closedOn       (closedOn nulo para vigência aberta)
```

- `activeFrom` é inclusivo. Antes dele, não há saldo protegido e nenhum
  movimento novo pode ter data anterior.
- `closedOn` é exclusivo para proteção. Na data de encerramento e depois, a
  Caixinha não reduz o Spendable global.
- O estado persistido é `ACTIVE` ou `CLOSED`; o provider mapeia a situação
  efetiva no corte para `ReserveBoxStatus`.
- Encerrar é append-only em relação ao histórico: não remove movimentos nem
  muda o saldo histórico antes do corte.
- Uma movimentação com `effectiveOn = closedOn` pode existir como registro
  histórico de fechamento/correção e entra no balanço consultado nessa data,
  mas não protege o Spendable nessa mesma data. Nenhum movimento com data
  posterior a `closedOn` pertence à Caixinha.
- Depois de fechado, um command interativo de aporte, retirada ou transferência
  falha com `BUDGET_CLOSED`. Correção/reconciliação histórica deve usar
  movimento compensatório e respeitar o intervalo; não reabre o aggregate.
- Não existe reabertura mutável na V1. Reabrir significa criar nova Caixinha,
  com nova referência opaca e `activeFrom >= closedOn` da anterior. O novo
  registro pode reutilizar categoria somente a partir do fim da vigência
  anterior.
- Editar nome, meta e data-alvo não reescreve o histórico. Mudar associação
  de categoria ou vigência exige encerrar e criar nova vigência/referência.

Consultas históricas incluem somente efeitos com data efetiva `<= asOf`. Uma
consulta antes de `activeFrom` retorna posição zero/sem proteção; uma consulta
em ou depois de `closedOn` preserva a posição final e as referências, mas
retorna proteção zero.

## Movimentos e correções

### Forma e sinal

O movimento serializável aceita apenas:

```ts
{
  referenceId: string,       // opaco, server-authorized
  boxReferenceId: string,    // opaco, validado no household
  kind: "CONTRIBUTION" | "WITHDRAWAL",
  amountCents: string,       // inteiro decimal positivo
  effectiveOn: "YYYY-MM-DD"
}
```

No domínio, `amountCents` entra como `Money`/`bigint`; na boundary continua
string. `CONTRIBUTION` aplica `+amount`; `WITHDRAWAL` aplica `-amount`. Nunca
enviar sinal negativo para representar retirada e nunca aceitar `0`.

`referenceId` é não vazio, opaco, sem caracteres de controle, com no máximo
256 caracteres, e é único dentro do household. `boxReferenceId` identifica a
Caixinha sem revelar tabela, conta ou tenant. A lista de referências efetivas
é ordenada canonicamente antes de ser publicada.

### Transferência entre Caixinhas

`TransferBetweenBudgets` é um único command atômico e gera dois movimentos:

```text
WITHDRAWAL   origem       - amount
CONTRIBUTION destino      + amount
```

As Caixinhas devem ser diferentes, pertencer ao mesmo household e aceitar a
data efetiva. Os dois `referenceId`s são únicos e carregam uma referência
opaca comum de transferência para explicação. A operação não cria
`FinancialEvent`, receita, despesa, pagamento de cartão ou alteração de conta.
O retry idêntico devolve o par original; nunca grava somente uma metade.

### Correção, refund e idempotência

- Movimento publicado é imutável: não há `UPDATE amount`, troca silenciosa de
  data, hard delete ou sobrescrita de sinal.
- `CorrectMovement` cria movimento(s) compensatório(s), vinculados ao
  `correctsReferenceId`; se necessário cria também o novo movimento correto.
  Tudo é uma transaction. A correção de uma contribuição usa retirada
  compensatória e a correção de uma retirada usa contribuição compensatória.
- Um refund é fato econômico do S03/S08, não um novo command de retirada de
  Caixinha. Quando elegível para a categoria, ele é normalizado no stream da
  Caixinha como `CONTRIBUTION` na data efetiva do crédito, mantendo a
  referência do refund e a relação com o evento original. O total de refunds
  ativos não pode exceder o valor econômico original.
- A alocação automática de uma receita realizada é materializada como
  movimentos `CONTRIBUTION` com referência derivada da receita, da vigência
  da regra e da Caixinha. Uma realização parcial ou correção posterior gera
  apenas o delta compensatório; não edita nem reprocessa silenciosamente o
  lote anterior.
- `commandId` é obrigatório, trimado, com 1–128 caracteres. A chave de
  idempotência é `(household_id, commandId)`, gravada na mesma transaction do
  efeito. O servidor compara operação e hash canônico do payload sem o
  `commandId`: retry idêntico retorna o mesmo resultado; payload/operação
  diferente falha com `COMMAND_ID_REUSED`.
- Uma referência de movimento reutilizada com dados diferentes falha com
  `DUPLICATE_REFERENCE`; referências estrangeiras se comportam como ausência
  (`BUDGET_NOT_FOUND`/`MOVEMENT_NOT_FOUND`) para não vazar tenant.

## Saldo, rollover e despesas

O stream canônico de efeitos de uma Caixinha reúne movimentos explícitos e
efeitos financeiros de categoria normalizados pelo S09. Uma despesa/refund
não cria uma segunda linha se já estiver representada por sua referência no
stream. Para `M(box, asOf)`, somente efeitos com data `<= asOf` participam:

```text
balanceCents(box, asOf)
  = Σ contribution.amountCents
  - Σ withdrawal.amountCents
```

Equivalente expandido para a explicação:

```text
  = Σ aportes explícitos e automáticos
  - Σ retiradas explícitas
  - Σ despesas de categoria elegíveis
  + Σ refunds elegíveis na data efetiva
  + Σ contribuições compensatórias
```

O saldo é signed e derivado; não existe `budgets.balance`, `boxes.balance`,
`protected_amount` ou snapshot de Spendable. Cada soma deve ser feita com
`bigint` e permanecer no limite persistível de `BIGINT`.

```text
protectedAmountCents(box, asOf)
  = activeAt(box, asOf) ? max(balanceCents, 0) : 0
```

Saldo negativo é preservado no read model/histórico e sua proteção é zero.
Ele nunca aumenta a abertura `GENERAL` nem o Spendable global.

Rollover não cria operação nova:

```text
rolloverCents(periodStart) = balanceCents(box, periodStart - 1 dia)
```

O valor positivo ou negativo atravessa o período seguinte. Aporte, retirada,
gasto bruto, refund e variação líquida do período são derivados por intervalo
fechado de datas; nenhum valor não utilizado é descartado ou convertido em
limite mensal.

### Associação de despesas

- Despesa de categoria usa a Caixinha mais específica vigente em sua data
  econômica. Sem Caixinha vigente, fica sem efeito de Caixinha, embora o
  evento continue no ledger/forecast.
- `PURCHASE` parcelada reduz uma única vez a Caixinha pelo valor econômico
  total na data da compra. Para `R$ 6.000,00`, o efeito é `-600000` centavos;
  as parcelas `60000` são somente fluxo/forecast futuro.
- Pagamento de cartão, transferência bancária e transferência entre
  Caixinhas não são despesas e não geram retirada concorrente.
- Refund integral/parcial entra pelo `effectiveOn` real do crédito, com
  referência ao evento original. Ele não reclassifica o mês original; apenas
  altera o saldo a partir da data efetiva. Refund posterior ao fechamento não
  reabre nem protege a Caixinha fechada; pode ser mostrado na relação
  histórica do evento.

## Alocação de receita realizada

### Representação escolhida

O PRD descreve percentuais; a TechSpec exige
`budget_allocation_rules.amount_cents` effective-dated. A decisão compatível
com ambos é:

- `amount_cents` é um inteiro não negativo da regra vigente, preservado no
  tempo. Ele representa o valor nominal/comprometido usado no orçamento
  mensal e no forecast; não é saldo da Caixinha e não é uma porcentagem
  armazenada.
- Para distribuição automática de uma receita realizada, os valores ativos
  são normalizados como pesos. Assim o percentual efetivo de cada Caixinha é
  `amount_cents_i / soma(amount_cents_ativos)`, mantendo a coluna exigida pela
  TechSpec e a intenção percentual do PRD.
- Pelo menos uma regra ativa deve ter `amount_cents > 0`. Regras com zero
  permanecem válidas e recebem zero. Uma regra ausente não recebe aporte.
- Regras são intervalos `[effectiveFrom, effectiveUntil)`; `effectiveUntil`
  nulo significa aberto. Uma data de receita escolhe a última versão válida
  de cada Caixinha. O conjunto efetivo é ordenado por `boxReferenceId`.

Esse compromisso torna explícita a diferença: o valor nominal continua
disponível para o orçamento/forecast, enquanto a realização do PRD é uma
distribuição proporcional que fecha exatamente no valor recebido. Não se
introduz uma segunda coluna percentual implícita nem se recalcula o passado.

### Quando ocorre e como arredonda

Somente uma receita `INCOME` efetivamente realizada/`POSTED`, com valor
positivo, pode gerar aportes automáticos. `PLANNED`/`EXPECTED` não gera
movimento de Caixinha. Uma realização que substitui item previsto do S07 usa
a mesma chave de reconciliação e não conta previsão e realização duas vezes.

Para renda `I`, regra `i` e peso `w_i`, com `W = Σw_i`:

```text
base_i       = floor(I * w_i / W)
remainder    = I - Σbase_i
contribution = base_i + 1 centavo para os primeiros `remainder`
               boxes com peso positivo na ordem canônica
```

Como `remainder < quantidade de pesos positivos`, cada centavo residual é
atribuído no máximo uma vez. A soma dos movimentos é exatamente `I`. Exemplo
com `I=1150000` e pesos `50, 20, 20, 10`:

```text
575000 + 230000 + 230000 + 115000 = 1150000 centavos
```

Se não houver regra aplicável ou a soma dos pesos positivos for zero, o
resultado é `NO_CONFIGURATION`: nenhum aporte automático é inventado, o
evento realizado permanece íntegro no ledger e a UI informa a ausência. Um
aporte manual ainda exige command explícito.

### Passado, presente e futuro

| Momento | Regra |
| --- | --- |
| Passado já realizado | Usa a versão efetiva na data da receita; alteração posterior não reprocessa. |
| Presente realizado | Materializa um lote idempotente de contribuições; retry ou reconciliação retorna o lote existente. |
| Futuro | Nova regra começa em `effectiveFrom`; forecast só usa aporte comprometido, não aporte sugerido. |
| Sem configuração | Nenhuma distribuição automática; ausência explícita, sem percentual default. |
| Categoria arquivada | Não recebe nova distribuição automática; lotes históricos permanecem. |

Uma alteração de regras é uma nova versão, não um update histórico. Se várias
regras forem trocadas na mesma data, T04/T07 deve gravá-las atomicamente para
que o conjunto observado por uma receita seja coerente.

## Metas, progresso e aporte sugerido

Meta é finalidade da Caixinha, não uma carteira de dinheiro separada. V1 pode
representá-la como metadados do aggregate ou relação `financial_goals`, desde
que haja uma única fonte de progresso: o saldo derivado da Caixinha. Não se
cria `goal_contributions` concorrente para repetir os mesmos movimentos.

Quando configurada, a meta tem `targetAmountCents > 0` e `targetDate` válida;
os dois campos são aceitos juntos ou a meta fica ausente. `targetDate` não
pode preceder `activeFrom`. O read model expõe:

```text
progressCents = clamp(balanceCents, 0, targetAmountCents)
remainingCents = max(targetAmountCents - balanceCents, 0)
progressBps    = floor(progressCents * 10000 / targetAmountCents)
```

O saldo signed continua exposto separadamente; se for negativo, o progresso é
zero e o faltante cresce para incluir o déficit. `ACHIEVED` é estado derivado
quando `balanceCents >= targetAmountCents`; `COMPLETED` continua sendo uma
decisão explícita do usuário.

Para data-alvo futura, `remainingMonths` é o número de meses civis após o mês
de `asOf` até o mês da meta, inclusive, com mínimo de 1. O aporte sugerido é:

```text
suggestedMonthlyCents = ceil(remainingCents / remainingMonths)
```

Se a data-alvo já passou, o valor sugerido é o faltante integral como aporte
imediato. O cálculo usa divisão inteira/ceil em `bigint`; não cria movimento,
não entra no forecast e não vira compromisso sem command explícito. `ON_TRACK`
ou `BEHIND` é derivado comparando o saldo com o progresso linear esperado até
a data-alvo; sem data-alvo, o status de ritmo é `NOT_APPLICABLE`.

## Contrato `s09.v1` e porta S08

### Contexto aceito

O provider implementa a porta já publicada, sem alterar `s08.v1` ou
`spendable.v1`:

```ts
interface ReserveAdapterContext {
  asOf: string | Temporal.PlainDate;
  scenario: "CONSERVATIVE" | "EXPECTED";
  horizon: { days: number }; // inteiro 1..3660
  reflectedReferenceIds?: readonly string[];
  alreadyReflectedReferenceIds?: readonly string[];
}
```

O alias `alreadyReflectedReferenceIds` é aceito pela porta atual. As duas
listas são normalizadas, deduplicadas e ordenadas. A porta não recebe
`householdId`, `userId`, `accountId`, lista de contas, saldo, timeline,
`spendability`, buffer, status, autorização, nomes ou qualquer seleção de
fonte do browser. O `FinancialContext`/household é resolvido pelo servidor
antes de invocar o provider.

### Snapshot de domínio

O domínio do provider devolve `contractVersion: "s09.v1"`, `status`,
`protectedAmount`, `appliedOpeningAdjustment`, componentes e balanços por
Caixinha. `Money`/`bigint` e `Temporal.PlainDate` não atravessam a boundary.

Para cada Caixinha ativa no corte:

```text
balance       = Σ(CONTRIBUTION) - Σ(WITHDRAWAL), effectiveOn <= asOf
protected    = max(balance, 0)
unreflected  = Σ efeito(movement.referenceId não refletido)
applied      = -unreflected
```

`applied` só é aplicado quando a Caixinha está ativa e o saldo é positivo;
caso contrário é zero. Uma contribuição não refletida produz ajuste negativo;
uma retirada não refletida produz ajuste positivo. O saldo negativo continua
em `boxes`, mas não cria componente nem ajuste positivo artificial.

O snapshot serializável preserva a forma pública de S08:

```ts
{
  contractVersion: "s09.v1",
  status: "UNAVAILABLE" | "AVAILABLE",
  protectedCents: string,
  appliedOpeningAdjustmentCents: string,
  components: readonly {
    kind: "BOX_BALANCE";
    rule: "BOX_BALANCE_PROTECTED";
    referenceId: string;       // referência opaca da Caixinha
    boxReferenceId: string;
    amountCents: string;       // proteção positiva
    appliedAmountCents: string; // ajuste signed
    effectiveOn: string;
    movementReferenceIds: readonly string[];
    appliedMovementReferenceIds: readonly string[];
  }[]
}
```

`ZeroReserveAdapter` devolve explicitamente `UNAVAILABLE`, os dois centavos
`"0"` e `components=[]`. Uma fonte S09 disponível sem Caixinhas devolve
`AVAILABLE`, proteção/ajuste zero e componentes vazios. Falha técnica do
provider não pode ser mascarada como `AVAILABLE`/zero.

S08 incorpora `appliedOpeningAdjustmentCents` antes de calcular o mínimo:

```text
openingProjected = openingBalance
                + openingAdjustmentsS07
                + appliedOpeningAdjustmentS09
minimumProjected = min(openingProjected, fechamentos diários)
rawSpendable     = minimumProjected - operationalBuffer
displaySpendable = max(rawSpendable, 0)
```

Não se subtrai `protectedCents` novamente. Uma referência de contribuição,
retirada, despesa, refund ou correção já presente em `POSTED`/forecast deve
entrar em `reflectedReferenceIds`; ela permanece explicável no saldo, mas não
gera ajuste pela segunda vez. A deduplicação é por referência exata, nunca
por valor/data aproximados. Recursos `RESTRICTED` e `EXCLUDED` continuam fora
da abertura `GENERAL`, sob responsabilidade do S08.

## Limites e erros esperados

Limites normativos:

| Campo | Limite |
| --- | --- |
| `amountCents` de movimento/meta/regra | Movimento/meta: `1..9223372036854775807`; regra pode ser `0..9223372036854775807`, com pelo menos um peso positivo no conjunto. |
| Soma persistida | Deve caber em `BIGINT`; overflow falha fechado com `AMOUNT_OUT_OF_RANGE`. |
| `commandId` | 1–128 caracteres após trim. |
| referência opaca | 1–256 caracteres, sem controle/formatação. |
| nome | 1–120 caracteres normalizados, sem controle. |
| data | `YYYY-MM-DD` válida, `Temporal.PlainDate`; intervalos fechados rejeitam `closedOn < activeFrom` e `effectiveUntil <= effectiveFrom`. |
| horizon da porta | Inteiro 1–3.660, conforme S08; não é truncado silenciosamente. |
| histórico paginado | T05 usa limite positivo bounded e cursor opaco; o limite da página nunca altera os totais derivados. |

Erros de domínio estáveis, independentes de mensagens SQL:

| Código | Situação | HTTP/resultado esperado |
| --- | --- | --- |
| `UNAUTHENTICATED` / `FINANCIAL_CONTEXT_REQUIRED` | sessão/contexto ausente | 401 |
| `INVALID_COMMAND`, `INVALID_COMMAND_ID`, `INVALID_NAME`, `INVALID_AMOUNT`, `AMOUNT_OUT_OF_RANGE`, `INVALID_DATE`, `INVALID_DATE_RANGE`, `INVALID_REFERENCE` | boundary ou invariant de valor/data/ref | 400 |
| `BUDGET_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `MOVEMENT_NOT_FOUND` | recurso ausente ou de outro household | 404 opaco |
| `CATEGORY_ARCHIVED`, `CATEGORY_KIND_MISMATCH`, `BUDGET_CLOSED`, `BUDGET_NOT_ACTIVE_AT_DATE` | estado não permite a operação | 409 |
| `CATEGORY_ACTIVE_BUDGET_CONFLICT`, `ALLOCATION_OVERLAP`, `ALLOCATION_NO_POSITIVE_WEIGHT`, `DUPLICATE_REFERENCE`, `COMMAND_ID_REUSED`, `MOVEMENT_ALREADY_CORRECTED`, `TRANSFER_SAME_BUDGET`, `REFUND_EXCEEDS_ORIGINAL` | conflito de integridade/idempotência | 409 |
| `PROVIDER_UNAVAILABLE`, `CONTRACT_VERSION_MISMATCH`, `QUERY_FAILED` | falha técnica/contrato no servidor | erro opaco; nunca resultado zero enganoso |

Exceções técnicas são observáveis somente com contexto operacional agregado;
o caller recebe `Result`/erro público sem SQL, payload, nomes, centavos,
tokens, cookies, referências ou saldo de outro tenant.

## Commands e ownership

| Operação | Input público mínimo | Efeito/owner |
| --- | --- | --- |
| `CreateBudget` | `commandId`, `name`, `categoryId`, `activeFrom`, meta opcional | cria aggregate; server valida category/household; T06 |
| `UpdateBudget` | `commandId`, `budgetReferenceId`, metadados | não muda categoria/vigência histórica; T06 |
| `CloseBudget` | `commandId`, `budgetReferenceId`, `closedOn` | fecha efetivamente, sem apagar; T06 |
| `RegisterContribution` | `commandId`, `budgetReferenceId`, `amountCents`, `effectiveOn` | movimento +; T07 |
| `RegisterWithdrawal` | `commandId`, `budgetReferenceId`, `amountCents`, `effectiveOn` | movimento −, saldo negativo permitido; T07 |
| `TransferBetweenBudgets` | `commandId`, origem, destino, `amountCents`, `effectiveOn` | par atômico −/+; T07 |
| `CorrectMovement` | `commandId`, referência do movimento e correção | compensação append-only; T07 |
| `ReplaceAllocationRules` | `commandId`, `effectiveFrom`, regras `budgetReferenceId`/`amountCents` | nova versão atomicamente; T04/T07 |
| `ListBudget`/`GetBudget` | filtro de status, `asOf`, período, cursor opcional | read server-side tenant-safe; T05 |
| realização/refund | referência do FinancialEvent/ForecastItem | owner S03/S07 para o fato; S09 apenas normaliza o efeito, sem duplicar command |

Nenhum desses inputs aceita `householdId`, `userId`, saldo, status final,
autorização, timeline ou conta como autoridade do browser. IDs enviados para
selecionar uma Caixinha ou categoria são apenas candidatos; o servidor os
revalida no `FinancialContext` atual.

## Consequências e gates

- T02/T04 podem implementar regras puras conforme esta ADR.
- T03 deve criar constraints temporais, compostas, de unicidade e `BIGINT`,
  sem coluna de saldo ou snapshot.
- T05/T06/T07 devem reutilizar as mesmas referências, idempotência e contexto;
  não podem recalcular ou persistir uma segunda posição.
- T08 deve plugar o provider na porta existente sem alterar `SpendableEngine`.
- T09/T10–T15 devem tratar os erros, estados, testes e evidências da matriz.
- Os gates downstream continuam abertos até haver evidência da task
  correspondente. Esta ADR não declara schema, domínio executável, use case,
  UI, testes PostgreSQL/E2E ou integração vertical concluídos.

