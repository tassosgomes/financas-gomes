# T03 — Parser seguro e validação por linha

- Slice: S04 — Importação de extrato CSV
- Status: Concluída — parser, validação, fingerprint e testes verificados em 2026-08-30.
- Onda: 1
- Dependências: T01
- Paralelização: Com T02, T04 e T05

## Objetivo

Transformar bytes CSV em um resultado determinístico, limitado e seguro para prévia.

## Subtarefas

- [x] Definir contratos tipados do CSV canônico, limites e códigos de erro públicos.
- [x] Implementar parsing RFC 4180 seguro com validação de bytes, UTF-8, BOM, newline, quoting, cabeçalho e limites.
- [x] Implementar normalização/validação por linha de data, descrição, centavos e `external_id`.
- [x] Implementar fingerprint SHA-256 determinístico do multiconjunto normalizado, preservando multiplicidade.
- [x] Cobrir parser, validação, limites e fingerprint com testes unitários e verificar os gates locais.

## Escopo

- Usar biblioteca CSV mantida; não fazer split manual por vírgula/newline.
- Impor tipo MIME apenas como dica e validar bytes, UTF-8, tamanho, número de linhas, largura de campo e cabeçalho.
- Tratar BOM e escapes/aspas conforme T01; rejeitar estrutura ambígua, cabeçalho inválido e arquivo vazio antes de produzir candidatos.
- Validar linha a linha: data `PlainDate` válida e não futura para `POSTED`, descrição normalizada/não vazia, `amount_cents` inteiro seguro/não zero e `external_id` dentro do limite.
- Retornar dados tipados: candidatos válidos normalizados, erros com número da linha e código/mensagem acionável, contagens e input canônico para fingerprint.
- Não logar conteúdo das linhas nem lançar exceções de validação como falhas inesperadas.

## Critérios de aceite

- [x] Arquivos válidos com campos entre aspas são parseados corretamente.
- [x] Cabeçalho, data, valor, encoding, vazio e limites geram resultado previsível.
- [x] O parser nunca usa float para valor financeiro.
- [x] Erros por linha não expõem stack nem impedem a prévia das demais linhas válidas.
- [x] O mesmo conjunto normalizado produz o mesmo fingerprint, independentemente da ordem das linhas definida em T01.

## Handoff

- Módulo público: [`src/modules/transaction-imports/index.ts`](../../src/modules/transaction-imports/index.ts).
- `parseCsvImport(input, options)` aceita `Uint8Array`, `ArrayBuffer` ou string UTF-8 e retorna `{ ok: true, ... }` com `candidates`, `rows`, `errors`, `counts`, `canonicalInput` e `fingerprint`; erros estruturais retornam `{ ok: false, error }` sem lançar exceções de validação.
- Opções server-side: `today` e `trackingStartedOn` (ou `accountTrackingStartedOn`). As candidatas têm `occurredOn`, `description`, `amountCents` absoluto, `signedAmountCents`, `kind`, `externalId` e `rowNumber`, todos serializáveis.
- `fingerprintCsvImport(candidates)` e `buildCsvImportCanonicalInput(candidates)` estão exportados para T06/T08; o digest é SHA-256 lowercase do multiconjunto ordenado por framing de campos length-prefixed, preservando duplicidades.
- Validação dedicada: `rtk npx vitest run src/modules/transaction-imports/csv-parser.test.ts`; gates verificados: `rtk npx tsc --noEmit --pretty false`, `rtk npm run lint -- --no-cache` e `rtk npm test -- --reporter=dot`.
