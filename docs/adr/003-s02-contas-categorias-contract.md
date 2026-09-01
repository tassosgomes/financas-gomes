# ADR-003 — Contrato de contas e categorias do S02

- **Status:** Aceito
- **Data:** 2026-08-29
- **Escopo:** T01 do slice S02 — Contas e categorias
- **Dependências:** S01 concluído; contexto financeiro resolvido no servidor

## Contexto

O S02 precisa entregar a estrutura de metadados que será consumida pelos
próximos fluxos financeiros, mas a TechSpec também descreve uma conta como
parte do ledger. Sem uma fronteira explícita, a implementação poderia criar
saldo duplicado, aceitar um tenant vindo do formulário ou transformar o CRUD
de configuração em uma operação contábil.

Este documento é o contrato que T02–T13 devem consumir. Ele complementa a
TechSpec e a ADR-001; não cria uma nova fonte de verdade para o domínio
financeiro.

## Decisões

### 1. Fronteira e vocabulário canônico

O S02 é dono do CRUD dos metadados de `accounts` e `categories`:

- criar, listar, editar e arquivar contas;
- criar, listar, editar e arquivar categorias;
- validar nomes, tipos, hierarquia e estado;
- manter todas as operações limitadas ao `household` do contexto autenticado.

`Household`/`households` e `household_id` continuam sendo os nomes canônicos
do domínio e da persistência. **Espaço financeiro** é somente o texto da UI.
Não serão introduzidos `financial_spaces`, `financial_space_id` ou
`financial_space_users`.

O `household_id` é sempre obtido de `requireFinancialContext()`/contexto
equivalente no servidor. Ele não aparece como autoridade em nenhum command,
formulário, query ou Server Action pública. Um identificador de outro
household se comporta como inexistente, sem revelar a existência do registro.

Se uma implementação anterior do Slice 1 já tiver criado `accounts`, as
migrations do S02 devem estender e reutilizar essa tabela. Não se cria uma
segunda tabela de contas.

### 2. O que permanece fora do S02

O S02 não cria nem altera o fato econômico ou o ledger. Permanecem fora dele:

- saldo inicial e o command que o registra;
- `FinancialEvent`;
- `AccountEntry`;
- saldo atual, saldo derivado e qualquer coluna `accounts.balance`;
- extrato, transações e a rota/módulo de transações;
- faturas, limite e regras específicas de cartão;
- regras de gasto de contas de benefício;
- associação categoria → caixinha padrão, que fica adiada para o slice de
  Caixinhas.

Quando um fluxo posterior precisar representar saldo inicial ou movimentação,
ele deve usar `FinancialEvent` + `AccountEntry`, conforme a TechSpec. O S02
somente fornece a conta à qual esses registros poderão apontar.

### 3. Contrato persistido de `Account`

Os campos de domínio são:

| Campo persistido | Tipo/valor | Regra |
| --- | --- | --- |
| `id` | UUIDv7 | Gerado pelo ponto único de `src/lib/uuidv7.ts`; imutável |
| `household_id` | UUIDv7 | Obrigatório; derivado do contexto server-side |
| `name` | texto | Obrigatório, normalizado e único no household |
| `type` | `CHECKING`, `SAVINGS`, `CASH`, `CREDIT_CARD`, `BENEFIT`, `INVESTMENT` ou `OTHER` | Obrigatório e imutável no S02 |
| `status` | `ACTIVE` ou `ARCHIVED` | Obrigatório; inicia `ACTIVE` |
| `spendability` | `GENERAL`, `RESTRICTED` ou `EXCLUDED` | Obrigatório; default `GENERAL` |
| `liquidity` | `IMMEDIATE`, `LIQUID` ou `RESTRICTED` | Obrigatório; default `IMMEDIATE` |
| `include_in_net_worth` | boolean | Obrigatório; default `true` |
| `tracking_started_on` | PostgreSQL `DATE`, nullable | Inicia `NULL`; não é editável pelo S02 |

`created_at` e `updated_at` são timestamps técnicos de persistência, não
campos de command. O read model pode serializá-los como ISO 8601.

O create exige `name` e `type`. A UI pode deixar `CHECKING` pré-selecionado,
mas o servidor não inventa o tipo quando ele é omitido. Os demais defaults
acima são aplicados no servidor. Não há defaults implícitos baseados no tipo:
um fluxo que cadastrar uma conta de benefício, investimento ou cartão deve
enviar explicitamente os metadados especiais quando não quiser os defaults
gerais.

`tracking_started_on` é reservado ao fluxo de saldo inicial do Slice 1/ledger
posterior. Uma conta criada pelo S02 permanece com `NULL`; o fluxo que cria o
saldo inicial deve defini-lo atomicamente com o evento correspondente. O S02
nunca aceita esse campo no formulário, no create ou no update, nem o substitui
por `new Date()`.

No S02, `UpdateAccount` pode alterar somente `name`, `spendability`,
`liquidity` e `include_in_net_worth`. `id`, `household_id`, `type`, `status` e
`tracking_started_on` não são campos de update. Uma conta arquivada é somente
leitura no S02; não existe reativação neste slice. Uma futura reativação exige
um command explícito e uma nova decisão, não uma edição silenciosa do status.

### 4. Contrato persistido de `Category`

Os campos de domínio são:

| Campo persistido | Tipo/valor | Regra |
| --- | --- | --- |
| `id` | UUIDv7 | Gerado por `src/lib/uuidv7.ts`; imutável |
| `household_id` | UUIDv7 | Obrigatório; derivado do contexto server-side |
| `name` | texto | Obrigatório, normalizado e único entre irmãos no household |
| `parent_id` | UUIDv7 nullable | `NULL` para raiz; pai deve ser do mesmo household |
| `kind` | `EXPENSE` ou `INCOME` | Obrigatório e imutável no S02 |
| `status` | `ACTIVE` ou `ARCHIVED` | Obrigatório; inicia `ACTIVE` |

Uma categoria pode ter no máximo um nível de filho. Portanto, uma categoria
filha sempre tem um pai raiz (`parent_id` cujo próprio `parent_id` é `NULL`).
O pai deve estar ativo no create/update, pertencer ao mesmo household e ter o
mesmo `kind` da filha. Uma categoria não pode ser pai de si mesma.

O nome é único entre irmãos (mesmo `household_id` e mesmo `parent_id`) e a
unicidade considera categorias arquivadas. Assim, arquivar não libera um nome
ambíguo para outra entidade; o registro histórico continua sendo identificável.

`UpdateCategory` pode alterar `name` e `parent_id`. `kind`, `id`,
`household_id` e `status` não são campos de update. `parent_id: null` significa
voltar à raiz e também é reparenting. Se a categoria já tiver sido utilizada
por qualquer referência financeira persistida, qualquer mudança de
`parent_id` é rejeitada. O teste é feito no momento do command, dentro da
mesma transação/lock da alteração. Renomear uma categoria utilizada continua
permitido.

O S02 não possui uma tabela de uso financeiro para consultar. Até que o
ledger/`FinancialEvent` exista, uma categoria não possui uso registrado; a
implementação posterior que criar referências de categoria deve conectar essa
consulta antes de oferecer reparenting. Não se pode inferir uso pelo número de
filhos ou pelo status.

Uma categoria arquivada não pode ser pai de uma nova categoria e não é
oferecida para novos lançamentos. Para evitar filhos ativos órfãos, arquivar
um pai com filhos ativos retorna conflito; primeiro os filhos precisam ser
arquivados. Filhos já arquivados preservam o `parent_id` para o histórico.
Arquivamento nunca executa hard delete e não remove referências existentes.

### 5. Normalização e limites

O boundary recebe nomes como texto e aplica, nessa ordem:

1. normalização Unicode NFKC;
2. remoção de espaços nas extremidades;
3. colapso de sequências internas de whitespace para um espaço;
4. preservação de maiúsculas/minúsculas para exibição.

O nome normalizado deve ter entre 1 e 120 code points e não pode conter
caracteres de controle. A comparação de unicidade é case-insensitive sobre o
nome normalizado. A mesma política vale para contas e categorias.

Na persistência, a constraint de categorias deve tratar `parent_id = NULL`
como uma chave real (raízes do mesmo household também não podem duplicar
nome). A migration pode usar um índice/constraint null-safe ou uma expressão
equivalente; não pode depender da semântica padrão de `UNIQUE`, que permite
vários `NULL`. A normalização do boundary deve ocorrer antes da escrita para
que o índice case-insensitive veja exatamente o valor contratado.

`commandId` é texto opaco, obrigatório em todo write, aparado, não vazio e
limitado a 128 caracteres. A aplicação não deve interpretar o conteúdo como
tenant ou como valor financeiro. IDs de recursos são strings UUIDv7 na
boundary; datas financeiras, quando existirem nos fluxos posteriores, são
strings `YYYY-MM-DD`, nunca `Date`.

### 6. Commands e leituras

Os nomes dos commands são parte do contrato e não implicam Command Bus:

| Command/read | Payload serializável | Resultado |
| --- | --- | --- |
| `CreateAccount` | `commandId`, `name`, `type`; `spendability`, `liquidity` e `includeInNetWorth` opcionais | `AccountReadModel` |
| `ListAccounts` | `status?: ACTIVE \| ARCHIVED \| ALL` | `ListAccountsReadModel` |
| `UpdateAccount` | `commandId`, `accountId` e ao menos um campo editável | `AccountReadModel` |
| `ArchiveAccount` | `commandId`, `accountId` | `AccountReadModel` com `ARCHIVED` |
| `CreateCategory` | `commandId`, `name`, `kind`; `parentId` opcional/null | `CategoryReadModel` |
| `ListCategories` | `status?: ACTIVE \| ARCHIVED \| ALL` | `ListCategoriesReadModel` |
| `UpdateCategory` | `commandId`, `categoryId` e `name`/`parentId` opcionais | `CategoryReadModel` |
| `ArchiveCategory` | `commandId`, `categoryId` | `CategoryReadModel` com `ARCHIVED` |

Formato TypeScript equivalente (camelCase somente na boundary):

```ts
type AccountStatus = "ACTIVE" | "ARCHIVED";
type AccountType =
  | "CHECKING"
  | "SAVINGS"
  | "CASH"
  | "CREDIT_CARD"
  | "BENEFIT"
  | "INVESTMENT"
  | "OTHER";
type Spendability = "GENERAL" | "RESTRICTED" | "EXCLUDED";
type Liquidity = "IMMEDIATE" | "LIQUID" | "RESTRICTED";
type CategoryKind = "EXPENSE" | "INCOME";
type StatusFilter = AccountStatus | "ALL";

interface CreateAccountCommand {
  commandId: string;
  name: string;
  type: AccountType;
  spendability?: Spendability;
  liquidity?: Liquidity;
  includeInNetWorth?: boolean;
}

interface UpdateAccountCommand {
  commandId: string;
  accountId: string;
  name?: string;
  spendability?: Spendability;
  liquidity?: Liquidity;
  includeInNetWorth?: boolean;
}

interface ArchiveAccountCommand {
  commandId: string;
  accountId: string;
}

interface CreateCategoryCommand {
  commandId: string;
  name: string;
  kind: CategoryKind;
  parentId?: string | null;
}

interface UpdateCategoryCommand {
  commandId: string;
  categoryId: string;
  name?: string;
  parentId?: string | null;
}

interface ArchiveCategoryCommand {
  commandId: string;
  categoryId: string;
}

interface ListQuery {
  status?: StatusFilter; // omit = ACTIVE
}
```

`householdId`, `status` de escrita, `trackingStartedOn`, saldo inicial e
qualquer payload financeiro não fazem parte desses commands. Campos omitidos
em update permanecem inalterados; `parentId: null` é uma instrução explícita
para tornar a categoria raiz. `UpdateAccount`/`UpdateCategory` sem campo
editável falham com validação.

As operações de persistência usam estes nomes estáveis para idempotência:
`accounts.create`, `accounts.update`, `accounts.archive`,
`categories.create`, `categories.update` e `categories.archive`.

### 7. Read models serializáveis

O read model público usa camelCase, inclui `householdId` apenas como dado de
leitura e nunca o aceita de volta como autoridade:

```ts
interface AccountReadModel {
  id: string;
  householdId: string;
  name: string;
  type: AccountType;
  status: AccountStatus;
  spendability: Spendability;
  liquidity: Liquidity;
  includeInNetWorth: boolean;
  trackingStartedOn: string | null; // YYYY-MM-DD
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

interface CategoryReadModel {
  id: string;
  householdId: string;
  name: string;
  parentId: string | null;
  kind: CategoryKind;
  status: AccountStatus;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

interface ListAccountsReadModel {
  items: AccountReadModel[];
}

interface ListCategoriesReadModel {
  items: CategoryReadModel[];
}
```

As listas são planas e retornam `items: []` quando vazias. `ListCategories`
ordena pais antes de filhos e ambos por nome normalizado, com `id` como
desempate; a UI pode construir uma árvore a partir de `parentId`. As duas
leituras filtram `ACTIVE` por padrão; `ARCHIVED` e `ALL` são pedidos
explícitos. `ListAccounts` usa nome normalizado e `id` como desempate. Não há
saldo, extrato, fatura ou cálculo derivado nesses modelos.

### 8. Erros e idempotência

Erros esperados atravessam a boundary como `Result<T, E>`, nunca como detalhe
bruto do banco:

```ts
type S02Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: S02Error };

interface S02Error {
  code: S02ErrorCode;
  message: string;
  field?:
    | "commandId"
    | "name"
    | "type"
    | "spendability"
    | "liquidity"
    | "includeInNetWorth"
    | "accountId"
    | "categoryId"
    | "kind"
    | "parentId";
}
```

Os códigos estáveis são:

```text
UNAUTHENTICATED
INVALID_COMMAND
INVALID_COMMAND_ID
INVALID_NAME
INVALID_ACCOUNT_TYPE
INVALID_SPENDABILITY
INVALID_LIQUIDITY
INVALID_CATEGORY_KIND
INVALID_STATUS_FILTER
ACCOUNT_NOT_FOUND
CATEGORY_NOT_FOUND
ACCOUNT_NAME_CONFLICT
CATEGORY_NAME_CONFLICT
RESOURCE_ARCHIVED
COMMAND_ID_REUSED
CATEGORY_PARENT_NOT_FOUND
CATEGORY_PARENT_ARCHIVED
CATEGORY_PARENT_KIND_MISMATCH
CATEGORY_SELF_PARENT
CATEGORY_MAX_DEPTH
CATEGORY_REPARENTING_FORBIDDEN
CATEGORY_HAS_ACTIVE_CHILDREN
```

IDs ausentes ou pertencentes a outro household resultam em
`ACCOUNT_NOT_FOUND`/`CATEGORY_NOT_FOUND`; não existe código de “outro tenant”.
O mapeamento HTTP recomendado é 401 para `UNAUTHENTICATED`, 400 para
validação, 404 para recurso inexistente e 409 para conflitos, nome duplicado,
recurso arquivado e reuso incompatível de command. Falhas inesperadas não são
parte deste envelope: seguem para a observabilidade do S01 e recebem resposta
genérica.

Todo write registra `commandId` na mesma transação da alteração em
`application_commands`, com unicidade `(household_id, command_id)`. Um retry
com o mesmo household, operação e payload retorna o mesmo read model e não
duplica a alteração. Reusar o mesmo `commandId` para outra operação ou payload
retorna `COMMAND_ID_REUSED`. Um archive repetido com o mesmo command é sucesso
idempotente; um novo command contra recurso já arquivado retorna
`RESOURCE_ARCHIVED` sem escrever.

Para distinguir retry do reuso incompatível, a implementação deve comparar a
operação e uma representação canônica do payload (por exemplo, um hash
persistido em `application_commands` ou equivalente transacional). O detalhe
da coluna auxiliar fica para T02, mas não se aceita tratar todo reuso como
sucesso silencioso.

### 9. Consequências para as tasks seguintes

- T02 deve aplicar FKs/constraints e `ON DELETE RESTRICT`, incluindo a FK
  composta de categoria para seu pai no mesmo household, sem `balance`.
- T03 deve centralizar os enums, a normalização de nomes, os schemas Zod e os
  invariantes deste documento; client e servidor usam o mesmo contrato.
- T04 deve manter o filtro `household_id` em toda leitura/escrita e não aceitar
  tenant como input confiável.
- T05/T06 devem tratar os commands como use cases explícitos, com `Result`,
  transação do use case e idempotência.
- T07/T08/T09 devem expor somente os campos editáveis e filtrar arquivados
  por padrão.
- T10/T11 devem cobrir, no mínimo, todos os códigos/invariantes acima e a
  negativa cross-tenant.

## Decisão de escopo

Este ADR fecha as decisões abertas da T01. Ele não implementa schema,
validação, repositório, Server Action, UI ou teste; essas entregas continuam
nas tasks correspondentes. Qualquer alteração deste contrato deve atualizar
este ADR e a task dependente antes de alterar migrations ou payloads.
