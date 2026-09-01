# ADR-004 — Contrato da transação manual do S03

- **Status:** Aceito
- **Data:** 2026-08-29
- **Escopo:** T01 do slice S03 — Transação manual end-to-end
- **Dependências:** S01, S02, ADR-001, ADR-002 e ADR-003

## Contexto

O documento de produto chama o fluxo de “transação”, enquanto a TechSpec
separa o fato econômico do seu efeito no ledger. Também há documentos que
usam “espaço financeiro” como linguagem de interface. Sem um contrato único,
as tasks seguintes poderiam criar uma tabela paralela, confiar no tenant
recebido pelo navegador ou sobrescrever efeitos financeiros já postados.

Esta ADR fecha a fronteira mínima do S03 e é a referência normativa para
T02–T15. Ela não implementa schema, domínio, use case, UI ou teste.

## Gate de dependências

### S01 — contexto, isolamento e IDs

O S03 reutiliza o que já foi entregue em S01:

- `requireFinancialContext()` é um guard server-only em
  `src/modules/households/context.ts` e retorna somente `{ userId,
  householdId }` validados a partir da sessão e da membership persistida;
- `withFinancialContext`, `assertFinancialContext` e as queries
  tenant-scoped mantêm `household_id` no predicado; ID fornecido pelo cliente
  é no máximo uma dica de seleção revalidada no servidor;
- a aplicação não usa RLS nem acesso do browser ao PostgreSQL na V1; o
  isolamento é feito pelo contexto server-side, pelas constraints/FKs e pelos
  testes de dois households;
- `src/lib/uuidv7.ts` é o ponto único de geração de IDs de domínio, inclusive
  para IDs que precisam existir antes do `INSERT`. Não se cria gerador local
  para o S03.

O deploy de produção de S01 continua sendo um gate operacional independente;
isso não altera o contrato necessário para desenvolver o S03 sobre o schema
local/CI.

### S02 — contas, categorias e âncora temporal

O S02 entrega as tabelas únicas `accounts` e `categories`, sempre com
`household_id` obrigatório e FK para `households`. O status persistido é
`ACTIVE | ARCHIVED`; “ativo/inativo” na linguagem de produto não cria um
enum `INACTIVE` e não autoriza reativação implícita. Linhas `ARCHIVED` são
preservadas e não são opções para novos lançamentos.

`accounts.tracking_started_on` já existe como `DATE NULL`. O S02 o mantém
`NULL` até o fluxo de saldo inicial; quando preenchido, todo lançamento
manual `POSTED` deve usar data igual ou posterior à âncora. Conta com âncora
`NULL` não impõe limite inferior adicional, mas continua sujeita às demais
regras de data.

O S02 também entrega a tabela compartilhada `application_commands` com chave
`(household_id, command_id)` e `payload_hash`. O S03 reutiliza essa tabela e
não cria outra tabela de idempotência.

### Lacuna do ledger

No fechamento desta T01 não existem schema Drizzle, migration ou módulo
executável para `financial_events`/`account_entries`; a TechSpec descreve o
ledger apenas conceitualmente. Portanto, T03 é responsável pela fundação
mínima dessas duas tabelas, suas FKs, checks, índices e relação de reversal,
antes de T04/T05 integrarem as escritas. T03 não deve criar uma tabela
`transactions` nem coluna `accounts.balance`.

## Vocabulário e fontes de verdade

| Conceito | Módulo/rota/UI | Persistência canônica | Papel |
| --- | --- | --- | --- |
| Transação | `transactions`, `/transactions`, `/transactions/[id]` | Não possui tabela própria | Nome de produto e read model do fluxo |
| `FinancialEvent` | detalhe do lançamento | `financial_events` | Fato econômico, com valor absoluto |
| `AccountEntry` | saldo/extrato da conta | `account_entries` | Efeito assinado do fato sobre uma conta |
| Household | “Espaço financeiro” somente na UI | `households`, `household_id` | Raiz de tenancy e isolamento |

`transactions` não é uma segunda fonte de verdade. A leitura do módulo
combina `financial_events` com seu `account_entries`, `accounts` e a
`category` opcional. `FinancialEvent` e `AccountEntry` são nomes de domínio;
as tabelas físicas usam exatamente `financial_events` e `account_entries`.

`Household`, `households` e `household_id` são os nomes canônicos. “Espaço
financeiro” é texto da UI. `financial_space_id`, `financial_spaces` e aliases
equivalentes não podem aparecer em commands, colunas, FKs ou migrations.

## Contrato persistido mínimo

### `FinancialEvent`

T03 deve fornecer, no mínimo:

| Campo | Contrato |
| --- | --- |
| `id` | UUIDv7, imutável |
| `household_id` | UUIDv7 obrigatório, derivado do contexto |
| `kind` | `INCOME` ou `EXPENSE` no S03; enum extensível da TechSpec pode reservar os demais tipos para slices futuros |
| `status` | `POSTED` na criação; `CANCELLED` no evento manual original depois do cancelamento |
| `origin` | `MANUAL` para lançamento digitado; `SYSTEM` para evento compensatório gerado pelo cancelamento |
| `amount_cents` | inteiro positivo e absoluto; nunca float e nunca zero |
| `occurred_on` | PostgreSQL `DATE`; boundary `YYYY-MM-DD`, domínio `Temporal.PlainDate` |
| `description` | texto normalizado, obrigatório no create |
| `category_id` | UUIDv7 nullable; quando presente, categoria ativa do mesmo household e tipo |
| `reversal_of_event_id` | nullable; preenchido somente no evento `REVERSAL` e apontando para o evento original do mesmo household |
| `created_at`, `updated_at` | timestamps técnicos |

O lançamento manual original nunca usa `kind=REVERSAL`. Um reversal possui
`kind=REVERSAL`, `origin=SYSTEM`, valor absoluto igual ao original e uma
relação explícita `reversal_of_event_id`; não se infere essa relação pela
descrição ou pelo command.

### `AccountEntry`

T03 deve fornecer, no mínimo:

| Campo | Contrato |
| --- | --- |
| `id` | UUIDv7, imutável |
| `financial_event_id` | obrigatório; FK para o evento do mesmo household |
| `account_id` | obrigatório; FK composta com `household_id` |
| `household_id` | obrigatório e igual ao evento/conta |
| `amount_cents` | inteiro assinado e não nulo; despesa negativa, receita positiva |
| `status` | `POSTED` para os entries criados neste slice |
| `expected_on` | `NULL` para o lançamento manual realizado |
| `posted_on` | igual a `occurred_on` no create manual; nunca futuro |
| `created_at` | timestamp técnico |

Um lançamento manual cria exatamente um entry para sua conta. O saldo é
sempre `SUM(account_entries.amount_cents)` dos entries `POSTED` até a data
pedida; não existe `accounts.balance` nem outro saldo materializado como
fonte de verdade.

## Lançamento manual

Os dois commands têm a mesma forma serializável; o nome da operação fixa o
tipo e não há um `kind` livre que possa contradizer a operação:

```ts
interface CreateManualTransactionCommand {
  commandId: string;
  amountCents: string;       // inteiro decimal positivo, sem float
  occurredOn: string;        // YYYY-MM-DD
  description: string;
  accountId: string;         // UUIDv7
  categoryId?: string | null;
}

type CreateExpenseCommand = CreateManualTransactionCommand;
type CreateIncomeCommand = CreateManualTransactionCommand;
```

`CreateExpense` persiste `kind=EXPENSE` e um entry de `-amountCents`;
`CreateIncome` persiste `kind=INCOME` e um entry de `+amountCents`. Em ambos
os casos, o evento é `status=POSTED` e `origin=MANUAL`.

Regras de entrada e referência:

1. `commandId` é texto opaco, aparado, não vazio e limitado a 128 caracteres;
   não é tenant nem valor financeiro.
2. `amountCents` contém somente centavos inteiros positivos representáveis
   pelo domínio; zero, negativo, vazio, float e precisão além de centavos são
   rejeitados.
3. `occurredOn` é uma data civil válida e não pode ser posterior à data de
   negócio atual do servidor. O client não define essa data de referência.
4. `description` é obrigatória, normalizada com NFKC, trim e whitespace
   interno colapsado, com 1–240 code points e sem caracteres de controle.
5. `accountId` deve apontar para conta `ACTIVE` do `household_id` resolvido.
   Se `tracking_started_on` não for `NULL`, `occurredOn` deve ser igual ou
   posterior a ela.
6. `categoryId` omitido ou `null` é permitido. Quando informado, deve apontar
   para categoria `ACTIVE` do mesmo household e seu `kind` deve ser igual ao
   tipo do evento. Categoria de outro household, arquivada ou incompatível é
   rejeitada.
7. `householdId`, `status`, `origin`, `reversal_of_event_id` e qualquer
   sinal de entry são determinados no servidor; não fazem parte do command.

O contrato de leitura pode expor `householdId` e `origin` como dados, mas
nunca os aceita de volta como autoridade. `amountCents` atravessa a boundary
como string e só vira `bigint`/`Money` dentro do domínio.

## Histórico, edição e cancelamento

### Campos editáveis

T07 implementará `UpdateManualTransaction` somente para o evento manual
original e os campos abaixo:

```ts
interface UpdateManualTransactionCommand {
  commandId: string;
  financialEventId: string;
  description?: string;
  categoryId?: string | null;
}
```

`description` e `categoryId` podem ser alterados individualmente ou juntos.
Campo omitido permanece inalterado; `categoryId: null` remove a categoria.
Ao alterar categoria, aplicam-se novamente tenant, status `ACTIVE` e
compatibilidade `EXPENSE`/`INCOME`. O evento original pode continuar sendo
consultado após cancelamento; essa edição de metadados não altera o ledger.

Valor, conta, data, tipo, origem, status, entry e relação de reversal não são
editáveis. Se forem enviados para o command, a boundary rejeita com erro de
campo não editável; não os ignora silenciosamente. T07 não implementará
correção atômica de campos financeiros no S03. Uma alteração de valor, conta,
data ou tipo exigirá uma operação futura explícita de correction ou
cancelar-e-lançar-novamente, com novo contrato.

### Cancelamento

O command é:

```ts
interface CancelManualTransactionCommand {
  commandId: string;
  financialEventId: string;
}
```

Para um evento manual `POSTED`, T07 fará uma única transação que:

1. valida o evento no `household_id` do contexto e confirma que ele ainda é
   cancelável;
2. mantém o evento e o entry originais, altera somente o status do evento
   original para `CANCELLED` e preserva seu `origin=MANUAL`;
3. cria um novo `FinancialEvent` com `kind=REVERSAL`, `origin=SYSTEM`,
   `status=POSTED`, `amount_cents` igual ao original e
   `reversal_of_event_id` apontando para ele;
4. cria no mesmo account um `AccountEntry` `POSTED` com sinal oposto ao entry
   original; o reversal usa a mesma `occurred_on` do evento original para
   neutralizar o efeito a partir da data econômica registrada;
5. grava o command em `application_commands` e retorna o read model do
   original com o reversal identificável.

O entry original continua histórico e `POSTED`; a neutralização vem do entry
oposto. O read model deve mostrar o original cancelado e a relação/evento
compensatório. Não há hard delete, não há remoção do histórico e a constraint
ou índice equivalente deve impedir mais de um reversal efetivo para o mesmo
evento original.

Um retry do mesmo command retorna o mesmo resultado. Um novo command para um
evento já cancelado não cria outro reversal e retorna conflito de estado.
Um reversal não pode ser cancelado pelo command manual deste slice.

## Commands, idempotência e resultado

Operações estáveis em `application_commands`:

| Operação | Recurso principal |
| --- | --- |
| `transactions.create.expense` | `financial_events.id` criado |
| `transactions.create.income` | `financial_events.id` criado |
| `transactions.update.manual` | `financial_events.id` atualizado |
| `transactions.cancel.manual` | ID do reversal criado; a resposta é o original com seu histórico |

Todos os writes retornam `Result<T, E>` e executam em uma única transaction
PostgreSQL controlada pelo use case. O registro de command participa da
mesma transaction de seus eventos/entries.

Para o mesmo `household_id` e `commandId`:

- mesma operação e payload canônico normalizado → retry idempotente, com o
  mesmo read model e sem novos eventos/entries;
- operação ou payload diferente → `COMMAND_ID_REUSED`, sem alteração;
- o mesmo `commandId` em households distintos é independente, pois a chave é
  composta pelo tenant;
- o client deve reutilizar o ID em retry da mesma tentativa e gerar outro ID
  para uma nova intenção.

O hash do payload canônico deve incluir a operação e os campos efetivos do
command, mas nunca um tenant vindo do browser. IDs de recurso são strings
UUIDv7; datas são strings `YYYY-MM-DD`; nenhum objeto Drizzle, `Date`,
`bigint` ou objeto de domínio atravessa a boundary React/Next.

## Erros esperados

Os códigos são estáveis e independentes de mensagens de PostgreSQL:

```text
UNAUTHENTICATED
INVALID_COMMAND
INVALID_COMMAND_ID
INVALID_AMOUNT
INVALID_DATE
DATE_IN_FUTURE
INVALID_DESCRIPTION
ACCOUNT_NOT_FOUND
CATEGORY_NOT_FOUND
RESOURCE_ARCHIVED
TRACKING_START_DATE_VIOLATION
CATEGORY_KIND_MISMATCH
EVENT_NOT_FOUND
EVENT_NOT_MANUAL
EVENT_NOT_POSTED
EVENT_ALREADY_CANCELLED
REVERSAL_ALREADY_EXISTS
NON_EDITABLE_FIELD
COMMAND_ID_REUSED
```

IDs inexistentes ou pertencentes a outro household usam o mesmo
`*_NOT_FOUND`, sem revelar a existência do registro. `UNAUTHENTICATED` é
401; validações são 400; não encontrado é 404; estado arquivado,
incompatibilidade, command reutilizado e demais conflitos são 409. Falhas
inesperadas de banco/infraestrutura não atravessam esse envelope: seguem a
observabilidade de S01 e recebem resposta genérica.

O shape público é:

```ts
interface S03Error {
  code: S03ErrorCode;
  message: string;
  field?:
    | "commandId"
    | "amountCents"
    | "occurredOn"
    | "description"
    | "accountId"
    | "categoryId"
    | "financialEventId";
}

type S03Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: S03Error };
```

Mensagens são acionáveis e não expõem SQL, stack trace, payload, valor,
descrição, nome de conta/categoria ou IDs de outro tenant.

## Read model mínimo

O read model serializável da transação deve conter os dados necessários para
listagem/detalhe, sem criar uma entidade persistida paralela:

```ts
interface ManualTransactionReadModel {
  id: string;
  householdId: string;
  kind: "INCOME" | "EXPENSE";
  status: "POSTED" | "CANCELLED";
  origin: "MANUAL";
  amountCents: string;
  occurredOn: string;
  description: string;
  accountId: string;
  categoryId: string | null;
  entry: {
    id: string;
    amountCents: string;
    status: "POSTED";
    postedOn: string;
  };
  reversal: {
    id: string;
    amountCents: string;
    origin: "SYSTEM";
    status: "POSTED";
    occurredOn: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}
```

Listagens filtram eventos `origin=MANUAL` por padrão e mantêm o reversal no
detalhe/histórico. Se a UI escolher mostrar o reversal na lista, ele deve ser
identificado como efeito compensatório, nunca como um segundo lançamento
manual.

## Handoff sem novas decisões estruturais

| Task | Deve consumir desta ADR |
| --- | --- |
| T02 | `Money`/`bigint`, `PlainDate`, enums, normalização, campos editáveis e schemas dos commands |
| T03 | tabelas `financial_events`/`account_entries`, `origin`, `reversal_of_event_id`, checks, FKs, índices e ausência de `accounts.balance` |
| T04 | contexto server-side, FKs/predicados por `household_id`, contas/categorias ativas e `tracking_started_on` |
| T05 | create expense/income, sinais, atomicidade, `application_commands` e retry |
| T06 | joins/read model, filtros, ordenação e saldo derivado pelos entries `POSTED` |
| T07 | somente metadata update e cancelamento com reversal; sem correção financeira atômica |
| T08 | códigos/mensagens e redaction sem dados financeiros |
| T09 | campos/limites do formulário, categoria opcional e opções `ACTIVE` |
| T10–T12 | actions e telas sem tenant no payload, detalhe/histórico e sem hard delete |
| T13–T15 | cenários negativos, rollback, idempotência, neutralização, E2E e release |

Qualquer mudança nesses pontos exige atualizar esta ADR e a T01 antes de
alterar migrations ou payloads.

## Consequências

- O módulo `/transactions` pode evoluir sem introduzir uma terceira fonte de
  verdade.
- A contabilidade do saldo permanece derivada e auditável, inclusive depois
  de cancelamento.
- A edição de metadados é simples, mas correções financeiras exigem operação
  explícita futura.
- A origem `SYSTEM` distingue o efeito compensatório da intenção manual
  original, mesmo quando o cancelamento é acionado pelo usuário.

