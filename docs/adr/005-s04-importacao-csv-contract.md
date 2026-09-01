# ADR-005 — Contrato CSV e decisões de importação do S04

- **Status:** Aceito
- **Data:** 2026-08-30
- **Escopo:** T01 do slice S04 — Importação de extrato CSV
- **Dependências:** S01, S02, S03, ADR-001, ADR-003 e ADR-004

## Contexto e precedência

O S04 permite trazer para o produto um extrato que já foi normalizado pelo
usuário. A TechSpec, na seção 98, diz que não haverá pipeline genérica de
importação CSV na V1. Esta ADR é a decisão posterior e deliberada que abre
uma exceção **somente** para o formato canônico documentado abaixo. Ela não
abre suporte a layouts bancários, OFX, Open Finance, reconciliação ou
categorização automática.

Esta ADR é normativa para T02–T13. Quando houver conflito entre a redação
genérica da TechSpec e este contrato, a exceção vale apenas dentro dos limites
do CSV `s04-csv-v1`; as demais decisões da TechSpec continuam valendo. A
ADR-004 continua sendo a fonte de verdade para o ledger e para as invariantes
de S03.

## Gate de dependências e fronteiras

O S04 reutiliza os contratos já fechados:

- S01 resolve `FinancialContext` com `requireFinancialContext()` a partir da
  sessão e da membership. `household_id` nunca é autoridade recebida do
  browser.
- S02 fornece `accounts` tenant-scoped. A conta escolhida no upload é uma
  seleção não confiável; o servidor confirma que ela pertence ao household
  resolvido, está `ACTIVE` e pode receber lançamentos.
- S03 fornece `FinancialEvent`, `AccountEntry`, `application_commands`, o
  `Money` inteiro, `PlainDate`, a âncora `tracking_started_on` e a listagem de
  transações. O S04 não cria uma tabela concorrente chamada `transactions`,
  não atualiza `accounts.balance` e não cria saldo materializado.

A aplicação pode expor `accountId`, `householdId` e a origem em um read model,
mas nenhum deles é aceito como autoridade na confirmação. A confirmação
recebe somente um `commandId` e um token de prévia; conta, household, linhas,
fingerprint, tipo, sinal e metadados são carregados e revalidados no servidor.

Para o S04, a origem de `FinancialEvent` ganha o valor `IMPORT`. A migration
que estender o enum de S03 deve também ajustar o check de forma do evento para
aceitar `origin=IMPORT` somente em eventos `INCOME` ou `EXPENSE`; eventos
`REVERSAL` continuam `origin=SYSTEM` e lançamentos manuais continuam
`origin=MANUAL`. Essa extensão não altera os comandos nem a semântica de S03.

## Decisão 1 — Formato canônico `s04-csv-v1`

O contrato é intencionalmente estrito para que um mesmo arquivo não admita
interpretações de locale, arredondamento ou encoding diferentes.

### Cabeçalho e colunas

O cabeçalho obrigatório é exatamente uma destas duas sequências, na ordem
indicada e sem colunas extras:

```csv
occurred_on,description,amount_cents
occurred_on,description,amount_cents,external_id
```

Os nomes são ASCII, case-sensitive e não recebem trim, tradução ou alias. A
coluna `external_id`, quando usada, deve ser a última. Cabeçalho com coluna
desconhecida, coluna repetida, coluna obrigatória ausente, outra ordem ou
delimitador diferente falha antes de qualquer linha virar candidata. Não há
coluna para conta, household, categoria, tags, tipo, status, origem ou sinal
de ledger.

### Encoding, bytes e registros

- A entrada precisa ser UTF-8 estrito. Bytes inválidos, NUL e conversão
  implícita de encoding são rejeitados; não se tenta adivinhar Windows-1252,
  ISO-8859-1 ou outro locale.
- Um único BOM UTF-8 (`EF BB BF`) no início do arquivo é aceito e removido
  antes de conferir o cabeçalho. BOM no meio do conteúdo ou mais de um BOM é
  inválido. `source_has_bom` pode ser guardado como metadado técnico.
- O delimitador é somente vírgula ASCII (`,`). Ponto e vírgula, tabulação e
  outros delimitadores não são aliases aceitos.
- São aceitos newline LF (`\n`) e CRLF (`\r\n`). Um CR isolado é inválido.
  O newline final é opcional. Não existem comentários nem linhas de
  continuação fora da gramática CSV.
- Aspas seguem a regra CSV RFC 4180: uma aspa envolve o campo completo e uma
  aspa literal é escrita como `""`. Vírgula, LF e CR dentro de campo citado
  são parseáveis; depois do parse, controles no valor tornam a linha inválida
  conforme as regras de campo. Aspas fora de campo citado, escape com barra ou
  texto depois da aspa de fechamento são erro estrutural. Espaços ao redor de
  campo não são descartados automaticamente.
- O limite do upload é **5 MiB (5 × 1024 × 1024 bytes)**, medido nos bytes
  recebidos, antes de remover BOM. O limite de dados é **10.000 registros**,
  sem contar o cabeçalho. O limite de um campo é **16 KiB** antes da
  normalização; a regra de code points de cada coluna também precisa ser
  respeitada.
- `rowNumber` é o número do registro lógico no arquivo: o cabeçalho é 1 e o
  primeiro registro de dados é 2. Um registro citado que contenha newline
  continua sendo uma única linha lógica e recebe o número do seu início.

Arquivo de zero bytes, somente BOM, somente espaços/newlines ou com cabeçalho
sem nenhum registro de dados falha como arquivo vazio (`CSV_EMPTY_FILE` ou
`CSV_NO_DATA_ROWS`). Um registro de dados com todos os campos vazios, quando
há outros registros, é uma linha processada e inválida (`CSV_EMPTY_ROW`). Uma
quebra de linha final não cria um registro vazio adicional.

### Campos e normalização

As transformações acontecem no servidor, antes de calcular o fingerprint.
Elas não tornam aceitável um valor que não pertença à gramática da coluna.

| Campo | Regra de entrada e saída canônica |
| --- | --- |
| `occurred_on` | String ASCII exatamente `YYYY-MM-DD`; calendário ISO válido via `Temporal.PlainDate` com overflow rejeitado. Não aceita `DD/MM/YYYY`, ano estendido, hora, timezone ou espaços. Não pode ser posterior à data de negócio do servidor. Também não pode preceder `accounts.tracking_started_on`. |
| `description` | NFKC, trim nas extremidades e colapso de whitespace interno para um espaço, igual à normalização de S03. Deve ter de 1 a 240 code points depois da normalização e não pode conter caracteres de controle/formatação (`Cc`/`Cf`), inclusive LF, CR ou NUL. |
| `amount_cents` | ASCII `^[+-]?[0-9]+$`, sem separador de milhar, moeda, vírgula decimal, ponto decimal ou espaços. É convertido diretamente para `bigint`, nunca para `Number`/float. Zero, inclusive `0`, `+0` e `-0`, é rejeitado. O módulo deve rejeitar magnitude maior que `9223372036854775807` (limite de `BIGINT`). A saída remove zeros à esquerda e normaliza `+0005` para `5` e `-0005` para `-5`. |
| `external_id` | Coluna opcional. Campo vazio equivale a `null`; quando presente, NFKC + trim, de 1 a 128 code points, sem `Cc`/`Cf`. Preserva maiúsculas/minúsculas e whitespace interno. Não é chave única e não causa deduplicação de linhas. |

Os valores `occurred_on`, descrição e centavos normalizados que formam uma
candidata são serializáveis como strings; `bigint`, `Date`, `Temporal` e
objetos Drizzle não atravessam a boundary React/Next. Um `amount_cents`
positivo representa receita; negativo representa despesa. O sinal nunca é
recalculado a partir de uma moeda formatada na UI.

Exemplo válido, incluindo uma descrição citada:

```csv
occurred_on,description,amount_cents,external_id
2026-08-29,"Salário, mês 08",125000,sal-2026-08
2026-08-30,Café,-1875,
```

Exemplos que devem falhar de forma determinística:

```csv
# data brasileira: CSV_INVALID_DATE
29/08/2026,Salário,125000

# locale/moeda/float: CSV_INVALID_AMOUNT
2026-08-29,Almoço,"R$ 12,50"

# decimal: CSV_INVALID_AMOUNT
2026-08-29,Almoço,12.50

# zero: CSV_ZERO_AMOUNT
2026-08-29,Ajuste,0

# cabeçalho não canônico/locale: CSV_INVALID_HEADER ou CSV_INVALID_DELIMITER
data;descricao;valor
```

Linhas iguais são mantidas como linhas distintas. Duas ocorrências de
`2026-08-30,Café,-1875` no mesmo arquivo produzem duas candidatas e, se o
arquivo for confirmado, dois eventos legítimos. O contrato não faz
deduplicação global por descrição, data, valor ou `external_id`.

## Decisão 2 — Mapeamento para o ledger de S03

Para cada candidata válida, o servidor cria, na mesma transaction, um
`FinancialEvent` e um `AccountEntry`:

| Valor CSV | `FinancialEvent` | `AccountEntry` |
| --- | --- | --- |
| `amount_cents > 0` | `kind=INCOME`, `status=POSTED`, `origin=IMPORT`, `amount_cents` absoluto | um entry na conta escolhida, `status=POSTED`, `amount_cents` positivo, `posted_on=occurred_on`, `expected_on=NULL` |
| `amount_cents < 0` | `kind=EXPENSE`, `status=POSTED`, `origin=IMPORT`, `amount_cents` absoluto | um entry na conta escolhida, `status=POSTED`, `amount_cents` negativo, `posted_on=occurred_on`, `expected_on=NULL` |

O `description` e `occurred_on` normalizados vão para o evento. Categoria e
tags ficam `NULL`/ausentes nesta V1; não há inferência por texto. Cada linha
válida cria exatamente um evento e um entry, e nenhum entry pode existir sem
seu evento. O valor do evento é sempre positivo; o efeito assinado pertence
ao entry. A conta e o household usados são os revalidados no servidor.

`external_id` é apenas metadata de origem. Ele deve ser preservado na
linhagem da importação (item/metadata vinculado ao lote e ao evento), sem
virar chave global ou regra de idempotência de linha.

## Decisão 3 — Estratégia parcial e fluxo de preview/confirm

A estratégia é **parcial explícita por linha e atômica por lote**:

1. Erro estrutural de bytes, encoding, cabeçalho, quoting, limite ou arquivo
   vazio aborta o parse; nenhuma candidata, prévia confirmável ou transação
   financeira é criada.
2. Erros de uma linha não impedem o parse das demais. A prévia mostra linhas
   válidas e erros com número de linha/campo/código/mensagem acionável.
3. Na confirmação, linhas inválidas são excluídas e permanecem no relatório.
   Todas as linhas válidas são persistidas em uma única transaction; não há
   lote parcialmente persistido.
4. Falha de banco, constraint ou infraestrutura faz rollback do lote, de
   todos os eventos/entries/items e do command. O token permanece não
   consumido até o commit, de modo que um retry seguro possa tentar novamente
   enquanto ainda estiver dentro da validade.
5. Prévia com zero linhas válidas não recebe token confirmável e não grava
   lote. O relatório ainda pode mostrar as linhas inválidas para correção do
   arquivo.

O upload/preview recebe `accountId` e o arquivo somente como entrada não
confiável. A action resolve o contexto, aplica apenas o limite bruto de bytes
e valida a conta ativa dentro desse household **antes de fazer parsing ou
persistir staging**. Depois parseia, valida a âncora temporal em cada
candidata e calcula as candidatas/fingerprint. O servidor pode revalidar a
data futura, a conta e a âncora durante a confirmação, pois a conta pode ter
sido arquivada ou alterada depois da prévia.

O command de confirmação é estrito:

```ts
interface ConfirmTransactionImportCommand {
  commandId: string;
  previewToken: string;
}
```

`previewToken` é uma string opaca, aleatória e de uso único. O servidor guarda
somente `sha256(token)` no staging, vinculado a `household_id`, `account_id`,
fingerprint e candidatos normalizados. O token expira **15 minutos** após a
criação da prévia. Expiração e consumo são verificados com o relógio do
servidor; outro household recebe `PREVIEW_NOT_FOUND`, sem indicação de que o
token existe. Um membro diferente do mesmo household pode confirmar, pois a
V1 não tem permissões por usuário.

O token só é marcado como consumido na mesma transaction que cria o lote e o
ledger. Um retry com o mesmo `commandId` depois do commit retorna o resultado
original através de `application_commands`; um retry com outro command para o
token já consumido recebe `PREVIEW_ALREADY_CONSUMED`. Um token expirado não
volta a ser válido.

## Decisão 4 — Fingerprint e reimportação

O fingerprint é `SHA-256` em hexadecimal minúsculo do **multiconjunto de
candidatas válidas normalizadas**, não do arquivo bruto. Para cada candidata,
usa-se uma codificação sem ambiguidade com os campos na ordem
`occurred_on`, `description`, `signed_amount_cents`, `external_id` (um marcador
explícito para `null`); cada campo é prefixado pelo tamanho em bytes. Os itens
são ordenados lexicograficamente pela representação canônica antes do hash.
Assim:

- a ordem das linhas não muda o fingerprint;
- duplicidade de uma linha é preservada pela multiplicidade e altera o hash;
- BOM, CRLF/LF, zeros à esquerda do valor e diferenças de whitespace que a
  normalização resolve não criam fingerprints distintos;
- uma coluna/linha inválida extra não vira evento, mas um arquivo com as
  mesmas candidatas válidas continua sendo o mesmo conjunto efetivo e não
  pode duplicar os eventos.

O fingerprint é escopado por `(household_id, account_id)`. A persistência deve
ter índice/constraint unique para esse trio entre lotes `CONFIRMED`, além de
predicados tenant-scoped em toda leitura. O índice pode ser parcial por status
para que prévias expiradas não reservem o conjunto.

Na prévia, um fingerprint já confirmado para a mesma conta aparece como
`ALREADY_IMPORTED` e a confirmação fica bloqueada. Se a corrida ocorrer entre
prévia e confirmação, a constraint do banco vence a corrida e a resposta é o
mesmo conflito, sem novos eventos.

Não existe `force`, `allowDuplicate` ou reimportação intencional no contrato
V1. Para importar novamente de propósito, o usuário precisa produzir um
conjunto semanticamente diferente ou aguardar uma decisão futura explícita;
um adapter não pode contornar o índice alterando o fingerprint. Essa escolha
protege contra duplicação silenciosa e mantém clara a diferença entre:

- **linhas idênticas legítimas no mesmo arquivo:** cada ocorrência é
  persistida;
- **o mesmo multiconjunto confirmado novamente para a mesma conta:** todo o
  conjunto é rejeitado como duplicado, sem criar eventos.

O mesmo arquivo pode ser importado para outra conta ou em outro household,
pois o escopo do fingerprint muda; nenhuma dessas operações revela lote de
outro household.

## Decisão 5 — Entidades, vínculos e retenção

As entidades lógicas são estas; T02 pode escolher JSONB ou tabelas de staging
para a prévia, desde que preserve exatamente os vínculos e a retenção abaixo.

### Lote confirmado — `transaction_imports`

Um lote só é criado dentro da transaction de confirmação e só fica
`CONFIRMED` quando todos os eventos/entries válidos também foram confirmados.
O mínimo persistido é:

| Campo | Regra |
| --- | --- |
| `id` | UUIDv7, gerado pelo ponto único de S01 |
| `household_id` | Obrigatório, derivado da sessão; FK para `households` |
| `account_id` | Conta escolhida e revalidada; FK composta `(account_id, household_id)` |
| `initiated_by_user_id` | Opcional para contexto operacional; não participa de autorização |
| `format_version` | `s04-csv-v1` |
| `dataset_fingerprint` | SHA-256 canônico, 64 hex minúsculos |
| `source_file_size_bytes` | Tamanho limitado do upload; metadata técnica |
| `source_has_bom` | Booleano técnico |
| `source_columns` | `BASE` ou `WITH_EXTERNAL_ID` |
| `processed_rows`, `valid_rows`, `invalid_rows`, `ignored_duplicate_rows`, `imported_rows` | Contagens do contrato abaixo; não podem ser negativas e devem obedecer às invariantes de contagem |
| `status` | `CONFIRMED` para lote persistido; não se registra lote meio confirmado |
| `created_at`, `confirmed_at` | Timestamps técnicos do servidor |

O lote não guarda filename original, MIME como autoridade, bytes do arquivo,
payload JSON bruto ou conteúdo de linhas inválidas. O nome do arquivo pode ser
usado durante a requisição para feedback transitório, mas não é exibido nem
retido como metadata do lote.

Cada candidata válida precisa de uma linhagem tenant-safe para o lote, o
`rowNumber`, o `external_id` opcional e o `financial_event_id` criado. Essa
linhagem pode ser uma tabela `transaction_import_items` ou metadata equivalente,
mas deve possuir FK composta com o household, unicidade de `(import_id,
row_number)` e índice para consultar o lote sem varrer o ledger. O evento
importado deve ser identificável por essa relação e por `origin=IMPORT`; a
linhagem não é uma fonte de verdade paralela para valor, saldo ou descrição.

### Prévia/staging

O servidor guarda, enquanto o token estiver vivo, somente:

- hash do token, household, conta, fingerprint, versão, limites/metadata
  técnico e `expires_at`;
- candidatas válidas normalizadas necessárias para confirmação;
- erros sanitizados por linha (número, código, campo e mensagem), sem o valor
  bruto que falhou.

O staging deve ter índice unique por `(household_id, token_hash)` e índice por
`(household_id, expires_at)`. Todas as FKs e queries carregam
`household_id`; um identificador conhecido de outro household se comporta
como inexistente. O conteúdo de staging é apagado após confirmação ou
expiração, preferencialmente imediatamente e, no máximo, pelo job de limpeza
seguinte em 24 horas. Não se retém arquivo bruto para viabilizar retry.

Após a confirmação, o lote retém o resumo e erros sanitizados por linha para
o relatório auditável. O ledger continua sendo a fonte dos dados financeiros;
o lote guarda apenas a origem/linhagem e o resultado do processamento.

Índices mínimos adicionais são:

- `(household_id, account_id, created_at)` em `transaction_imports`;
- unique parcial `(household_id, account_id, dataset_fingerprint)` para
  `status=CONFIRMED`;
- `(household_id, import_id, row_number)` e `(household_id, financial_event_id)`
  na linhagem;
- `(household_id, token_hash)` e `(household_id, expires_at)` no staging.

Foreign keys compostas e `ON DELETE RESTRICT` devem impedir associação de
conta, evento, item ou lote a outro household e preservar a origem histórica.

## Decisão 6 — Contratos de preview, resultado e contagens

Os nomes abaixo são contratos de boundary; os tipos internos podem usar
`bigint`/`Temporal`, mas a resposta usa somente valores serializáveis.

```ts
type CsvImportDuplicateStatus = "NEW" | "ALREADY_IMPORTED";

interface CsvImportCounts {
  processed: number;
  valid: number;
  invalid: number;
  ignoredDuplicate: number;
  imported: number;
}

interface CsvImportPreviewRow {
  rowNumber: number;
  occurredOn: string;
  description: string;
  signedAmountCents: string;
  kind: "INCOME" | "EXPENSE";
  externalId: string | null;
}

interface CsvImportRowError {
  rowNumber: number;
  code: CsvImportErrorCode;
  field?: "occurredOn" | "description" | "amountCents" | "externalId";
  message: string;
}

interface CsvImportPreview {
  formatVersion: "s04-csv-v1";
  previewToken: string;
  expiresAt: string;
  accountId: string; // dado exibido, nunca autoridade na confirmação
  duplicateStatus: CsvImportDuplicateStatus;
  existingImportId: string | null; // somente lote do mesmo household/conta
  counts: CsvImportCounts;
  rows: CsvImportPreviewRow[];
  errors: CsvImportRowError[];
}

interface ConfirmedCsvImportResult {
  status: "IMPORTED";
  importId: string;
  accountId: string;
  counts: CsvImportCounts;
  errors: CsvImportRowError[];
}

interface DuplicateCsvImportResult {
  status: "DUPLICATE_DATASET";
  existingImportId: string;
  accountId: string;
  counts: CsvImportCounts;
  errors: CsvImportRowError[];
}

type CsvImportConfirmationResult =
  | ConfirmedCsvImportResult
  | DuplicateCsvImportResult;
```

Para uma confirmação nova sem duplicidade, `processed = valid + invalid`,
`ignoredDuplicate = 0` e `imported = valid`. Para uma tentativa de conjunto
já importado, `processed` e `valid` vêm da prévia, `invalid` permanece o número
de linhas inválidas, `ignoredDuplicate = valid` e `imported = 0`; a resposta
é um conflito e pode incluir apenas o `existingImportId` tenant-scoped e o
resumo do lote existente. Um retry idempotente retorna exatamente o resultado
original da confirmação, sem somar contagens novamente.

`invalid` conta linhas distintas que possuem pelo menos um erro. Uma linha
pode produzir mais de uma entrada em `errors`, mas nunca aumenta `invalid` duas
vezes. Não há contagem de duplicidade de linha, porque o contrato não deduplica
linhas internamente. Em todo resultado válido:

```text
processed = valid + invalid
imported + ignoredDuplicate <= valid
```

## Decisão 7 — Erros públicos

Os códigos são estáveis e não dependem de mensagens de parser ou PostgreSQL.
Mensagens devem ser acionáveis e não conter valor bruto, descrição, filename,
SQL, stack trace, token ou existência de outro household.

```ts
type CsvImportErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_COMMAND"
  | "INVALID_COMMAND_ID"
  | "CSV_FILE_REQUIRED"
  | "CSV_FILE_TOO_LARGE"
  | "CSV_TOO_MANY_ROWS"
  | "CSV_INVALID_UTF8"
  | "CSV_INVALID_BOM"
  | "CSV_INVALID_NEWLINE"
  | "CSV_INVALID_HEADER"
  | "CSV_UNKNOWN_COLUMN"
  | "CSV_DUPLICATE_COLUMN"
  | "CSV_INVALID_DELIMITER"
  | "CSV_MALFORMED_QUOTING"
  | "CSV_EMPTY_FILE"
  | "CSV_NO_DATA_ROWS"
  | "CSV_FIELD_TOO_LARGE"
  | "CSV_ROW_WIDTH_MISMATCH"
  | "CSV_EMPTY_ROW"
  | "CSV_INVALID_DATE"
  | "CSV_DATE_IN_FUTURE"
  | "CSV_INVALID_DESCRIPTION"
  | "CSV_INVALID_AMOUNT"
  | "CSV_ZERO_AMOUNT"
  | "CSV_AMOUNT_OVERFLOW"
  | "CSV_INVALID_EXTERNAL_ID"
  | "ACCOUNT_NOT_FOUND"
  | "RESOURCE_ARCHIVED"
  | "TRACKING_START_DATE_VIOLATION"
  | "IMPORT_NO_VALID_ROWS"
  | "PREVIEW_NOT_FOUND"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_ALREADY_CONSUMED"
  | "IMPORT_DATASET_ALREADY_IMPORTED"
  | "COMMAND_ID_REUSED";

interface S04Error {
  code: CsvImportErrorCode;
  scope: "file" | "row" | "preview" | "confirmation";
  message: string;
  rowNumber?: number;
  field?: "commandId" | "accountId" | "previewToken" | "occurredOn" | "description" | "amountCents" | "externalId";
}
```

Erros de formato/linha são 400; autenticação é 401; conta ausente (inclusive
cross-tenant) é 404; conta arquivada, token expirado/consumido, fingerprint
repetido e `commandId` reutilizado são conflitos 409, exceto que um token de
outro household se comporta como `PREVIEW_NOT_FOUND`. Falhas inesperadas
seguem o envelope técnico de S01/S03, não viram mensagem de parser nem
vazam detalhes do banco.

## Decisão 8 — Idempotência e concorrência

O write usa a tabela compartilhada `application_commands` de S02/S03 com a
operação estável:

```text
transactions.import.confirm
```

`commandId` é opaco, aparado, não vazio, sem controle e limitado a 128
caracteres, como em S03. O hash do payload canônico inclui a operação e o
`previewId`/token já resolvido pelo servidor; não inclui tenant vindo do
browser nem repete o CSV bruto. Para o mesmo `(household_id, commandId)`:

- mesma operação e mesma prévia → retry idempotente, retorna o mesmo
  `importId`, contagens, erros e eventos, sem novos inserts;
- operação ou prévia diferente → `COMMAND_ID_REUSED`, sem alteração;
- household diferente → chave de idempotência independente, sem descoberta
  de registros.

A claim do command, o lote, todos os eventos/entries/linhagens e o consumo do
token participam da mesma transaction PostgreSQL. A constraint do fingerprint
resolve duas confirmações concorrentes; uma delas confirma e a outra recebe
`IMPORT_DATASET_ALREADY_IMPORTED`, sem duplicação silenciosa.

## Observabilidade e privacidade

Falhas esperadas de encoding, estrutura e validação por linha são resultados
de domínio e não devem gerar exceções inesperadas no Sentry. Falhas técnicas
inesperadas podem registrar somente metadados como operação, etapa,
`requestId`, `previewId`/`importId` opaco, código técnico, duração e contagens
agregadas.

Logs, métricas, breadcrumbs e Sentry não podem conter CSV, bytes, filename,
descrição, valor, `external_id`, token, payload de command ou nome de conta.
As métricas mínimas podem contar uploads, linhas processadas/válidas/inválidas,
confirmações, conflitos de fingerprint e duração, sempre sem conteúdo
financeiro.

## Handoff para T02–T13

| Task | Deve consumir desta ADR |
| --- | --- |
| [T02](../../tasks/S04-importacao-csv/002-schema-migrations-integridade_task.md) | `transaction_imports`, staging/linhagem, FKs compostas, unique parcial de fingerprint, índices, UUIDv7, contagens, retenção e extensão de `origin=IMPORT`. |
| [T03](../../tasks/S04-importacao-csv/003-parser-validacao_task.md) | Gramática CSV, limites, BOM/newline/quotes, normalização, `PlainDate`, `bigint`, erros por registro e fingerprint de multiconjunto. |
| [T04](../../tasks/S04-importacao-csv/004-fixtures-documentacao-matriz_task.md) | Exemplos válidos/inválidos, layout sem locale/float, limites, duplicidade de linhas e política de reimportação. |
| [T05](../../tasks/S04-importacao-csv/005-contratos-ui-componentes_task.md) | `CsvImportPreview`, rows/errors/counts, token opaco, estados de bloqueio e ausência de autoridade no client. |
| [T06](../../tasks/S04-importacao-csv/006-preview-autenticado_task.md) | Guard de contexto, conta ativa, staging server-side, expiração de 15 minutos e prévia sem escrita no ledger. |
| [T07](../../tasks/S04-importacao-csv/007-confirmacao-persistencia_task.md) | Command de dois campos, estratégia parcial, mapeamento `IMPORT` para S03, transaction única e consumo do token no commit. |
| [T08](../../tasks/S04-importacao-csv/008-idempotencia-relatorio_task.md) | `transactions.import.confirm`, retry, fingerprint por household/conta, conflito de conjunto e contagens finais. |
| [T09](../../tasks/S04-importacao-csv/009-observabilidade-segura_task.md) | Redaction, métricas agregadas e tratamento de validação como resultado esperado. |
| [T10](../../tasks/S04-importacao-csv/010-tela-importacao-preview_task.md) | Upload estrito, confirmação explícita, preview expirável, bloqueio de zero válidas/duplicidade e limites visíveis. |
| [T11](../../tasks/S04-importacao-csv/011-resultado-e-erros-ui_task.md) | Resultado `IMPORTED`/duplicado, contagens, erros por linha e navegação tenant-scoped. |
| [T12](../../tasks/S04-importacao-csv/012-testes-e2e-validacao_task.md) | Casos de parser, rollback, isolamento, concorrência, retry, duplicate set e E2E do fluxo. |
| [T13](../../tasks/S04-importacao-csv/013-validacao-release_task.md) | Checagem de limites, retenção, migration, privacidade, smoke test e ausência de conflito com a TechSpec. |

Qualquer mudança em formato, limites, fingerprint, retenção, idempotência,
origem ou mapeamento do ledger exige atualizar esta ADR e a T01 antes de
alterar schema, parser, actions ou UI.

## Consequências

- O usuário tem um formato pequeno e reproduzível para normalizar externamente
  seus extratos, sem o produto fingir conhecer layouts bancários.
- A prévia é segura contra adulteração de linhas no browser porque a
  confirmação só aceita o token e reidrata dados server-side.
- A estratégia parcial preserva as linhas válidas sem esconder inválidas,
  enquanto a transaction única impede lote financeiro pela metade.
- O fingerprint bloqueia reenvio acidental sem transformar duas linhas iguais
  dentro de um extrato em uma só.
- A origem `IMPORT` e a linhagem do lote permitem auditoria sem criar uma
  segunda fonte de verdade para saldo ou transações.
- O staging contém dados financeiros por no máximo a janela curta do token;
  depois dela, somente o ledger e o resumo sanitizado persistem.

## Divergência explícita da TechSpec

A única divergência é a exceção da seção 98: a V1 passa a aceitar o CSV
`s04-csv-v1` definido nesta ADR. Exportação CSV, suporte bancário específico,
OFX, Open Finance, reconciliação, IA interna e pipeline genérica continuam
fora do escopo.
