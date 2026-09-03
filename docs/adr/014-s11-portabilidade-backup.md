# ADR-014 — Contrato de portabilidade, backup e operação confiável (`s11.v1`)

- **Status:** Aceito
- **Data:** 2026-09-03
- **Escopo:** T01 do slice S11 — Portabilidade, backup e operação confiável
- **Contrato externo:** `s11.v1`
- **Dependências:** S01–S09 publicados no repositório; S10 ainda não iniciado
  (não persiste dataset novo)

## Decisão

Esta ADR fecha o contrato versionado `s11.v1` da exportação, o dialeto CSV, a
lista de dados proibidos, a tenancy da portabilidade, a política mínima de
retenção/restauração da V1, o que conta como job recorrente relevante e a
fronteira entre backup nativo e backup adicional.

Nenhuma task posterior (T02–T16) pode escolher outra interpretação local para
os pontos marcados como normativos aqui. T02 decide, com evidência, se o backup
lógico externo e um orquestrador durável entram na V1; essa decisão é
registrada nesta ADR, não em código de domínio.

S11 é o proprietário de:

- exportação autenticada dos datasets persistidos de S02–S09;
- serialização CSV determinística;
- runtime mínimo de jobs recorrentes (idempotência, retry, estado observável);
- observabilidade da exportação e dos jobs;
- UI de portabilidade em Settings;
- política e runbook de backup/restauração da V1.

S11 não é proprietário de:

- fórmula financeira, saldo derivado, Spendable, forecast gerado ou visão
  consolidada do S10;
- pipeline de importação (S04 continua sendo a única ingestão CSV);
- identidade, sessão, OAuth ou membros do espaço financeiro;
- escolha de provedor de nuvem como regra de domínio (TechSpec §4).

## Precedência e resolução de conflitos

Quando documentos diferirem, a resolução é:

1. esta ADR, para as decisões específicas de S11 fechadas aqui;
2. [`docs/S11-operacao-confiavel.md`](../S11-operacao-confiavel.md) e a
   [`matriz de contrato`](../S11-operacao-confiavel-contract-matrix.md);
3. a TechSpec, para arquitetura e invariantes gerais (§4, §5, §72–73, §95,
   §98, §102–104, §112–114, §116);
4. o PRD, para intenção de produto (§24–28), interpretado à luz desta ADR.

Uma alteração estrutural que contradiga esta ADR exige nova ADR e, se alcançar
a forma do arquivo exportado, uma nova versão do contrato (`s11.v2`).

## Fronteira normativa

**O S11 exporta, protege e diagnostica; ele não recalcula fórmula financeira
nem cria número novo.** Toda linha exportada vem de um dado já persistido ou
de uma leitura já existente de S02–S09. Nenhum saldo, proteção de Caixinha,
Spendable, item virtual de forecast ou agregado de dashboard nasce nesta
exportação.

Dinheiro trafega em centavos (`bigint`/`Money`) e é serializado como string de
inteiro. Datas civis usam `Temporal.PlainDate` → ISO `YYYY-MM-DD`. IDs de
domínio usam UUIDv7 já persistidos. O browser nunca fornece `householdId`,
`userId` nem autoridade de tenancy.

A portabilidade é funcionalidade de usuário e vive em Settings. Backup e
restauração são operação e vivem em runbook, não em tela.

## Contrato `s11.v1`

```ts
export const S11_CONTRACT_VERSION = "s11.v1" as const;
```

A exportação completa da V1 é um único pacote ZIP, nome estável sem dado do
usuário:

```text
financas-gomes-export-s11v1.zip
```

O ZIP contém exatamente:

1. `manifest.json` — metadados do contrato, nunca conteúdo de linha;
2. um arquivo CSV por dataset **disponível**, com o nome fechado abaixo;
3. nenhum CSV para dataset **indisponível** (gate externo). O manifesto declara
   a ausência; a exportação não entrega arquivo vazio como se o dataset
   estivesse completo.

Um único dataset, sem ZIP, só é permitido se a lista efetiva tiver exatamente
um CSV disponível. Na V1 a lista contratada tem vários datasets; o caminho
feliz é sempre o ZIP.

### Manifesto

```ts
interface S11ExportManifest {
  contractVersion: "s11.v1";
  generatedAt: string; // ISO-8601 UTC com milissegundos, sufixo Z
  datasetCount: number; // datasets tentados (disponíveis + indisponíveis)
  availableCount: number;
  unavailableCount: number;
  rowCountTotal: number; // soma apenas dos disponíveis
  byteCountTotal: number; // bytes UTF-8 dos CSVs, sem o manifesto
  filtersApplied: S11TransactionFilters | null;
  datasets: S11ManifestDataset[];
}

type S11DatasetAvailability = "AVAILABLE" | "UNAVAILABLE_EXTERNAL_GATE";

interface S11ManifestDataset {
  id: S11DatasetId;
  fileName: string | null; // null quando UNAVAILABLE_EXTERNAL_GATE
  availability: S11DatasetAvailability;
  unavailableReason?: S11UnavailableReason;
  rowCount: number; // 0 quando vazio ou indisponível
  byteCount: number; // 0 quando indisponível
  sort: string; // chave de ordenação declarada
}

type S11UnavailableReason =
  | "SLICE_NOT_PUBLISHED"
  | "READING_NOT_READY";
```

`generatedAt` é o único campo intencionalmente não determinístico do pacote.
A estabilidade byte a byte exigida pelo slice aplica-se a cada CSV e a todos
os campos do manifesto **exceto** `generatedAt`. Testes de determinismo
comparam os CSVs e o manifesto com `generatedAt` mascarado.

O manifesto **não** contém: nome do espaço, e-mail, `householdId`, `userId`,
caminho de arquivo absoluto, URL, SQL, DSN, token, nome de membro.

## Dialeto CSV (único, T03)

Normativo para todos os datasets. Nenhuma task posterior escolhe aspas,
escape, encoding, dinheiro ou data.

| Aspecto | Valor fechado |
| --- | --- |
| Encoding | UTF-8 sem BOM |
| Separador | vírgula `,` (U+002C) |
| Quebra de linha | LF (`\n`, U+000A) entre registros; o arquivo termina com LF |
| Cabeçalho | obrigatório; primeira linha; nomes exatamente iguais às colunas desta ADR, nesta ordem |
| Aspas | RFC 4180: campo é envolvido por `"` quando contém separador, aspas, LF, CR ou o marcador de neutralização |
| Escape de aspas | `"` interno vira `""` |
| Nulo / vazio | campo vazio (zero caracteres). Nunca as strings `null`, `undefined`, `NaN` |
| Booleano | `true` / `false` em minúsculas |
| Inteiro não monetário | dígitos decimais, opcionalmente prefixados por `-` |
| Dinheiro | string de centavos em inteiro decimal, sem ponto, sem vírgula de milhar, sem símbolo, sem arredondamento. Zero é `0`. Negativo é `-` seguido dos dígitos (`-1500` = −R$ 15,00) |
| Data civil | `YYYY-MM-DD` derivado de `Temporal.PlainDate` / coluna `date` ISO. Sem fuso |
| Instante | ISO-8601 UTC com milissegundos e sufixo `Z`, a partir do `Date` persistido |
| UUID | canônico minúsculo com hífens |
| Enum | o literal persistido (`ACTIVE`, `EXPENSE`, …), sem tradução |
| Neutralização de fórmula | se, após serializar o valor, o texto começa com `=`, `+`, `-`, `@`, TAB (U+0009) ou CR (U+000D), prefixar exatamente um apóstrofo `'` (U+0027) e aspas o campo. O apóstrofo **não** faz parte do valor de domínio: o leitor do dialeto `s11.v1` remove no máximo um `'` inicial. Isso preserva centavos negativos (`-1500` → `'-1500` no CSV; valor semântico `-1500`) |
| Ordem das linhas | total e determinística: a chave de cada dataset abaixo, sempre com desempate pelo `id` crescente |
| Streaming | o encoder emite cabeçalho e depois uma linha por registro, sem materializar o arquivo inteiro |

O encoder é puro: sem banco, sessão, `Date.now()`, `Math.random()` ou
ambiente. Relógio só entra em `generatedAt` no empacotador (T07).

Exemplo de linha (dataset `accounts`, trecho):

```csv
id,name,type,status,spendability,liquidity,includeInNetWorth,trackingStartedOn,createdAt,updatedAt
018f1a2b-0000-7000-8000-000000000001,Conta corrente,CHECKING,ACTIVE,GENERAL,IMMEDIATE,true,2026-01-01,2026-01-01T12:00:00.000Z,2026-01-01T12:00:00.000Z
```

Exemplo de fórmula neutralizada:

```csv
id,description,amountCents
018f1a2b-0000-7000-8000-000000000002,"'=1+1",'-1500
```

Valores de domínio após o parser `s11.v1`: `description = "=1+1"`,
`amountCents = "-1500"`.

## Datasets da V1

Cada dataset tem dono, justificativa, arquivo, colunas na ordem obrigatória,
chave de reconciliação e ordenação. `household_id` **nunca** é coluna
exportada: o recorte já foi aplicado no servidor.

Colunas técnicas internas (`payloadHash` de command, DSN, token) não existem
nestas tabelas de domínio; a lista de proibição abaixo cobre o que restar.

### Incluídos

| id | Arquivo | Dono | Justificativa | Ordenação | Reconciliação |
| --- | --- | --- | --- | --- | --- |
| `accounts` | `accounts.csv` | S02 | catálogo de contas para reconstruir o espaço | `name` ASC, `id` ASC | `id` |
| `categories` | `categories.csv` | S02 | árvore de categorias | `kind` ASC, `name` ASC, `id` ASC | `id` |
| `financial_events` | `financial_events.csv` | S03 | fatos econômicos (lançamentos) | `occurredOn` ASC, `id` ASC | `id` |
| `account_entries` | `account_entries.csv` | S03 | linhas de ledger para reconciliar saldos | `postedOn` NULLS LAST, `expectedOn` NULLS LAST, `id` ASC | `id` |
| `credit_cards` | `credit_cards.csv` | S06 | configuração de cartão (limite, conta) | `id` ASC | `id` |
| `credit_card_billing_rules` | `credit_card_billing_rules.csv` | S06 | regras de fechamento/vencimento | `cardId` ASC, `effectiveFrom` ASC, `id` ASC | `id` |
| `credit_card_purchases` | `credit_card_purchases.csv` | S06 | vínculo compra ↔ evento ↔ plano | `id` ASC | `id` |
| `installment_plans` | `installment_plans.csv` | S06 | plano da compra | `id` ASC | `id` |
| `installments` | `installments.csv` | S06 | parcelas materializadas (não recalcular) | `planId` ASC, `sequence` ASC, `id` ASC | `id` |
| `recurring_rules` | `recurring_rules.csv` | S07 | compromissos recorrentes persistidos | `startOn` ASC, `id` ASC | `id` |
| `recurring_occurrences` | `recurring_occurrences.csv` | S07 | exceções/realizações persistidas (não ocorrências virtuais) | `recurringRuleId` ASC, `occurrenceKey` ASC, `id` ASC | `id` |
| `planned_events` | `planned_events.csv` | S07 | compromissos avulsos persistidos | `expectedOn` ASC, `id` ASC | `id` |
| `holidays` | `holidays.csv` | S07 | calendário de feriados do espaço | `date` ASC, `id` ASC | `id` |
| `spendable_settings` | `spendable_settings.csv` | S08 | reserva operacional configurada (não o Spendable calculado) | `effectiveFrom` ASC, `id` ASC | `id` |
| `budgets` | `budgets.csv` | S09 | Caixinhas | `name` ASC, `id` ASC | `id` (interno) e `referenceId` (porta) |
| `budget_movements` | `budget_movements.csv` | S09 | movimentos persistidos da Caixinha | `effectiveOn` ASC, `id` ASC | `id` e `referenceId` |
| `budget_allocation_rules` | `budget_allocation_rules.csv` | S09 | pesos nominais effective-dated | `budgetId` ASC, `effectiveFrom` ASC, `id` ASC | `id` |

### Colunas por dataset

Tipos: `uuid`, `text`, `enum`, `money` (string de centavos), `date`,
`instant`, `bool`, `int`.

**accounts:** `id`(uuid), `name`(text), `type`(enum), `status`(enum),
`spendability`(enum), `liquidity`(enum), `includeInNetWorth`(bool),
`trackingStartedOn`(date\|vazio), `createdAt`(instant), `updatedAt`(instant).

**categories:** `id`(uuid), `name`(text), `parentId`(uuid\|vazio),
`kind`(enum), `status`(enum), `createdAt`(instant), `updatedAt`(instant).

**financial_events:** `id`(uuid), `kind`(enum), `status`(enum), `origin`(enum),
`amountCents`(money), `occurredOn`(date), `description`(text),
`categoryId`(uuid\|vazio), `reversalOfEventId`(uuid\|vazio),
`createdAt`(instant), `updatedAt`(instant).

**account_entries:** `id`(uuid), `financialEventId`(uuid),
`installmentId`(uuid\|vazio), `accountId`(uuid), `amountCents`(money),
`status`(enum), `expectedOn`(date\|vazio), `postedOn`(date\|vazio),
`createdAt`(instant).

**credit_cards:** `id`(uuid), `accountId`(uuid), `creditLimitCents`(money),
`defaultPaymentAccountId`(uuid\|vazio), `createdAt`(instant),
`updatedAt`(instant).

**credit_card_billing_rules:** `id`(uuid), `cardId`(uuid), `closingDay`(int),
`dueDay`(int), `effectiveFrom`(date), `effectiveUntil`(date\|vazio),
`createdAt`(instant).

**credit_card_purchases:** `id`(uuid), `cardId`(uuid), `financialEventId`(uuid),
`installmentPlanId`(uuid), `createdAt`(instant), `updatedAt`(instant).

**installment_plans:** `id`(uuid), `purchaseId`(uuid),
`totalAmountCents`(money), `installmentCount`(int), `createdAt`(instant).

**installments:** `id`(uuid), `planId`(uuid), `purchaseId`(uuid),
`sequence`(int), `amountCents`(money), `status`(enum), `billingRuleId`(uuid),
`billingCycle`(date), `billingClosingDay`(int), `billingDueDay`(int),
`billingClosingOn`(date), `billingDueOn`(date),
`billingDueOnOverride`(date\|vazio), `createdAt`(instant).

**recurring_rules:** `id`(uuid), `accountId`(uuid\|vazio),
`categoryId`(uuid\|vazio), `kind`(enum), `amountCents`(money),
`description`(text), `frequency`(enum), `dayRule`(enum),
`dayOfMonth`(int\|vazio), `startOn`(date), `endOn`(date\|vazio),
`includeInConservativeForecast`(bool), `createdAt`(instant),
`updatedAt`(instant).

**recurring_occurrences:** `id`(uuid), `recurringRuleId`(uuid),
`occurrenceKey`(text), `status`(enum), `amountCents`(money\|vazio),
`expectedOn`(date\|vazio), `financialEventId`(uuid\|vazio),
`isPartial`(bool), `createdAt`(instant), `updatedAt`(instant).

**planned_events:** `id`(uuid), `accountId`(uuid\|vazio),
`categoryId`(uuid\|vazio), `kind`(enum), `status`(enum),
`amountCents`(money), `expectedOn`(date), `description`(text),
`includeInConservativeForecast`(bool), `financialEventId`(uuid\|vazio),
`isPartial`(bool), `createdAt`(instant), `updatedAt`(instant).

**holidays:** `id`(uuid), `date`(date), `name`(text), `createdAt`(instant),
`updatedAt`(instant).

**spendable_settings:** `id`(uuid), `effectiveFrom`(date),
`operationalBufferCents`(money), `createdAt`(instant).

**budgets:** `id`(uuid), `referenceId`(text), `categoryId`(uuid), `name`(text),
`status`(enum), `activeFrom`(date), `closedOn`(date\|vazio),
`targetAmountCents`(money\|vazio), `targetDate`(date\|vazio),
`createdAt`(instant), `updatedAt`(instant).

**budget_movements:** `id`(uuid), `budgetId`(uuid), `referenceId`(text),
`kind`(enum), `amountCents`(money), `effectiveOn`(date), `sourceKind`(enum),
`sourceReferenceId`(text\|vazio), `financialEventId`(uuid\|vazio),
`accountEntryId`(uuid\|vazio), `correctsMovementId`(uuid\|vazio),
`transferReferenceId`(text\|vazio), `createdAt`(instant).

**budget_allocation_rules:** `id`(uuid), `budgetId`(uuid),
`amountCents`(money), `effectiveFrom`(date), `effectiveUntil`(date\|vazio),
`createdAt`(instant).

Nenhum dataset inclui saldo derivado, rollover, Spendable, proteção de
Caixinha, item virtual de forecast ou agregado S10.

### Excluídos (não entram por simetria de tabela)

| Origem | Motivo |
| --- | --- |
| `user`, `session`, `account` (Better Auth), `verification` | identidade e segredos |
| `households`, `household_members`, `household_invites` | tenancy e PII (e-mail/nome de membros). A V1 não exporta membros |
| `protected_resources` | autorização interna |
| `application_commands` | idempotência técnica, sem valor de portabilidade |
| `transaction_imports`, `transaction_import_staging`, `transaction_import_items` | pipeline de ingestão; o fato canônico já está em `financial_events` |
| Timeline S07 gerada, Spendable S08 calculado, dashboard S10 | leituras derivadas; S11 não reinterpreta |

E-mail e nome de membros **não** são exportados. Nome de conta, categoria,
Caixinha, feriado e descrição de lançamento **são** dados do espaço financeiro
e entram nos CSVs correspondentes — nunca em log, manifesto ou evento.

## Tenancy

A exportação usa exclusivamente o espaço financeiro resolvido por
`requireFinancialContext()` no servidor. O contrato de entrada **rejeita**
qualquer campo `householdId`, `userId`, `tenantId` ou equivalente vindo do
browser ou de query string.

IDs exportados são os IDs do próprio espaço. Um ID copiado de outro espaço,
passado como filtro, é ausência: o dataset não devolve a linha estrangeira e
não revela se o ID existe.

Filtros aceitos (opcionais; omitidos = exportação completa do espaço):

```ts
interface S11TransactionFilters {
  from?: string; // PlainDate ISO, inclusive
  to?: string;   // PlainDate ISO, inclusive
  accountId?: string;
  categoryId?: string | null; // null = sem categoria
  kind?: "EXPENSE" | "INCOME" | "REVERSAL" | "PURCHASE" | "TRANSFER";
  status?: "PLANNED" | "EXPECTED" | "PENDING" | "POSTED" | "CANCELLED" | "ALL";
}
```

Semântica alinhada a `ListManualTransactionsQuery` / tela `/transactions`
(TechSpec §98). Os aliases de data da tela são normalizados no servidor para
`from`/`to`; o browser da portabilidade em Settings **não** envia filtro na
ação única (exportação completa). Quando filtros são informados (superfície
autenticada de T07), eles se aplicam **somente** a `financial_events` e
`account_entries` (entries cujo evento passou no filtro). Os demais datasets
permanecem completos.

Filtro que resulta em zero linhas: CSV com cabeçalho, zero registros,
`rowCount: 0`, `availability: "AVAILABLE"`. Isso **não** é erro e **não** é
dataset indisponível.

## Datasets indisponíveis por gate externo

Se a leitura de um dataset da lista não existir no código publicado, o
manifesto marca `UNAVAILABLE_EXTERNAL_GATE` e o ZIP omite o CSV. É proibido
entregar CSV só com cabeçalho fingindo completeza e é proibido inventar
colunas ou valores derivados para compensar o slice ausente.

Estado em 2026-09-03:

| Dataset | Estado | Origem |
| --- | --- | --- |
| S02–S09 listados acima | persistidos e exportáveis | commits de S02–S09 em `main` |
| Qualquer agregado S10 | não é dataset `s11.v1` | S10 não persiste tabela nova; slice ainda não iniciado |
| Gates S09 citados no plano original de tasks (T04/T07/T08/T11–T15) | superados pelo merge de S09 em `main` | `2c4384a` |

Se um dataset S09 deixar de ser legível por regressão, T06 marca
`UNAVAILABLE_EXTERNAL_GATE` em vez de falhar a exportação inteira — salvo se
a leitura quebrar por erro interno, que é falha opaca de T07.

## Dados proibidos (lista fechada, verificável por teste)

Nenhum dos itens abaixo pode aparecer em CSV, manifesto, nome de arquivo,
header HTTP de download, mensagem de erro ao usuário, log, breadcrumb ou
evento Sentry:

1. token, cookie, header `Authorization`, secret, DSN, URL de banco, chave de
   storage, senha, hash de senha, `BETTER_AUTH_SECRET`, client secret OAuth;
2. `householdId` / `userId` / e-mail / nome de pessoa (membro);
3. SQL, payload bruto, stack com mensagem de driver;
4. caminho absoluto de arquivo, identificador de projeto de provedor;
5. valores monetários, descrições, nomes de conta/categoria/Caixinha **em
   logs e eventos** (eles são permitidos só no CSV de domínio);
6. qualquer coluna de `session`, `verification`, `account` (Better Auth).

O teste de redaction de T04/T14 falha ao encontrar qualquer um desses
padrões no transporte de observabilidade.

## Limites operacionais

| Limite | Valor | Comportamento ao estourar |
| --- | --- | --- |
| Tempo máximo de geração | 25 s de wall-clock no servidor | erro contratado `EXPORT_TIMEOUT`; nada truncado |
| Tamanho máximo do ZIP | 50 MiB | erro `EXPORT_TOO_LARGE`; nada truncado |
| Dataset lento (observabilidade) | duração > 2_000 ms | evento `export.dataset` com outcome de lentidão; exportação continua |
| Exportação lenta | duração total > 5_000 ms | evento `export.request` marcado lento |
| Concorrência | 1 exportação em andamento por espaço | a segunda é recusada com `EXPORT_IN_PROGRESS` |
| Frequência | 1 exportação concluída a cada 60 s por espaço | recusa `EXPORT_RATE_LIMITED` |
| Página de leitura | 500 linhas | streaming; nunca carregar o dataset inteiro em um array |

Volume representativo para T14/T15: 10_000 `financial_events` e 20_000
`account_entries` sintéticos no espaço de fixture.

Erros devolvidos ao usuário são opacos: código estável + mensagem em
português + `correlationId` opaco. Nunca mensagem de PostgreSQL, caminho ou
provedor.

Códigos estáveis: `UNAUTHENTICATED`, `EXPORT_IN_PROGRESS`,
`EXPORT_RATE_LIMITED`, `EXPORT_TIMEOUT`, `EXPORT_TOO_LARGE`,
`EXPORT_UNAVAILABLE`, `EXPORT_FAILED`.

A exportação não grava evento financeiro, não altera ledger e não cria
command em `application_commands`. O único efeito colateral permitido é
registro operacional de observabilidade e o controle de concorrência/frequência
em memória de processo (ou tabela de job, se T08 for reutilizada), sem payload
financeiro.

## Política mínima de retenção e restauração (V1)

Alvos conservadores da V1, a confrontar com a capacidade nativa em T02:

| Métrica | Alvo V1 | O que conta como sucesso |
| --- | --- | --- |
| Retenção | ≥ 7 dias de histórico restaurável | um ponto no tempo dentro da janela pode ser reconstruído |
| RPO | ≤ 24 h (alvo desejável: contínuo se o PITR nativo cobrir) | perda máxima aceita entre o último ponto restaurável e a falha |
| RTO | ≤ 4 h em horário comercial | espaço financeiro responde em `/api/readiness` e uma checagem sintética reconcilia |
| Restauração bem-sucedida | migrations aplicadas, `db:check` ok, readiness 200, fixture conhecida reconcilia totais | sem inspecionar household real |

Backup e restauração **não** aparecem na UI. O procedimento vive no runbook
(T13). Nenhum dado de produção é baixado para desenvolvimento (TechSpec §112).

A TechSpec §113 coloca `pg_dump → R2/S3` no backlog e define a V1 como
`Neon recovery/PITR + exportação CSV manual`. T02 só implementa backup
externo se a auditoria demonstrar lacuna concreta contra esta política. Sem
lacuna, T09 registra formalmente a não implementação.

## Jobs recorrentes relevantes

A V1 **não** adota orquestrador de workflows duráveis (o "Temporal" da stack
é o polyfill de datas; TechSpec §104 rejeita infraestrutura preventiva). T02
confirma ou reabre essa decisão.

Job recorrente relevante, para este slice, é qualquer execução automática
que:

1. precise ser segura sob retry (repetir não duplica efeito);
2. deixe estado consultável de sucesso/falha;
3. ao falhar, chegue ao Sentry.

Na V1 isso inclui:

- o job de backup lógico externo, **somente** se T02 escolher o caminho A;
- o runtime genérico de T08, exercitado por um job operacional
  `s11.job.heartbeat` (efeito: gravar/atualizar a linha de execução; sem
  payload financeiro). Esse job existe para tornar falha detectável mesmo
  quando o backup nativo não corre na aplicação.

Chave de idempotência: `(jobName, logicalWindow)` onde `logicalWindow` é o
dia civil UTC `YYYY-MM-DD` para jobs diários. Tentativas são o campo
`attempt` da mesma execução lógica, correlacionadas por um `executionId`
opaco. O padrão de `application_commands` (TechSpec §72) **não** se aplica
diretamente: commands são por household e use case de usuário; jobs
operacionais são do processo. T08 cria registro próprio, sem copiar payload
financeiro, e documenta essa divergência.

Estado observável mínimo por execução: `jobName`, `logicalWindow`,
`executionId`, `attempt`, `status` (`RUNNING` \| `SUCCEEDED` \| `FAILED` \|
`SKIPPED_IDEMPOTENT`), `startedAt`, `finishedAt`, `errorCode` opaco,
`correlationId`. Sem centavos, nomes, SQL ou segredo.

Retry: falha transitória (rede, 5xx de storage, lock) até 3 tentativas com
backoff 1 s, 4 s, 16 s. Falha determinística (credencial inválida, input
impossível) encerra na primeira vez com `FAILED`.

O agendador (GitHub Actions cron, cron do host, ou equivalente) **chama** o
job; o job não importa o agendador.

## Settings / navegação

A portabilidade vive em `/settings/data`, item **Dados** no grupo
Configurações já existente no `AuthenticatedShell`, ao lado de Categorias.
Não cria item na navegação principal. Textos em português, sem jargão
contábil: "Baixar seus dados", "planilha CSV", "espaço financeiro".

A UI não escolhe dataset fora da lista `s11.v1` e não envia tenancy.

## Fora de escopo (reafirmado)

Plataforma de observabilidade, SIEM, auditoria por ação de usuário, DR
multi-região, exportador bancário proprietário, pipeline de importação,
histórico de exportações, e-mail de notificação, fila assíncrona com
acompanhamento, e qualquer dependência de domínio em Vercel/Neon/R2.

## Decisões diferidas a T02 (com gatilho)

T01 não escolhe provedor de storage. T02 preenche nesta ADR:

1. backup externo `pg_dump → S3/R2`: implementar ou não, com evidência datada;
2. orquestrador durável: implementar ou não (expectativa desta ADR: **não**).

Gatilho de revisão: retenção nativa abaixo de 7 dias, RPO medido acima de 24 h,
ou job cujo efeito não possa ser tornado idempotente sem orquestrador.

## Auditoria e decisões T02 (2026-09-03)

Auditoria da capacidade nativa de backup/restauração confrontada com a política
mínima de T01 (retenção ≥ 7 dias, RPO ≤ 24 h, RTO ≤ 4 h). Fontes públicas
consultadas em 2026-09-03; nenhum identificador de projeto, URL de banco ou
segredo foi registrado.

### Capacidades nativas verificadas

| Capacidade | O que foi verificado | Fonte | Data |
| --- | --- | --- | --- |
| PITR / instant restore no Neon | Root branch pode ser restaurada a qualquer timestamp ou LSN dentro da janela de histórico; operação sobrescreve o branch, cria branch de backup automático e mantém a connection string estável; duração típica de segundos | [Neon — Instant restore](https://neon.com/docs/introduction/branch-restore) | 2026-09-03 |
| Janela de histórico (retenção PITR) | Plano Free: máx. 6 h; Launch: máx. 7 dias (padrão 1 dia); Scale: máx. 30 dias (padrão 1 dia). Configurável em Settings → Instant restore (`history_retention_seconds`; 7 dias = 604800) | [Neon — History window](https://neon.com/docs/introduction/history-window) | 2026-09-03 |
| Granularidade de restauração | Timestamp RFC 3339 ou LSN, até milissegundo, dentro da janela | [Neon — Instant restore](https://neon.com/docs/introduction/branch-restore) | 2026-09-03 |
| Escopo da restauração | Aplica-se a todas as databases do branch; conexões são interrompidas temporariamente | [Neon — Instant restore](https://neon.com/docs/introduction/branch-restore) | 2026-09-03 |
| Vercel e backup de dados | Vercel não hospeda nem faz backup do PostgreSQL; Postgres é integração de marketplace (Neon). Vercel Postgres legado foi descontinuado | [Vercel — Postgres on Vercel](https://vercel.com/docs/storage/vercel-postgres) | 2026-09-03 |
| Exportação portável V1 | Exportação CSV manual autenticada (`s11.v1`) já prevista nesta ADR; não substitui PITR | ADR-014 + TechSpec §113 | 2026-09-03 |

**Premissa operacional:** produção usa plano Neon pago (Launch ou Scale) com
janela de histórico configurada para **≥ 7 dias**. O plano Free (máx. 6 h) não
atende a política de T01 e não é adequado para produção deste produto.

### Matriz política × capacidade nativa × lacuna

| Política T01 | Capacidade nativa verificada | Lacuna | Impacto |
| --- | --- | --- | --- |
| Retenção ≥ 7 dias | Launch até 7 dias; Scale até 30 dias, se configurado | Nenhuma, com plano pago e janela ≥ 7 dias | — |
| RPO ≤ 24 h | PITR contínuo via WAL dentro da janela | Nenhuma com PITR habilitado | Perda máxima teórica ≈ tempo desde último WAL retido, não 24 h |
| RTO ≤ 4 h | Restore Neon em segundos + migrations/checks manuais | Validação operacional (T13) ainda não exercitada em produção | Risco de estourar RTO se o runbook não for seguido; não exige backup externo |
| Restauração bem-sucedida | Branch restaurável + `db:check` + readiness | Procedimento formal é T13 | Lacuna de processo, não de capacidade nativa |
| Portabilidade (TechSpec §4) | CSV manual + possibilidade de `pg_dump` ad hoc pelo operador | Cópia lógica off-site automática não existe na V1 | Independência de vendor parcial; aceito pelo backlog §113 |
| Vercel não backupa DB | Confirmado: backup é responsabilidade do Neon | Operador deve confirmar Neon, não Vercel | Erro de configuração se só confiar na Vercel |

Matriz detalhada para operação: [`docs/S11-backup-audit.md`](../S11-backup-audit.md).

### Decisão 1 — Backup lógico externo `pg_dump → S3/R2`

**Decisão:** **Não implementar na V1** (caminho B).

**Justificativa:** Com plano Neon pago e janela de histórico ≥ 7 dias, o PITR
nativo cobre retenção, RPO e escopo de restauração exigidos por T01. A TechSpec
§113 já define V1 como `Neon recovery/PITR + exportação CSV manual` e coloca
`pg_dump → R2/S3` no backlog. Não há lacuna demonstrada que exija vencer esse
padrão. §112 continua proibindo uso rotineiro de dados de produção fora do
runbook aprovado.

**Alternativas consideradas:**

| Alternativa | Prós | Contras | Por que não na V1 |
| --- | --- | --- | --- |
| A — `pg_dump` agendado → R2/S3 | Cópia off-site independente do Neon; formato portável | Segredos de storage, job T09, custo, duplica PITR | Sem lacuna contra política T01 |
| B — Apenas Neon PITR + CSV manual | Alinhado à TechSpec §113; zero infra nova | Dependência do provedor de DB para DR | **Escolhida** |
| C — Branch Neon periódica como “backup” | Sem bucket externo | Não é off-site; custo de branches | Redundante com PITR |

**Consequências:**

- T09 registra formalmente a não implementação do job de backup externo.
- T13 documenta restore via Neon PITR (e validação em branch separada antes de
  promover).
- Exportação `s11.v1` permanece o mecanismo de portabilidade do usuário, não de
  DR operacional.

**Gatilhos de revisão (decisão 1):**

1. Retenção nativa configurável **abaixo de 7 dias** no plano de produção.
2. RPO **medido acima de 24 h** em incidente ou exercício.
3. Restore validado **não atinge RTO ≤ 4 h** em horário comercial.
4. Mudança de provedor de PostgreSQL sem PITR equivalente.

### Decisão 2 — Orquestrador de workflows duráveis (Temporal o produto)

**Decisão:** **Não implementar na V1** (caminho B).

**Justificativa:** Nenhum workflow do slice exige orquestração durável além do
que T08 oferece (registro de execução, idempotência por
`(jobName, logicalWindow)`, retry com backoff, estado observável). O termo
“Temporal” na stack é `@js-temporal/polyfill` (datas), não o servidor Temporal.
TechSpec §104 rejeita infraestrutura preventiva. Com a decisão 1 negativa, o
único job recorrente relevante na V1 é o runtime genérico de T08 (ex.:
`s11.job.heartbeat`) mais exportação sob demanda (não agendada).

**Mecanismo alternativo:** agendador externo (GitHub Actions `schedule`, cron do
host ou equivalente) **invoca** o endpoint/comando do job; o job não importa o
agendador. Limites: sem garantia de exactly-once entre agendador e processo
(idempotência compensa); sem saga multi-etapa durável; falha entre tentativas
depende de retry de T08 e alerta no Sentry.

**Alternativas consideradas:**

| Alternativa | Prós | Contras | Por que não na V1 |
| --- | --- | --- | --- |
| Temporal (produto) | Workflows duráveis, compensação | Infra nova, operação, §104 | Nenhum workflow real exige |
| T08 + cron/GitHub Actions | Simples, portável, sem vendor lock-in de orquestração | Sem estado de workflow longo | **Escolhida** |
| Fila + worker dedicado | Assíncrono | Over-engineering para V1 | Fora do escopo S11 |

**Gatilho de revisão (decisão 2):** surgir job cujo efeito **não possa ser
tornado idempotente** sem orquestrador durável (ex.: pipeline multi-etapa com
compensação obrigatória e janela > retry de T08).

### Superfície de configuração (decisões T02)

| Componente | Variáveis / segredos | Comportamento se ausente |
| --- | --- | --- |
| Backup externo `pg_dump → R2/S3` | Nenhuma na V1 (decisão negativa) | N/A — T09 não implementa |
| PITR Neon | Configuração no console Neon (`history_retention_seconds`); não é variável da app | Operador deve confirmar antes de produção; ver `docs/production-deploy.md` |
| Jobs T08 | Sem variáveis novas além do runtime existente (`DATABASE_URL`, Sentry) | Job falha de forma observável; sem efeito financeiro |
| Agendador | Secrets do CI (`MIGRATION_DATABASE_URL`, etc.) ou cron do host; fora do `.env.example` | Job não dispara; heartbeat ausente detectável |

Nenhuma regra de domínio passa a depender de Vercel, Neon, R2 ou S3.

## Consequências

- T03 implementa um único encoder conforme esta tabela.
- T06 lê exatamente estas colunas, nesta ordem de estabilidade, e aplica o
  recorte de tenancy no servidor.
- T07 empacota ZIP + manifesto e recusa tenancy vinda do cliente.
- T08/T09/T12/T13 consomem a política de jobs e backup sem reabrir o dialeto
  CSV.
- Alterar coluna, arquivo ou formato é `s11.v2` + nova ADR.
