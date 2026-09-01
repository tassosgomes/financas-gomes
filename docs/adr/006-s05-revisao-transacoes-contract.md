# ADR-006 — Contrato de revisão e organização das transações do S05

- **Status:** Aceito
- **Data:** 2026-08-30
- **Escopo:** T01 do slice S05 — Revisão e organização das transações
- **Dependências:** S03, S04, ADR-004 e ADR-005

## Contexto e decisão do gate

O S05 precisa colocar lançamentos manuais e importados na mesma fila de
trabalho sem transformar a palavra “transação” em uma nova fonte de verdade.
Esta ADR fecha o contrato consumido por T02–T13: quais eventos entram na
fila, como a pendência é calculada, quais dados de origem permanecem
consultáveis, que campos podem ser editados, como a leitura é filtrada e
paginada e como o update é idempotente.

A fonte canônica continua sendo o ledger de S03:

- `financial_events` é o fato econômico, com valor absoluto;
- `account_entries` é o efeito assinado em uma conta;
- `transaction_imports` e `transaction_import_items` são apenas o lote e a
  linhagem de S04;
- `application_commands` é a tabela compartilhada de idempotência.

Não será criada tabela física `transactions`, coluna `accounts.balance`,
saldo materializado ou uma segunda linhagem de importação. “Transação” é o
nome de produto/read model para a composição dessas relações.

O contexto é resolvido por `requireFinancialContext()`/`withFinancialContext()`
no servidor. `householdId` pode aparecer como dado informativo em um read
model legado, mas nunca é aceito como autoridade de query ou command.

## Evidências de dependência e estado atual

A inspeção do worktree confirmou:

- [`src/db/financial-events-schema.ts`](../../src/db/financial-events-schema.ts)
  já declara `financial_events`, `account_entries`, os enums
  `MANUAL`/`SYSTEM`/`IMPORT`, FKs compostas tenant-safe e a relação de
  reversal;
- [`src/db/transaction-imports-schema.ts`](../../src/db/transaction-imports-schema.ts)
  já declara `transaction_imports`, staging e
  `transaction_import_items`, incluindo `importId`, `rowNumber`,
  `externalId` e `financialEventId`, sem guardar CSV bruto no lote;
- [`src/modules/transaction-imports/confirmation-use-cases.ts`](../../src/modules/transaction-imports/confirmation-use-cases.ts)
  cria eventos `origin=IMPORT` e itens de linhagem na confirmação atômica;
- [`src/modules/transactions/contracts.ts`](../../src/modules/transactions/contracts.ts),
  [`reads.ts`](../../src/modules/transactions/reads.ts) e
  [`use-cases.ts`](../../src/modules/transactions/use-cases.ts) ainda
  entregam o contrato de S03: listagem `MANUAL`, sem cursor/review/source
  unificados, e update restrito a evento manual;
- [`src/modules/households/context.ts`](../../src/modules/households/context.ts)
  e [`docs/tenancy.md`](../../docs/tenancy.md) confirmam que o household é
  derivado da sessão/membership e que IDs de outro household são opacos.

Essas evidências permitem reutilizar o ledger e a linhagem existentes, mas
não significam que o S05 já esteja implementado. T02–T13 continuam
responsáveis por materializar este contrato.

## 1. Conjunto da fila e estado de revisão

A coleção principal aceita somente eventos econômicos que satisfaçam todos os
predicados abaixo:

```sql
kind IN ('EXPENSE', 'INCOME')
AND origin IN ('MANUAL', 'IMPORT')
AND household_id = <household derivado do contexto>
```

O evento deve ser acompanhado de exatamente um `account_entries` tenant-safe.
`REVERSAL` e `SYSTEM` não são itens independentes da fila. Um reversal pode
continuar exposto como relação/histórico do evento original no detalhe, de
acordo com o contrato de S03.

Os status `POSTED` e `CANCELLED` são consultáveis. O filtro de status omitido
equivale a `ALL`; cancelados não entram na fila de pendências, mas continuam
filtráveis/detalháveis. A confirmação de S04 cria eventos `POSTED` e não há
operação S05 para cancelar uma importação.

O estado é uma projeção determinística do próprio evento, usada igualmente
por item, filtro e resumo:

```text
if status = CANCELLED:
  reviewState = NOT_APPLICABLE
  reviewReason = null
  needsReview = false
else if status = POSTED and category_id is null:
  reviewState = NEEDS_REVIEW
  reviewReason = UNCATEGORIZED
  needsReview = true
else if status = POSTED and category_id is not null:
  reviewState = ORGANIZED
  reviewReason = null
  needsReview = false
```

O contrato desta versão não infere pendência por origem, descrição, conta ou
status da categoria. Categoria arquivada continua sendo uma classificação
histórica e, portanto, mantém `ORGANIZED`; ela não é removida
automaticamente. `review=NEEDS_REVIEW` é exatamente `POSTED` + `category_id
IS NULL`, e não um cálculo feito pela UI.

## 2. Origem e linhagem imutáveis

O read model expõe `origin` somente como `MANUAL` ou `IMPORT` e inclui a
origem estruturada abaixo:

```ts
type ReviewableTransactionOrigin = "MANUAL" | "IMPORT";

type TransactionSource =
  | { origin: "MANUAL"; import: null }
  | {
      origin: "IMPORT";
      import: {
        importId: string;
        rowNumber: number;
        externalId: string | null;
      };
    };
```

Para `IMPORT`, a leitura deve fazer join com
`transaction_import_items` e `transaction_imports`, repetindo o predicado
`household_id` em todas as relações. O evento importado deve ter exatamente um
item; T03 deve garantir isso com unicidade tenant-safe em
`(household_id, financial_event_id)`. A unicidade já existente de
`(import_id, row_number)` evita duas linhas no mesmo lote, mas não substitui a
garantia por evento.

Para `MANUAL`, `source.import` é sempre `null`; não se fabrica linhagem para
um lançamento digitado. Se um evento `IMPORT` não tiver uma linhagem válida,
a leitura/update falha fechado com `IMPORT_LINEAGE_INVALID`; nunca converte o
evento em manual para preencher a resposta.

`importId`, `rowNumber` e `externalId` são metadata de origem somente leitura.
Não entram no command de update. O read model não expõe token, hash de token,
fingerprint, `candidateRows`, bytes, arquivo CSV, linhas inválidas ou o nome
do arquivo. O S04 não reteve a descrição bruta separadamente: a
`description` exibida é a descrição corrente do `financial_events`, e sua
edição não promete restauração do valor original do CSV.

## 3. Read models serializáveis

Os tipos abaixo são a forma canônica de S05 na boundary. Todos os IDs e
valores monetários são strings; `bigint`, `Date`, `Temporal` e records do ORM
não atravessam React/Next.

```ts
type TransactionReviewState =
  | "NEEDS_REVIEW"
  | "ORGANIZED"
  | "NOT_APPLICABLE";

type TransactionReviewReason = "UNCATEGORIZED" | null;

interface TransactionEntryReadModel {
  id: string;
  amountCents: string; // assinado: despesa negativa, receita positiva
  status: "POSTED";
  postedOn: string; // YYYY-MM-DD
}

interface TransactionListItemReadModel {
  id: string;
  householdId: string; // dado legado/informativo; nunca autoridade
  kind: "EXPENSE" | "INCOME";
  status: "POSTED" | "CANCELLED";
  origin: "MANUAL" | "IMPORT";
  amountCents: string; // absoluto no evento
  occurredOn: string; // YYYY-MM-DD
  description: string;
  accountId: string;
  categoryId: string | null;
  account: AccountReadModel;
  category: CategoryReadModel | null;
  entry: TransactionEntryReadModel;
  source: TransactionSource;
  reviewState: TransactionReviewState;
  reviewReason: TransactionReviewReason;
  needsReview: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

interface TransactionDetailReadModel extends TransactionListItemReadModel {
  reversal: {
    id: string;
    amountCents: string;
    origin: "SYSTEM";
    status: "POSTED";
    occurredOn: string;
  } | null;
}

interface TransactionListReadModel {
  items: TransactionListItemReadModel[];
  pageInfo: {
    hasNextPage: boolean;
    nextCursor: string | null;
  };
}

interface TransactionReviewSummaryReadModel {
  needsReviewCount: number;
}
```

`needsReview` é somente uma conveniência derivada no mesmo projection que
`reviewState`; os dois campos não podem divergir. O `entry` é o efeito
assinado e o `amountCents` do evento continua absoluto, conforme ADR-004/005.
Uma lista nunca apresenta reversal como outro item. O detalhe pode apresentar
a relação histórica de S03 sem transformar o reversal em transação revisável.

O detalhe por ID aceita apenas o mesmo conjunto de eventos econômicos da
fila. ID inválido, inexistente ou pertencente a outro household resulta em
`EVENT_NOT_FOUND`, sem retornar origem, categoria, conta ou linhagem.

## 4. Query pública, filtros e limites

O contrato serializável é:

```ts
interface ListReviewableTransactionsQuery {
  from?: string; // intervalo inclusivo de occurredOn
  to?: string;   // intervalo inclusivo de occurredOn
  accountId?: string;
  categoryId?: string | null;
  kind?: "EXPENSE" | "INCOME";
  status?: "POSTED" | "CANCELLED" | "ALL";
  origin?: "MANUAL" | "IMPORT" | "ALL";
  review?: "NEEDS_REVIEW" | "ORGANIZED" | "ALL";
  search?: string;
  limit?: number;
  cursor?: string;
}
```

Regras de normalização:

- `from` e `to` são datas civis `YYYY-MM-DD`, inclusivas, e `from > to` é
  `INVALID_QUERY`. A boundary pode aceitar aliases legados de S03
  (`occurredOnFrom`, `occurredOnTo`, `dateFrom`, `dateTo`, `startDate`,
  `endDate`, `effectiveDateFrom`, `effectiveDateTo`, `periodStart`,
  `periodEnd`, `period.from` e `period.to`) somente para canonicalizá-los em
  `from`/`to`; aliases conflitantes são inválidos;
- `accountId` e um `categoryId` não nulo precisam ser UUIDv7 válidos e são
  revalidados no household do contexto. Ausente/cross-tenant resulta,
  respectivamente, em `ACCOUNT_NOT_FOUND`/`CATEGORY_NOT_FOUND`, sem revelar
  existência. Categoria arquivada é um filtro de histórico válido;
- `categoryId: null` é uma instrução explícita de “sem categoria”. Na URL, a
  representação canônica é `categoryId=__none`; a string literal `"null"` não
  significa NULL;
- `kind` só aceita `EXPENSE`/`INCOME`. `status`, `origin` e `review` aceitam
  os valores acima; `ALL` é normalizado para ausência de predicado. O padrão
  é `status=ALL`, `origin=ALL` e `review=ALL`;
- `search` é opcional. Quando presente, recebe NFKC, trim e limite de 120
  code points, não pode ser vazio nem conter `Cc`/`Cf`, e é usado como trecho
  case-insensitive da `description` corrente. `%`, `_` e demais curingas são
  tratados como texto literal. Não pesquisa `externalId`, IDs, nome de
  conta/categoria, fingerprint ou CSV;
- `limit` é inteiro de 1 a 100, com default 50. Valores ausentes ou inválidos
  não são ampliados silenciosamente; um limite inválido resulta em
  `INVALID_QUERY`;
- chaves desconhecidas, valores não escalares, arrays inesperados e aliases
  conflitantes resultam em `INVALID_QUERY`. Query recebida da URL é sempre
  entrada não confiável e nunca contém `householdId` como filtro aceito.

Todos os filtros são combinados por AND. `review=NEEDS_REVIEW` e
`review=ORGANIZED` aplicam os predicados da seção 1; com um status/categoria
incompatível o resultado é simplesmente vazio, sem uma regra paralela de
fallback. A ausência de filtros não remove o predicado de household, origem
ou tipo.

O resumo é uma leitura separada:
`getTransactionReviewSummary(filters?)` recebe os mesmos filtros não
relacionados à paginação (`from`, `to`, `accountId`, `categoryId`, `kind`,
`status`, `origin` e `search`), aplica a definição exata de `NEEDS_REVIEW` e
ignora `review`, `limit` e `cursor`. Sem filtros, conta todas as pendências do
household; com filtros, conta a interseção correspondente. Assim o contador
concorda com a fila e nunca é calculado somente sobre a página carregada.

## 5. Ordenação e cursor

A ordenação única da coleção é:

```sql
ORDER BY financial_events.occurred_on DESC, financial_events.id DESC
```

O cursor é opaco para o consumidor, versionado e serializado como
`base64url` sem padding do JSON canônico abaixo:

```ts
interface ReviewCursorV1 {
  v: 1;
  occurredOn: string; // YYYY-MM-DD do último item retornado
  id: string;         // UUIDv7 do último item retornado
  filterHash: string;  // SHA-256 hex do filtro efetivo + limit
  limit: number;
}
```

O JSON usa chaves ordenadas, UTF-8 e somente esses campos; o cursor não é
autorização nem substitui o predicado de `household_id`. O hash é SHA-256 da
representação canônica dos filtros efetivos, incluindo defaults e `limit`,
mas excluindo `cursor` e qualquer `householdId`. Aliases já normalizados não
produzem hashes diferentes. O servidor rejeita cursor maior que 512 bytes,
versão/campos extras, base64 inválido, data/UUID/hash/limite inválidos ou
`filterHash` diferente da query atual com `INVALID_CURSOR`.

Cada página busca `limit + 1`. O item extra somente define
`hasNextPage=true`; a resposta contém no máximo `limit` itens e cria
`nextCursor` com o último item retornado. A continuação aplica o predicado
keyset equivalente a:

```sql
(occurred_on, id) < (:cursorOccurredOn, :cursorId)
```

O cursor pode ser adulterado para pular posições, mas nunca concede acesso a
outro household: toda execução repete os predicados de tenancy e de origem.
Ele não deve ser decodificado ou registrado em logs de produção.

## 6. Update revisável e fields mutáveis

O command canônico é:

```ts
interface UpdateReviewableTransactionCommand {
  commandId: string;
  financialEventId: string;
  description?: string;
  categoryId?: string | null;
}
```

O command deve conter pelo menos um dos dois campos editáveis. `description`
usa a normalização de S03 (NFKC, trim, whitespace interno colapsado, 1–240
code points, sem controles/formatação). `categoryId: null` remove a
classificação e, se o evento estiver `POSTED`, faz o estado voltar a
`NEEDS_REVIEW`. Categoria não nula deve ser `ACTIVE`, do mesmo household e do
mesmo `kind` do evento. Categoria arquivada ou incompatível falha sem escrita.

O alvo é carregado e lockado dentro da transaction e precisa ser um evento
`POSTED`, de `kind=EXPENSE|INCOME` e `origin=MANUAL|IMPORT`. Evento
`CANCELLED`, `REVERSAL`, `SYSTEM` ou com linhagem de importação inválida não é
revisável. Para `IMPORT`, a linhagem é revalidada antes de atualizar somente o
evento.

São proibidos no command e rejeitados, não ignorados silenciosamente:

```text
householdId, origin, source, kind, status, amountCents, occurredOn,
accountId, entry, reversal, reversalOfEventId, importId, rowNumber,
externalId, token, fingerprint, CSV, createdAt, updatedAt
```

O único update persistido é `financial_events.description`,
`financial_events.category_id` e `updated_at`. Nunca se toca em valor,
data, conta, entry, status, origem, lote, item, linha ou external ID; não há
recriação do evento nem hard delete.

O nome da operação canônica é:

```text
transactions.review.update
```

As funções/ações públicas legadas de S03 (`UpdateManualTransaction`,
`updateManualTransaction` e o alias `transactions.update.manual`) permanecem
somente para compatibilidade de nomes. Elas delegam ao mesmo contrato, não
aceitam campos adicionais, não recebem origem e não autorizam `SYSTEM` ou
`REVERSAL`; novos writes usam `transactions.review.update`. Para commands
legados já persistidos, a reserva pode reconhecer `transactions.update.manual`
como alias compatível somente quando o payload canônico for idêntico; outro
payload/operação é `COMMAND_ID_REUSED`.

## 7. Transaction, idempotência e erros

O update usa uma única transaction PostgreSQL:

1. a boundary valida o command serializável;
2. o use case deriva o household do `FinancialContext` e reserva
   `(household_id, commandId)` em `application_commands`;
3. o evento é lockado e a categoria/linhagem são revalidadas;
4. somente metadata permitida é atualizada;
5. a resposta é reidratada por `resourceId=financialEventId` com predicados
   tenant-safe antes do commit.

O hash canônico inclui a operação canônica e os campos efetivos normalizados
do command, em ordem determinística, sem `commandId`, `householdId`, origem
derivada ou payload financeiro fora do command. Para o mesmo
`(household_id, commandId)` e o mesmo hash, retry não cria outro command,
evento ou entry e retorna o read model tenant-scoped do recurso. Operação ou
payload diferente retorna `COMMAND_ID_REUSED` sem alterar dados. O mesmo
`commandId` em households distintos é independente. O read model financeiro
não é salvo em `application_commands.result`; a reidratação por resource ID
segue o padrão atual de S03 e evita duplicar payload financeiro na tabela de
idempotência.

O envelope segue `Result<T, E>` de S03. Códigos compartilhados mantêm a
semântica e mensagens existentes; os adicionais de S05 são:

```text
UNAUTHENTICATED
HOUSEHOLD_MEMBERSHIP_REQUIRED
HOUSEHOLD_SELECTION_REQUIRED
INVALID_FINANCIAL_CONTEXT
INVALID_QUERY
INVALID_CURSOR
ACCOUNT_NOT_FOUND
CATEGORY_NOT_FOUND
EVENT_NOT_FOUND
EVENT_NOT_REVIEWABLE
IMPORT_LINEAGE_INVALID
INVALID_COMMAND
INVALID_COMMAND_ID
RESOURCE_ARCHIVED
CATEGORY_KIND_MISMATCH
NON_EDITABLE_FIELD
COMMAND_ID_REUSED
```

`INVALID_QUERY` cobre filtro desconhecido/malformado, data invertida, limite,
status/origin/review/kind inválidos e busca inválida; `INVALID_CURSOR` é
reservado para framing, hash ou posição incompatíveis. IDs de evento,
conta/categoria inexistentes ou de outro household usam os códigos
`*_NOT_FOUND` genéricos e não revelam se havia um registro. Contexto ausente
ou membership inválida usa os códigos já existentes de S01; não há um
`householdId` público nem um erro que confirme a existência de outro tenant.

Mapeamento recomendado: autenticação 401; contexto/membership conforme S01;
validação 400; `*_NOT_FOUND` 404; evento não revisável, categoria arquivada,
tipo incompatível, campo não editável e command reutilizado 409.
`IMPORT_LINEAGE_INVALID` é falha de integridade controlada e não inclui
detalhes de banco; falhas técnicas inesperadas não atravessam o envelope,
seguem T10/S01 e recebem resposta genérica.

Mensagens públicas não contêm SQL, stack trace, valor, descrição, busca,
nome de conta/categoria, external ID, token, CSV, fingerprint ou existência
de outro household.

## 8. Índices e integridade que T03 deve preservar

Sem alterar a fonte de verdade, T03 deve auditar e, se necessário, fornecer
os caminhos para:

- `financial_events` por `(household_id, origin, occurred_on, id)` para a
  coleção principal e por `(household_id, category_id, occurred_on, id)` para
  pendências/filtro de categoria;
- `account_entries` por `(household_id, financial_event_id)` e pelo caminho
  existente de conta/data;
- `transaction_import_items` por `(household_id, import_id, row_number)` e
  `(household_id, financial_event_id)`, com unique tenant-safe por evento;
- FKs compostas e `ON DELETE RESTRICT` para evento, conta, lote, item e
  household.

Busca textual não exige `pg_trgm` ou outro índice novo por contrato. T03/T11
devem decidir com `EXPLAIN (ANALYZE, BUFFERS)` em volume sintético se a busca
simples por descrição precisa de otimização; essa decisão não pode mudar o
shape, o escopo tenant ou a semântica do filtro.

## 9. Privacidade e observabilidade

T10 pode registrar somente operação/etapa, duração, código de erro, origem e
tipo agregados, tamanho da página, contagens agregadas, request ID e IDs
opacos aprovados. Não registra `search`, descrição, valor, nomes,
`externalId`, cursor decodificado, token, CSV ou payload do command. A
linhagem deve ser redigida junto com os demais dados financeiros.

## Handoff explícito para T02–T13

| Task | Handoff obrigatório desta ADR |
| --- | --- |
| **T02 — Modelo e contracts** | Criar `ReviewableTransactionOrigin`, `TransactionReviewState`/`Reason`, `TransactionSource`, read models, query, summary, command, limites e erros exatamente como acima. Manter aliases de S03 sem manter a lista `MANUAL`-only. Criar testes de schema para `null`, origem, review, limite e cursor. |
| **T03 — Linhagem/schema/índices** | Auditar as tabelas existentes; não criar `transactions`/`balance`; adicionar a unicidade tenant-safe de um item por evento importado se ausente, preservar FKs/`RESTRICT` e preparar os índices motivados para origem/data/ID, categoria, entry e linhagem. Aplicar migration serialmente e provar ausência de órfãos. |
| **T04 — Reads/filtros/paginação** | Generalizar os reads atuais para `MANUAL|IMPORT`, excluir `SYSTEM`/`REVERSAL`, executar joins tenant-safe, validar linhagem, aplicar filtros/`NEEDS_REVIEW`, busca limitada, resumo, keyset e cursor/hash; detalhe cross-tenant deve ser `EVENT_NOT_FOUND`. Nenhum N+1 na lista. |
| **T05 — Update revisável** | Implementar `UpdateReviewableTransaction` com `transactions.review.update`, lock e transaction única, somente `description`/`categoryId`, categoria ativa por tipo, linhagem importada revalidada, rejeição de campos extras e idempotência em `application_commands`. Manter aliases S03 sem aceitar `SYSTEM`/`REVERSAL`. |
| **T06 — Adapters/actions/cache** | Fazer `Zod → FinancialContext → use case`, receber somente query/command serializáveis, não aceitar tenant/origem/linhagem como autoridade, mapear erros, revalidar lista/detalhe/resumo somente após sucesso e preservar filtros/cursor. Integrar redaction de T10. |
| **T07 — UI contracts/components** | Canonicalizar `from/to`, conta, `categoryId=__none`, tipo, status, origem, review, busca, limite e cursor; preservar a query nos links; renderizar badges/source/review/summary e editor sem oferecer campos protegidos ou categoria incompatível. |
| **T08 — Lista/filtros/pendências** | Carregar lista e resumo do servidor em paralelo, mostrar manuais/importados no mesmo fluxo, usar `pageInfo`/`source`/`reviewState`, manter filtros na URL e integrar quick edit sem recriar evento nem calcular contador somente na página. |
| **T09 — Detalhe/edição/origem** | Usar o detalhe genérico para `MANUAL|IMPORT`, manter valor/data/conta/tipo/status/entry somente leitura, exibir apenas a linhagem permitida, permitir metadata/null e preservar o back link com filtros/cursor. Não criar cancelamento de importação. |
| **T10 — Observabilidade** | Instrumentar `transactions.review.list`, `.summary`, `.detail` e `.update` (ou equivalentes), separar expected error de falha técnica e aplicar a allow-list desta ADR sem registrar conteúdo financeiro ou cursor decodificado. |
| **T11 — Unit/integration/performance** | Cobrir estado/summary, origem/linhagem, filtros combinados, null, cursor/data empatada, isolamento, update manual/importado, rollback/idempotência, campos proibidos e regressão S03/S04; semear volume sintético e registrar `EXPLAIN`/medição sem dados reais. |
| **T12 — E2E** | Executar importação S04 → filtro `NEEDS_REVIEW` → classificação → origem/linhagem → edição de descrição → retorno com query/cursor, além de manual/importado, erro, retry e viewport móvel; não depender de inserção administrativa para criar a pendência principal. |
| **T13 — Release** | Revalidar este gate, migration/órfãos, lint/typecheck/testes/build/E2E, smoke publicado, regressão S03/S04, isolamento, idempotência, redaction, performance, rollout/rollback e retenção antes de fechar o slice. |

Qualquer mudança em elegibilidade, estado, origem/linhagem, campos editáveis,
limites, cursor, shape, operação, idempotência ou códigos de erro exige
atualizar esta ADR e a T01 antes de alterar schema, reads, commands, actions
ou UI.

## Consequências

- A fila apresenta o mesmo fato econômico para lançamentos manuais e
  importados, mas nunca trata reversal/system como transação revisável.
- A classificação pode ser corrigida sem tocar no ledger ou apagar a
  proveniência do S04; retirar categoria de um evento POSTED o devolve à fila.
- O contrato de descrição importada reflete a limitação real do S04: não há
  snapshot separado da descrição bruta para restauração.
- A paginação é estável e limitada por keyset, mas a busca textual permanece
  deliberadamente simples até evidência de performance justificar índice.
- O read model é uma composição de tabelas existentes; nenhum consumidor
  deve persistir uma entidade `transactions` paralela.
