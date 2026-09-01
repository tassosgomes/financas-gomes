# S04 — Matriz de critérios e casos de teste

Esta matriz acompanha as fixtures sintéticas de
[`tests/fixtures/s04-importacao-csv`](../tests/fixtures/s04-importacao-csv) e
o contrato da [ADR-005](adr/005-s04-importacao-csv-contract.md). Os nomes de
suítes são pontos de integração para T03, T06–T12; a matriz não presume que o
parser ou as tabelas de importação já existam.

## Critérios de aceite do slice

| ID | Critério | Fixture/cenário | Expectativa observável | Camada mínima / task |
| --- | --- | --- | --- | --- |
| CA-01 | CSV válido gera preview correto | `valid/minimal.csv`, `valid/quoted-fields.csv` | 2 linhas válidas; datas, descrições, sinais e `externalId` normalizados; nenhuma escrita no ledger | Unitário do parser (T03) + integração de preview (T06) |
| CA-02 | Estrutura inválida não cria transação | `structural/*`, `empty/*`, `limits/*` | erro de arquivo estável; zero candidatos, lote e evento/entry | Unitário (T03) + integração de não-escrita (T06/T07) |
| CA-03 | Linhas inválidas têm mensagem acionável | `rows/mixed-valid-invalid.csv`, `rows/*` | `rowNumber`, campo, código e mensagem sem valor bruto; linhas válidas seguem na prévia | Unitário (T03) + contrato de resultado (T11) |
| CA-04 | Usuário sabe o total antes de confirmar | `valid/minimal.csv` | `processed=2`, `valid=2`, `invalid=0`, `ignoredDuplicate=0`, `imported=2` na prévia/resultado | Integração (T06/T07) + E2E (T12) |
| CA-05 | Importação usa a conta correta | `valid/minimal.csv` + conta `ACTIVE` sintética | cada linha cria exatamente um `FinancialEvent` e um `AccountEntry` na conta/household revalidado; sinal e origem `IMPORT` corretos | Integração PostgreSQL (T07) |
| CA-06 | Reenvio não duplica silenciosamente | `valid/duplicate-dataset-first.csv` e `valid/duplicate-dataset-retry.csv` | primeiro lote `IMPORTED`; segundo `DUPLICATE_DATASET`, `ignoredDuplicate=valid`, `imported=0`; retry do mesmo command retorna o resultado original | Integração de fingerprint/command (T08) + E2E (T12) |
| CA-07 | Outro household não acessa importação | qualquer fixture válida + dois contextos sintéticos | preview/token/lote de outro household se comporta como inexistente; nenhum ledger ou fingerprint é revelado | Integração tenant-scoped (T06/T08) + E2E (T12) |

## Gramática, limites e erros públicos de CSV

Cada linha abaixo deve existir no manifesto. “Fixture” indica bytes estáticos
ou uma receita materializável; “cenário” indica que o teste precisa de relógio,
conta ou estado persistido além do arquivo.

| Código ADR-005 | Fixture/cenário | Resultado esperado | Camada principal |
| --- | --- | --- | --- |
| `CSV_FILE_TOO_LARGE` | `limits/file-over-5mib.recipe.json` | rejeita antes do parse; nenhuma candidata | Unitário de limite (T03) + integração de upload (T06) |
| `CSV_TOO_MANY_ROWS` | `limits/data-over-10000-rows.recipe.json` | rejeita arquivo com 10.001 registros de dados | Unitário de limite (T03) + integração de upload (T06) |
| `CSV_INVALID_UTF8` | `structural/invalid-utf8.hex` | bytes inválidos rejeitados sem conversão implícita | Unitário de bytes (T03) |
| `CSV_INVALID_BOM` | `structural/invalid-bom.hex`, `empty/bom-only.hex` | BOM duplicado/no lugar indevido é erro; BOM único sem dados é vazio | Unitário de bytes (T03) |
| `CSV_INVALID_NEWLINE` | `structural/isolated-cr.hex` | CR isolado rejeitado; LF/CRLF continuam aceitos | Unitário de registros (T03) |
| `CSV_INVALID_HEADER` | `structural/invalid-header.csv` | cabeçalho não canônico rejeitado antes das linhas | Unitário de header (T03) |
| `CSV_UNKNOWN_COLUMN` | `structural/unknown-column.csv` | coluna extra desconhecida rejeitada | Unitário de header (T03) |
| `CSV_DUPLICATE_COLUMN` | `structural/duplicate-column.csv` | coluna repetida rejeitada | Unitário de header (T03) |
| `CSV_INVALID_DELIMITER` | `structural/semicolon-delimiter.csv` | `;` não é alias de vírgula | Unitário de header (T03) |
| `CSV_MALFORMED_QUOTING` | `structural/malformed-quoting.csv` | escape/backslash/texto após aspa rejeitado | Unitário de quoting (T03) |
| `CSV_EMPTY_FILE` | `empty/zero-byte.recipe.json`, `empty/whitespace-only.csv`, `empty/bom-only.hex` | nenhum candidato ou token | Unitário (T03) + integração de não-escrita (T06) |
| `CSV_NO_DATA_ROWS` | `empty/header-without-data.csv` | cabeçalho válido sem registro de dados rejeitado | Unitário (T03) |
| `CSV_FIELD_TOO_LARGE` | `limits/description-over-16k.recipe.json` | campo de 16.385 bytes/code points rejeitado | Unitário de limite (T03) |
| `CSV_ROW_WIDTH_MISMATCH` | `rows/row-width-mismatch.csv` | linha com largura diferente do cabeçalho vira erro dessa linha; outras linhas continuam candidatas | Unitário (T03) |
| `CSV_EMPTY_ROW` | `rows/empty-row.csv` | linha `,,` é processada e marcada inválida quando há outras linhas | Unitário de linha (T03) |
| `CSV_INVALID_DATE` | `rows/invalid-date.csv` | data fora de `YYYY-MM-DD` ou calendário ISO inválido | Unitário de data (T03) |
| `CSV_DATE_IN_FUTURE` | `rows/future-date.csv` | data posterior à data de negócio do relógio do servidor rejeitada | Unitário com relógio fixo (T03) |
| `CSV_INVALID_DESCRIPTION` | `rows/invalid-description.csv`, `rows/nul-in-description.hex` | descrição vazia após NFKC/trim ou com `Cc`/`Cf` rejeitada sem ecoar conteúdo | Unitário de normalização (T03) |
| `CSV_INVALID_AMOUNT` | `rows/invalid-amount.csv` | moeda, decimal, separador ou espaço não são aceitos | Unitário de `bigint` (T03) |
| `CSV_ZERO_AMOUNT` | `rows/zero-amount.csv` | `0`, inclusive sinalizado, rejeitado | Unitário de `bigint` (T03) |
| `CSV_AMOUNT_OVERFLOW` | `rows/overflow-amount.csv` | módulo maior que `9223372036854775807` rejeitado | Unitário de `bigint` (T03) |
| `CSV_INVALID_EXTERNAL_ID` | `rows/invalid-external-id.hex` | `Cc`/`Cf`, vazio não nulo ou tamanho inválido rejeitado | Unitário de normalização (T03) |
| `TRACKING_START_DATE_VIOLATION` | `rows/before-tracking-start.csv` + conta `tracking_started_on=2026-08-30` | candidata rejeitada somente após contexto da conta ser aplicado | Integração de referências (T06/T07) |
| `IMPORT_NO_VALID_ROWS` | `rows/no-valid-rows.csv` | preview sem token confirmável e sem lote/ledger | Unitário/contrato (T03/T06) |

## Duplicidade, normalização e semântica financeira

| Caso | Fixture/cenário | Invariante |
| --- | --- | --- |
| Ordem não altera fingerprint | `valid/fingerprint-order-a.csv` ↔ `valid/fingerprint-order-b.csv` | mesmo multiconjunto normalizado produz o mesmo SHA-256 |
| Multiplicidade é preservada | `valid/duplicate-rows.csv` | duas ocorrências iguais continuam duas candidatas e dois eventos legítimos |
| Reimportação do conjunto confirmado | `valid/duplicate-dataset-first.csv` ↔ `valid/duplicate-dataset-retry.csv` | fingerprint único por `(household_id, account_id)` bloqueia segundo lote |
| Outra conta/household | fixture válida + contexto alternativo | fingerprint igual pode ser importado em outro escopo, sem revelar o lote original |
| Sinal | `valid/minimal.csv` | positivo → `INCOME`/evento absoluto/entry positivo; negativo → `EXPENSE`/evento absoluto/entry negativo |
| Normalização | `valid/normalization.csv` | NFKC, trim e whitespace interno são aplicados antes do fingerprint |
| Coluna opcional | `valid/with-external-id.csv` | `external_id` vazio vira `null`; valor válido é preservado como metadata, não deduplica |

## Fluxo, segurança e observabilidade

Estes casos não são codificados por bytes de um CSV isolado. Cada um deve usar
uma fixture válida e o estado indicado, para que o teste comprove a fronteira
correta:

| Caso | Fixture base | Verificação | Camada / task |
| --- | --- | --- | --- |
| Upload sem sessão | `valid/minimal.csv` | `UNAUTHENTICATED`; nenhum parse/persistência exposto | Integração/E2E (T06/T12) |
| Arquivo ausente | nenhuma ou `empty/zero-byte.recipe.json` | `CSV_FILE_REQUIRED`; nenhum staging | Integração (T06) |
| Conta inexistente/cross-household | `valid/minimal.csv` | `ACCOUNT_NOT_FOUND` opaco e sem leitura de outro household | Integração (T06/T07) |
| Conta arquivada | `valid/minimal.csv` + conta `ARCHIVED` | `RESOURCE_ARCHIVED`; nada no ledger | Integração (T06/T07) |
| Token expirado | `valid/minimal.csv` + preview com relógio +15 min | `PREVIEW_EXPIRED`; token não reutilizável | Integração (T06/T08) |
| Token consumido | `valid/minimal.csv` + confirmação concluída | `PREVIEW_ALREADY_CONSUMED` para outro command | Integração (T08) |
| Command inválido/reutilizado | `valid/minimal.csv` | `INVALID_COMMAND`, `INVALID_COMMAND_ID` ou `COMMAND_ID_REUSED`; sem mudança | Unitário/integração (T07/T08) |
| Dataset já confirmado | `valid/duplicate-dataset-retry.csv` | `IMPORT_DATASET_ALREADY_IMPORTED`; resposta tenant-scoped | Integração/E2E (T08/T12) |
| Falha no commit | `valid/mixed-valid-invalid.csv` + injeção de falha | rollback de lote, eventos, entries, itens e command; token permanece retryável | Integração (T07/T08) |
| Redaction | qualquer fixture, sem incluir payload em logs | logs/Sentry/métricas contêm somente metadados e contagens agregadas | Unitário/integração (T09/T12) |

## Invariantes de contagem e ausência de dados reais

- Prévia nova: `processed = valid + invalid`, `ignoredDuplicate = 0` e
  `imported = valid` quando há linhas válidas.
- Dataset duplicado: `processed`/`valid`/`invalid` vêm da prévia,
  `ignoredDuplicate = valid` e `imported = 0`.
- Linhas idênticas não são colapsadas; cada `rowNumber` válido aparece uma
  vez na linhagem.
- Mensagens nunca contêm valor bruto, descrição, filename, token, SQL ou
  household alheio.
- Todo teste financeiro deve usar exclusivamente os valores e descrições
  sintéticos do catálogo, sem copiar extratos, nomes de contas ou IDs reais.
